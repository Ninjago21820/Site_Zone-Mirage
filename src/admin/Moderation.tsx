import { useState } from 'react';
import { apiPost, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, EmptyState, Field, Notice, Panel, Spinner, StatusPill, Table, Tabs, TextArea, TextInput,
} from '../components/ui';
import { formatDateTime, relativeTime } from '../lib/format';
import { duration } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

type Tab = 'servers' | 'tickets' | 'scores';

export default function Moderation({ data }: BackOfficeProps) {
  const { openReauth } = useAuth();
  const functions = data.permissions.functions;
  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'servers', label: 'Serveurs', visible: functions.server_validation },
    { id: 'tickets', label: 'Tickets', visible: functions.support_tickets },
    { id: 'scores', label: 'Scores', visible: functions.score_removal },
  ];
  const visible = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<Tab>(visible[0]?.id ?? 'servers');
  const [flash, setFlash] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);

  function handleError(err: unknown) {
    const apiError = err as ApiError;
    if (apiError.code === 'reauth_required') {
      openReauth();
      setFlash({ tone: 'warn', message: 'Réauthentification requise puis relancez.' });
      return;
    }
    setFlash({ tone: 'danger', message: apiError.message });
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div>
        <p className="zm-label mb-1">§7 / §11.4 / §5.7</p>
        <h1 className="text-xl">Modération</h1>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.message}</Notice>}

      {visible.length === 0 ? (
        <Notice tone="warn">Aucune fonction de modération n’est attribuée à votre rôle.</Notice>
      ) : (
        <>
          <Tabs tabs={visible.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={setTab} className="mb-5" />
          {tab === 'servers' && <Servers onError={handleError} onOk={(message) => setFlash({ tone: 'ok', message })} />}
          {tab === 'tickets' && <Tickets onError={handleError} onOk={(message) => setFlash({ tone: 'ok', message })} role={data.user.role} />}
          {tab === 'scores' && <Scores onError={handleError} onOk={(message) => setFlash({ tone: 'ok', message })} />}
        </>
      )}
    </div>
  );
}

function Servers({ onError, onOk }: { onError: (err: unknown) => void; onOk: (message: string) => void }) {
  const list = useApi<any>('/api/servers/queue');

  async function decide(id: string, approve: boolean) {
    const reason = approve ? 'Validation conforme.' : (window.prompt('Motif du refus (5 caractères minimum) :') ?? '');
    if (!approve && reason.trim().length < 5) return;
    try {
      await apiPost(`/api/servers/${id}/validate`, { approve, reason });
      onOk(approve ? 'Serveur validé et publié.' : 'Serveur suspendu.');
      list.reload();
    } catch (err) { onError(err); }
  }

  if (list.loading) return <Spinner />;
  if (!list.data?.servers?.length) return <EmptyState title="File de validation vide" body="Aucun serveur en attente." />;

  return (
    <Table head={['Serveur', 'Adresse', 'Propriétaire', 'Statut', 'Créé', 'Actions']}>
      {list.data.servers.map((server: any) => (
        <tr key={server.id}>
          <td className="px-3 py-2 text-[12.5px] text-bone-100">{server.name}</td>
          <td className="px-3 py-2 font-mono text-[10.5px] text-bone-300">{server.address}</td>
          <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{server.ownerId}</td>
          <td className="px-3 py-2"><StatusPill status={server.status} /></td>
          <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500">{relativeTime(server.createdAt)}</td>
          <td className="px-3 py-2">
            <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={() => decide(server.id, true)}>valider</Button>
              <Button size="sm" variant="ghost" onClick={() => decide(server.id, false)}>suspendre</Button>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Tickets({
  onError, onOk, role,
}: { onError: (err: unknown) => void; onOk: (message: string) => void; role: string }) {
  const list = useApi<any>('/api/support/queue');
  const [openRef, setOpenRef] = useState<string | null>(null);
  const detail = useApi<any>(openRef ? `/api/support/tickets/${openRef}` : null, [openRef]);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);

  async function sendReply() {
    if (!openRef || reply.trim().length < 2) return;
    try {
      await apiPost(`/api/support/tickets/${openRef}/messages`, { body: reply, internal });
      setReply('');
      detail.reload();
      onOk('Message ajouté.');
    } catch (err) { onError(err); }
  }

  async function setStatus(status: string) {
    if (!openRef) return;
    try {
      await apiPost(`/api/support/tickets/${openRef}/status`, { status });
      detail.reload();
      list.reload();
      onOk(`Statut : ${status}.`);
    } catch (err) { onError(err); }
  }

  if (list.loading) return <Spinner />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr] items-start">
      <Panel>
        <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
          <h2 className="zm-label">File d’attente</h2>
          {list.data?.scope === 'technical_only' && <Badge tone="amber">technique uniquement</Badge>}
        </div>
        {!list.data?.tickets?.length ? <EmptyState title="Aucun ticket" /> : (
          <ul className="divide-y divide-ink-800">
            {list.data.tickets.map((ticket: any) => (
              <li key={ticket.ref}>
                <button onClick={() => setOpenRef(ticket.ref)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-ink-850 ${openRef === ticket.ref ? 'bg-ink-850' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-bone-400">{ticket.ref}</span>
                    <StatusPill status={ticket.status} />
                  </div>
                  <p className="text-[12.5px] text-bone-200 mt-1 truncate">{ticket.subject}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={ticket.priority === 'high' ? 'red' : 'neutral'}>{ticket.category}</Badge>
                    <span className="font-mono text-[9px] text-bone-500">{relativeTime(ticket.createdAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        {!openRef ? (
          <p className="px-4 py-8 text-center text-[12px] text-bone-500">Sélectionnez un ticket.</p>
        ) : detail.loading ? <Spinner /> : !detail.data ? <p className="px-4 py-8 text-[12px] text-bone-500">Ticket inaccessible.</p> : (
          <>
            <div className="border-b border-ink-700 px-4 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-bone-300">{detail.data.ticket.ref}</span>
                <StatusPill status={detail.data.ticket.status} />
              </div>
              <p className="text-[13px] text-bone-100 mt-1">{detail.data.ticket.subject}</p>
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-ink-800">
              {detail.data.messages.map((message: any) => (
                <li key={message.id} className={`px-4 py-2.5 ${message.internal ? 'bg-signal-500/[0.05]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-bone-300">{message.author}</span>
                    {message.internal && <Badge tone="amber">note interne</Badge>}
                    <span className="font-mono text-[9px] text-bone-500 ml-auto">{formatDateTime(message.createdAt)}</span>
                  </div>
                  <p className="text-[12px] text-bone-400 mt-1 whitespace-pre-line">{message.body}</p>
                </li>
              ))}
            </ul>
            <div className="border-t border-ink-700 p-3 space-y-2">
              <TextArea rows={3} placeholder="Réponse…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <label className="flex items-center gap-2 font-mono text-[10px] text-bone-400">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[#e11d2e]" />
                note interne (non visible par le demandeur)
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={sendReply} disabled={reply.trim().length < 2}>Envoyer</Button>
                {['in_progress', 'waiting', 'closed'].map((status) => (
                  <Button key={status} size="sm" variant="ghost" onClick={() => setStatus(status)}>{status}</Button>
                ))}
              </div>
              {role === 'dev' && <p className="font-mono text-[9px] text-signal-400/80">Rôle développeur : accès limité aux tickets techniques.</p>}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function Scores({ onError, onOk }: { onError: (err: unknown) => void; onOk: (message: string) => void }) {
  const list = useApi<any>('/api/backoffice/scores');

  async function remove(id: string) {
    const reason = window.prompt('Motif du retrait du score (5 caractères minimum) :') ?? '';
    if (reason.trim().length < 5) return;
    try {
      await apiPost(`/api/backoffice/scores/${id}/remove`, { reason });
      onOk('Score retiré des classements.');
      list.reload();
    } catch (err) { onError(err); }
  }

  if (list.loading) return <Spinner />;
  return (
    <Table head={['Joueur', 'Mode', 'Opération', 'Fin', 'Temps', 'Morts', 'Score', 'État', 'Actions']}>
      {(list.data?.scores ?? []).map((score: any) => (
        <tr key={score.id}>
          <td className="px-3 py-2 text-[12px] text-bone-100">{score.player}</td>
          <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{score.mode}</td>
          <td className="px-3 py-2 font-mono text-[10px] text-bone-300">{score.operation}</td>
          <td className="px-3 py-2 font-mono text-[10px] text-bone-500">{score.ending ?? '—'}</td>
          <td className="px-3 py-2 font-mono text-[10.5px] text-bone-200">{score.bestTimeMs ? duration(score.bestTimeMs) : '—'}</td>
          <td className="px-3 py-2 font-mono text-[10.5px] text-bone-300">{score.deaths}</td>
          <td className="px-3 py-2 font-mono text-[10.5px] text-bone-100">{Math.round(score.score * 10) / 10}</td>
          <td className="px-3 py-2">{score.hidden ? <Badge tone="red">retiré</Badge> : <Badge tone="green">publié</Badge>}</td>
          <td className="px-3 py-2">
            {!score.hidden && <Button size="sm" variant="ghost" onClick={() => remove(score.id)}>retirer</Button>}
          </td>
        </tr>
      ))}
    </Table>
  );
}
