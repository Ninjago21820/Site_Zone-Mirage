import { useState } from 'react';
import { Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApi, useDebounced } from '../lib/useApi';
import { apiPatch, apiPost, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Notice, Panel, Select, Spinner, StatusPill, Table, TextInput } from '../components/ui';
import { formatDate } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

const ROLES = ['admin', 'moderator', 'translator', 'writer', 'game_designer', 'animator', 'dev', 'community_manager', 'player'];

export default function Users({ data }: BackOfficeProps) {
  const { openReauth } = useAuth();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const list = useApi<any>(`/api/backoffice/users?q=${encodeURIComponent(debounced)}`, [debounced]);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);

  function handleError(err: unknown) {
    const apiError = err as ApiError;
    if (apiError.code === 'reauth_required') {
      openReauth();
      setFlash({ tone: 'warn', message: 'Réauthentification requise : validez la fenêtre puis relancez.' });
      return;
    }
    setFlash({ tone: 'danger', message: apiError.message });
  }

  async function changeRole(id: string, role: string) {
    try {
      await apiPatch(`/api/backoffice/users/${id}`, { role });
      setFlash({ tone: 'ok', message: 'Rôle mis à jour. Sessions révoquées si le compte devient interne.' });
      list.reload();
    } catch (err) { handleError(err); }
  }

  async function sanction(id: string, kind: 'warning' | 'suspend' | 'ban') {
    const reason = window.prompt(`Motif (${kind}) :`) ?? '';
    if (reason.trim().length < 5) { setFlash({ tone: 'danger', message: 'Motif requis (5 caractères minimum).' }); return; }
    try {
      await apiPost(`/api/backoffice/users/${id}/sanction`, { kind, reason });
      setFlash({ tone: 'ok', message: `Sanction appliquée : ${kind}.` });
      list.reload();
    } catch (err) { handleError(err); }
  }

  async function resetMfa(id: string) {
    const reason = window.prompt('Motif de la réinitialisation 2FA (10 caractères minimum) :') ?? '';
    if (reason.trim().length < 10) { setFlash({ tone: 'danger', message: 'Motif requis (10 caractères minimum).' }); return; }
    try {
      await apiPost(`/api/backoffice/users/${id}/mfa-reset`, { reason });
      setFlash({ tone: 'ok', message: '2FA réinitialisée. Le membre du personnel doit réenrôler un facteur.' });
      list.reload();
    } catch (err) { handleError(err); }
  }

  const canSanction = data.permissions.functions.account_sanctions;
  const canRoles = data.permissions.functions.users_roles;

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div>
        <p className="zm-label mb-1">§11.4 — Utilisateurs & rôles</p>
        <h1 className="text-xl">Comptes</h1>
      </div>

      {!canRoles && (
        <Notice tone="warn">
          Votre rôle ne permet pas de modifier les rôles. {canSanction && 'Les sanctions restent disponibles dans la limite de vos droits.'}
        </Notice>
      )}
      {data.user.role === 'community_manager' && (
        <Notice tone="info">Le Community Manager peut uniquement délivrer des avertissements (matrice §11.4).</Notice>
      )}
      {flash && <Notice tone={flash.tone}>{flash.message}</Notice>}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bone-500" aria-hidden />
        <TextInput className="pl-9" placeholder="Rechercher un pseudo, un e-mail, un Mirage ID…" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un compte" type="search" />
      </div>

      {list.loading ? <Spinner /> : (
        <Table head={['Pseudonyme', 'Mirage ID', 'Rôle', 'Statut', '2FA', 'Inscrit', 'Actions']}>
          {(list.data?.users ?? []).map((user: any) => (
            <tr key={user.id} className="hover:bg-ink-850/60">
              <td className="px-3 py-2">
                <p className="text-[12.5px] text-bone-100">{user.username}</p>
                <p className="font-mono text-[9.5px] text-bone-500">{user.email ?? 'sans adresse'}</p>
              </td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-400">{user.mirageId}</td>
              <td className="px-3 py-2">
                {canRoles ? (
                  <Select value={user.role} onChange={(e) => changeRole(user.id, e.target.value)}
                    className="py-1 text-[11px] max-w-[150px]" aria-label={`Rôle de ${user.username}`}>
                    {ROLES.map((role) => <option key={role} value={role}>{list.data.roles[role] ?? role}</option>)}
                  </Select>
                ) : <Badge tone="neutral">{user.roleLabel}</Badge>}
              </td>
              <td className="px-3 py-2"><StatusPill status={user.status} /></td>
              <td className="px-3 py-2">
                {user.totp || user.passkeys > 0 ? (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-300">
                    <ShieldCheck className="h-3 w-3" aria-hidden /> {user.totp ? 'TOTP' : ''}{user.passkeys ? ` +${user.passkeys}` : ''}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-signal-400">
                    <ShieldAlert className="h-3 w-3" aria-hidden /> absent
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500">{formatDate(user.createdAt)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {canSanction && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => sanction(user.id, 'warning')}>avertir</Button>
                      {data.user.role !== 'community_manager' && user.role !== 'admin' && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => sanction(user.id, 'suspend')}>suspendre</Button>
                          <Button size="sm" variant="ghost" onClick={() => sanction(user.id, 'ban')}>bannir</Button>
                        </>
                      )}
                    </>
                  )}
                  {canRoles && (user.totp || user.passkeys > 0) && user.role !== 'player' && (
                    <Button size="sm" variant="ghost" onClick={() => resetMfa(user.id)}>reset 2FA</Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Panel className="p-4">
        <p className="zm-label mb-2">Rappels</p>
        <ul className="space-y-1 text-[11.5px] text-bone-400 leading-relaxed">
          <li>• Une réinitialisation 2FA exige un motif, une réauthentification et est journalisée.</li>
          <li>• Le dernier administrateur ne peut pas être rétrogradé.</li>
          <li>• Les administrateurs doivent conserver plusieurs facteurs, dont une passkey.</li>
        </ul>
      </Panel>
    </div>
  );
}
