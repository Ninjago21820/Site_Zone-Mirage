import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Server, ShieldAlert, Ticket } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { Badge, EmptyState, Panel, Spinner } from '../components/ui';
import { ADMIN_BASE } from '../App';
import { formatDateTime, relativeTime } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

export default function Dashboard({ data }: BackOfficeProps) {
  const { data: stats, loading } = useApi<any>('/api/backoffice/dashboard');
  if (loading || !stats) return <Spinner label="Chargement des indicateurs…" />;

  const counts = stats.counts;
  return (
    <div className="space-y-5 max-w-[1200px]">
      <div>
        <p className="zm-label mb-1">Console</p>
        <h1 className="text-xl">Tableau de bord</h1>
      </div>

      {counts.staffWithoutMfa > 0 && (
        <div className="border border-signal-500/50 bg-signal-500/[0.07] px-4 py-3 flex items-start gap-3">
          <ShieldAlert className="h-4 w-4 text-signal-400 mt-0.5" aria-hidden />
          <p className="text-[12.5px] text-bone-200">
            {counts.staffWithoutMfa} membre(s) du personnel sans facteur de double authentification.
            La 2FA est obligatoire dès la première connexion (§6.4).
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Contenus', value: counts.content, icon: FileText, to: `${ADMIN_BASE}/contenu` },
          { label: 'Serveurs en attente', value: counts.pendingServers, icon: Server, to: `${ADMIN_BASE}/moderation` },
          { label: 'Tickets ouverts', value: counts.openTickets, icon: Ticket, to: `${ADMIN_BASE}/moderation` },
          { label: 'Comptes joueurs', value: counts.players, icon: ShieldAlert, to: `${ADMIN_BASE}/utilisateurs` },
        ].map((card) => (
          <Link key={card.label} to={card.to}>
            <Panel className="p-4 hover:border-ink-400 transition-colors">
              <div className="flex items-center justify-between">
                <card.icon className="h-4 w-4 text-alert-400" aria-hidden />
                <ArrowRight className="h-3 w-3 text-bone-500" aria-hidden />
              </div>
              <p className="font-mono text-2xl text-bone-100 mt-3 tabular-nums">{card.value}</p>
              <p className="zm-label mt-1 text-[9.5px]">{card.label}</p>
            </Panel>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
            <h2 className="zm-label">File de vérification</h2>
            <Badge tone="amber">{counts.byStatus.review} en revue</Badge>
          </div>
          {stats.queue.review.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-bone-500">Aucun contenu en attente de vérification.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {stats.queue.review.map((item: any) => (
                <li key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-bone-200 truncate">{item.type} / {item.slug}</p>
                    <p className="font-mono text-[9.5px] text-bone-500">maj {relativeTime(item.updated_at)}</p>
                  </div>
                  <Link to={`${ADMIN_BASE}/contenu/${item.id}`} className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-alert-400 hover:text-alert-200">
                    ouvrir
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
            <h2 className="zm-label">Publication planifiée</h2>
            <Badge tone="blue">{counts.byStatus.scheduled} planifiés</Badge>
          </div>
          {stats.queue.scheduled.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-bone-500">Aucune publication planifiée.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {stats.queue.scheduled.map((item: any) => (
                <li key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-bone-200 truncate">{item.type} / {item.slug}</p>
                  <span className="font-mono text-[9.5px] text-bone-500">{formatDateTime(item.scheduled_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
          <h2 className="zm-label">Journal d’audit — dernières entrées</h2>
          <Badge tone={stats.audit.chainOk ? 'green' : 'red'}>
            {stats.audit.chainOk ? `chaîne vérifiée (${stats.audit.checked})` : 'chaîne rompue'}
          </Badge>
        </div>
        {stats.audit.recent.length === 0 ? <EmptyState title="Aucune entrée" /> : (
          <ul className="divide-y divide-ink-800">
            {stats.audit.recent.map((entry: any, index: number) => (
              <li key={index} className="px-4 py-2 flex items-center gap-3">
                <span className="font-mono text-[9px] text-bone-600 w-24 shrink-0">{formatDateTime(entry.at)}</span>
                <span className="font-mono text-[10.5px] text-bone-200">{entry.action}</span>
                <span className="ml-auto font-mono text-[9.5px] text-bone-500 truncate">{entry.target_type}:{entry.target_id}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(stats.counts.byType).map(([type, value]) => (
          <div key={type} className="border border-ink-700 px-3 py-2 flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-bone-400">{type}</span>
            <span className="font-mono text-[12px] text-bone-100">{String(value)}</span>
          </div>
        ))}
      </div>

      <p className="font-mono text-[9.5px] text-bone-600">
        Rôle : {data.user.roleLabel} · fonctions actives : {Object.entries(data.permissions.functions).filter(([, v]) => v).map(([k]) => k).join(', ') || 'aucune'}
      </p>
    </div>
  );
}
