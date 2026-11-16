import { useState } from 'react';
import { DownloadCloud, KeyRound, Languages, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiPost, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, EmptyState, Field, Notice, Panel, Spinner, Table, TextInput,
} from '../components/ui';
import { formatDateTime, shortHash } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

export default function System({ data, view }: BackOfficeProps & { view: 'audit' | 'system' }) {
  return view === 'audit' ? <Audit data={data} /> : <SystemPanel data={data} />;
}

function Audit({ data }: BackOfficeProps) {
  const [action, setAction] = useState('');
  const list = useApi<any>(`/api/backoffice/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`, [action]);
  const [verification, setVerification] = useState<any>(null);

  async function verify() {
    try {
      setVerification(await apiPost<any>('/api/backoffice/audit/verify'));
    } catch {
      setVerification({ ok: false });
    }
  }

  if (!data.permissions.functions.audit_log) {
    return <Notice tone="warn">Le journal d’audit est réservé aux administrateurs (§11.4).</Notice>;
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="zm-label mb-1">§6.12 — Journal append-only</p>
          <h1 className="text-xl">Journal d’audit</h1>
        </div>
        <Button variant="outline" onClick={verify}><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Vérifier la chaîne</Button>
      </div>

      <Notice tone="info">
        Conservation 12 mois. Adresse IP tronquée après 30 jours. Chaque entrée contient l’empreinte de la précédente :
        toute suppression ou modification rompt la chaîne.
      </Notice>

      {verification && (
        <Notice tone={verification.ok ? 'ok' : 'danger'} title={verification.ok ? 'Chaîne intègre' : 'Chaîne rompue'}>
          {verification.ok ? `${verification.checked} entrées vérifiées.` : `Anomalie détectée à l’entrée #${verification.brokenAt}.`}
        </Notice>
      )}

      {list.data?.chain && (
        <div className="flex flex-wrap gap-2">
          <Badge tone={list.data.chain.ok ? 'green' : 'red'}>
            {list.data.chain.ok ? `chaîne valide (${list.data.chain.checked})` : 'chaîne invalide'}
          </Badge>
          <Badge tone="neutral">rétention {list.data.retention.months} mois</Badge>
          <Badge tone="neutral">IP tronquée après {list.data.retention.ipTruncatedAfterDays} j</Badge>
        </div>
      )}

      <div className="max-w-xs">
        <Field label="Filtrer par action" htmlFor="audit-filter">
          <TextInput id="audit-filter" value={action} placeholder="ex. content, auth, backup"
            onChange={(e) => setAction(e.target.value)} />
        </Field>
      </div>

      {list.loading ? <Spinner /> : (
        <Table head={['#', 'Horodatage', 'Action', 'Acteur', 'Cible', 'IP', 'Empreinte']}>
          {(list.data?.entries ?? []).map((entry: any) => (
            <tr key={entry.id} className="hover:bg-ink-850/60">
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-600">{entry.id}</td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-400 whitespace-nowrap">{formatDateTime(entry.at)}</td>
              <td className="px-3 py-2 font-mono text-[10.5px] text-bone-100">{entry.action}</td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-400">
                {entry.actorId ?? 'système'}
                {entry.actorRole && <span className="block text-bone-600">{entry.actorRole}</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500 max-w-[14rem] truncate">
                {entry.targetType}:{entry.targetId ?? '—'}
                {Object.keys(entry.meta).length > 0 && (
                  <span className="block text-bone-600 truncate">{JSON.stringify(entry.meta)}</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[9px] text-bone-500">{entry.ip || '—'}</td>
              <td className="px-3 py-2 font-mono text-[9px] text-bone-600" title={entry.hash}>{shortHash(entry.hash, 8)}</td>
            </tr>
          ))}
          {!list.data?.entries?.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[12px] text-bone-500">Aucune entrée.</td></tr>}
        </Table>
      )}
    </div>
  );
}

function SystemPanel({ data }: BackOfficeProps) {
  const { openReauth } = useAuth();
  const functions = data.permissions.functions;
  const backups = useApi<any>(functions.backups_logs ? '/api/backoffice/backups' : null);
  const keys = useApi<any>(functions.api_keys ? '/api/backoffice/api-keys' : null);
  const i18n = useApi<any>('/api/backoffice/i18n');
  const [flash, setFlash] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<any>(null);

  function handleError(err: unknown) {
    const apiError = err as ApiError;
    if (apiError.code === 'reauth_required') {
      openReauth();
      setFlash({ tone: 'warn', message: 'Réauthentification requise puis relancez.' });
      return;
    }
    setFlash({ tone: 'danger', message: apiError.message });
  }

  async function runBackup() {
    setBusy(true);
    setFlash(null);
    try {
      const result = await apiPost<any>('/api/backoffice/backups/run');
      setVerification(result.verification);
      setFlash({
        tone: result.ok ? 'ok' : 'danger',
        message: `Sauvegarde ${result.ok ? 'créée et vérifiée' : 'créée mais NON vérifiée'} — ${(result.backup.sizeBytes / 1024).toFixed(1)} Ko.`,
      });
      backups.reload();
    } catch (err) { handleError(err); } finally { setBusy(false); }
  }

  async function verifyLatest() {
    setBusy(true);
    try {
      const result = await apiPost<any>('/api/backoffice/backups/verify', {});
      setVerification(result);
      setFlash({ tone: result.ok ? 'ok' : 'danger', message: result.ok ? 'Restauration vérifiée.' : 'Vérification échouée.' });
    } catch (err) { handleError(err); } finally { setBusy(false); }
  }

  async function rotateKeys() {
    const reason = window.prompt('Motif de la rotation des clés (10 caractères minimum) :') ?? '';
    if (reason.trim().length < 10) return;
    try {
      await apiPost('/api/backoffice/api-keys/rotate', { reason });
      setFlash({ tone: 'ok', message: 'Nouvelle paire de clés Ed25519 générée ; ancienne clé révoquée.' });
      keys.reload();
    } catch (err) { handleError(err); }
  }

  async function updateProgress(locale: string, value: number) {
    try {
      await apiPost('/api/backoffice/i18n', { locale, progress: value });
      i18n.reload();
    } catch (err) { handleError(err); }
  }

  return (
    <div className="space-y-5 max-w-[1100px]">
      <div>
        <p className="zm-label mb-1">Exploitation</p>
        <h1 className="text-xl">Système</h1>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.message}</Notice>}

      {functions.backups_logs ? (
        <Panel>
          <div className="border-b border-ink-700 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DownloadCloud className="h-4 w-4 text-alert-400" aria-hidden />
              <h2 className="zm-label">Sauvegardes chiffrées (§6.11)</h2>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="primary" onClick={runBackup} disabled={busy}>Créer + vérifier</Button>
              <Button size="sm" variant="outline" onClick={verifyLatest} disabled={busy}>Vérifier la dernière</Button>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <p className="font-mono text-[10px] text-bone-500">
              Chiffrement {backups.data?.encryption ?? 'AES-256-GCM'} · restauration vérifiée obligatoire · <code>npm run backup:verify</code>
            </p>
            {backups.loading ? <Spinner /> : (
              <Table head={['Fichier', 'Taille', 'Date', 'Empreinte']}>
                {(backups.data?.files ?? []).map((file: any) => (
                  <tr key={file.file}>
                    <td className="px-3 py-2 font-mono text-[10px] text-bone-200 break-all">{file.file}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{(file.sizeBytes / 1024).toFixed(1)} Ko</td>
                    <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500">{formatDateTime(file.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-[9px] text-bone-600">—</td>
                  </tr>
                ))}
                {!backups.data?.files?.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-[12px] text-bone-500">Aucune sauvegarde.</td></tr>}
              </Table>
            )}
            {verification && (
              <div className="border border-ink-600 p-3">
                <p className="zm-label mb-2">Rapport de restauration</p>
                <ul className="space-y-1">
                  {verification.checks.map((check: any) => (
                    <li key={check.name} className="flex items-center gap-2 font-mono text-[10px]">
                      <span className={check.ok ? 'text-emerald-400' : 'text-alert-400'}>{check.ok ? 'OK' : 'FAIL'}</span>
                      <span className="text-bone-300">{check.name}</span>
                      <span className="text-bone-600 truncate">{check.detail}</span>
                    </li>
                  ))}
                </ul>
                {verification.tables && (
                  <p className="mt-2 font-mono text-[9.5px] text-bone-500">
                    {Object.keys(verification.tables).length} tables restaurées · users {verification.tables.users ?? 0} · audit {verification.tables.audit_log ?? 0}
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>
      ) : (
        <Notice tone="warn">Les sauvegardes et journaux techniques sont réservés aux administrateurs et développeurs.</Notice>
      )}

      {functions.api_keys && (
        <Panel>
          <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-alert-400" aria-hidden />
              <h2 className="zm-label">Clés de signature Ed25519 (§5.4)</h2>
            </div>
            <Button size="sm" variant="outline" onClick={rotateKeys}><RefreshCw className="h-3 w-3" aria-hidden /> Rotation</Button>
          </div>
          {keys.loading ? <Spinner /> : (
            <div className="p-4 space-y-3">
              <Table head={['kid', 'Algorithme', 'Créée', 'État']}>
                {(keys.data?.keys ?? []).map((key: any) => (
                  <tr key={key.kid}>
                    <td className="px-3 py-2 font-mono text-[10px] text-bone-200">{key.kid}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{key.algorithm}</td>
                    <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500">{formatDateTime(key.createdAt)}</td>
                    <td className="px-3 py-2">{key.revoked ? <Badge tone="red">révoquée</Badge> : <Badge tone="green">active</Badge>}</td>
                  </tr>
                ))}
              </Table>
              <p className="font-mono text-[9px] text-bone-600">
                La clé privée ne quitte jamais le serveur. Les jetons portent un <code>kid</code> pour permettre la rotation.
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {(keys.data?.endpoints ?? []).map((endpoint: string) => (
                  <li key={endpoint} className="font-mono text-[9.5px] text-bone-400 border border-ink-700 px-2 py-1">{endpoint}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <Panel>
        <div className="border-b border-ink-700 px-4 py-2.5 flex items-center gap-2">
          <Languages className="h-4 w-4 text-alert-400" aria-hidden />
          <h2 className="zm-label">Internationalisation</h2>
        </div>
        <div className="p-4 space-y-2">
          {(i18n.data?.locales ?? ['fr', 'en', 'es', 'de', 'it']).map((locale: string) => {
            const value = i18n.data?.progress?.[locale] ?? 0;
            const masked = ['es', 'de', 'it'].includes(locale) && value < 0.85;
            return (
              <div key={locale} className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-bone-300 w-8 uppercase">{locale}</span>
                <div className="h-1.5 flex-1 bg-ink-800 overflow-hidden">
                  <div className={`h-full ${value >= 0.85 ? 'bg-emerald-500' : 'bg-signal-500'}`} style={{ width: `${Math.max(2, value * 100)}%` }} />
                </div>
                <span className="font-mono text-[10px] text-bone-400 w-10 text-right">{Math.round(value * 100)}%</span>
                {masked ? <Badge tone="amber">masquée</Badge> : <Badge tone="green">publiée</Badge>}
                {(data.user.role === 'translator' || data.user.role === 'admin') && (
                  <input type="range" min={0} max={100} defaultValue={Math.round(value * 100)}
                    onChange={(e) => updateProgress(locale, Number(e.target.value) / 100)}
                    className="w-24 accent-[#e11d2e]" aria-label={`Progression ${locale}`} />
                )}
              </div>
            );
          })}
          <p className="font-mono text-[9px] text-bone-600">
            Seuil de publication : 85 %. En dessous, la langue reste masquée avec un lien Crowdin.
          </p>
        </div>
      </Panel>
    </div>
  );
}
