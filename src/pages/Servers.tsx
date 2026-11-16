import { useState } from 'react';
import { Activity, AlertTriangle, Plus, Trash2, Wrench } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { apiDelete, apiPatch, apiPost, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, EmptyState, Field, LinkButton, Notice, Panel, SectionTitle, Spinner, StatusPill, TextArea, TextInput,
} from '../components/ui';
import { cx } from '../lib/format';

export default function Servers() {
  const { t } = useI18n();
  const { me, openReauth } = useAuth();
  const publicList = useApi<any>('/api/servers');
  const mine = useApi<any>(me.authenticated ? '/api/servers/mine' : null, [me.authenticated]);
  const [form, setForm] = useState({ name: '', address: '', description: '', region: 'EU', maxPlayers: 24 });
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function createServer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await apiPost('/api/servers', form);
      setForm({ name: '', address: '', description: '', region: 'EU', maxPlayers: 24 });
      setFeedback({ tone: 'ok', message: 'Serveur enregistré. Il sera publié après validation par l’équipe.' });
      mine.reload();
      publicList.reload();
    } catch (err) {
      const apiError = err as ApiError;
      setFeedback({ tone: 'danger', message: apiError.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleMaintenance(id: string) {
    try {
      await apiPatch(`/api/servers/${id}`, {});
      await apiPost(`/api/servers/${id}/maintenance`, {});
      mine.reload();
      publicList.reload();
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'reauth_required') {
        openReauth();
        setFeedback({ tone: 'warn', message: 'Réauthentifiez-vous puis relancez l’action.' });
      } else {
        setFeedback({ tone: 'danger', message: apiError.message });
      }
    }
  }

  async function removeServer(id: string) {
    if (!window.confirm('Retirer ce serveur du référencement ? Cette action exige une réauthentification.')) return;
    try {
      await apiDelete(`/api/servers/${id}`);
      mine.reload();
      publicList.reload();
      setFeedback({ tone: 'ok', message: 'Serveur retiré.' });
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'reauth_required') {
        openReauth();
        setFeedback({ tone: 'warn', message: 'Réauthentifiez-vous puis relancez l’action.' });
      } else {
        setFeedback({ tone: 'danger', message: apiError.message });
      }
    }
  }

  const servers = publicList.data?.servers ?? [];
  const limits = mine.data?.limits;

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§7 — Référencement communautaire" title={t('servers.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('servers.intro')}</p>

      <div className="grid gap-3 sm:grid-cols-3 mb-8">
        <Notice tone="info" title="3 serveurs maximum">Limite stricte de trois serveurs par compte, contrôlée côté serveur.</Notice>
        <Notice tone="warn" title="Protection SSRF">Les adresses internes, de bouclage et les ports privilégiés sont refusés.</Notice>
        <Notice tone="info" title="Mise en avant">Les trois serveurs les plus récemment validés occupent les premières places.</Notice>
      </div>

      {feedback && <Notice tone={feedback.tone} className="mb-6">{feedback.message}</Notice>}

      {publicList.loading ? <Spinner /> : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-start">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="zm-label">{t('servers.featured')}</h3>
              <span className="font-mono text-[9.5px] text-bone-500">{servers.length} serveurs</span>
            </div>
            <div className="space-y-2.5">
              {servers.length === 0 && <EmptyState title="Aucun serveur publié." />}
              {servers.map((server: any, index: number) => (
                <Panel key={server.id} className={cx('p-4', server.featured && 'border-alert-700/60')}>
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-lg text-ink-400 tabular-nums w-7 shrink-0">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[14px] text-bone-100 truncate">{server.name}</h4>
                        {server.featured && <Badge tone="red">Nouveau</Badge>}
                        {server.maintenance && <Badge tone="amber"><Wrench className="h-2.5 w-2.5" aria-hidden />{t('servers.maintenance')}</Badge>}
                        {server.status === 'suspended' && <Badge tone="red">{t('servers.suspended')}</Badge>}
                      </div>
                      <p className="font-mono text-[10.5px] text-bone-500 mt-1">
                        {server.address} · {server.region || '—'} · {server.maxPlayers} max
                      </p>
                      {server.description && <p className="mt-2 text-[12px] text-bone-400 leading-relaxed line-clamp-2">{server.description}</p>}
                      <div className="mt-2.5 flex items-center gap-3 font-mono text-[10px] text-bone-500">
                        <span className="flex items-center gap-1">
                          <span className={cx('h-1.5 w-1.5 rounded-full', server.maintenance ? 'bg-signal-400' : 'bg-emerald-400')} aria-hidden />
                          {server.currentPlayers}/{server.maxPlayers} {t('servers.players').toLowerCase()}
                        </span>
                        <span>{t('servers.average')} {server.averagePlayers}</span>
                        {server.offlineDays !== null && server.offlineDays > 14 && (
                          <span className="text-alert-300 flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" aria-hidden />hors ligne {server.offlineDays} j</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            {!me.authenticated ? (
              <Panel className="p-6 text-center">
                <p className="text-[13px] text-bone-300">Connectez-vous pour référencer un serveur communautaire.</p>
                <LinkButton to="/login" variant="primary" className="mt-4">{t('nav.login')}</LinkButton>
              </Panel>
            ) : (
              <>
                <Panel className="p-5">
                  <h3 className="text-sm mb-1">{t('servers.mine')}</h3>
                  <p className="font-mono text-[10px] text-bone-500 mb-4">
                    {limits ? `${limits.used} / ${limits.maxPerUser} utilisés` : '—'}
                  </p>
                  <div className="space-y-2">
                    {(mine.data?.servers ?? []).map((server: any) => (
                      <div key={server.id} className="border border-ink-600 rounded-[2px] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] text-bone-100 truncate">{server.name}</p>
                          <StatusPill status={server.status} />
                        </div>
                        <p className="font-mono text-[10px] text-bone-500 mt-1">{server.address}</p>
                        <div className="mt-2 flex gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => toggleMaintenance(server.id)}>
                            <Wrench className="h-3 w-3" aria-hidden /> {server.maintenance ? 'Fin maintenance' : 'Maintenance'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeServer(server.id)}>
                            <Trash2 className="h-3 w-3" aria-hidden /> {t('label.delete')}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!mine.data?.servers?.length && <p className="text-[12px] text-bone-500">Aucun serveur référencé.</p>}
                  </div>
                  {limits && limits.used >= limits.maxPerUser && (
                    <Notice tone="warn" className="mt-3">{t('servers.limit')}</Notice>
                  )}
                </Panel>

                {(!limits || limits.used < limits.maxPerUser) && (
                  <Panel className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Plus className="h-4 w-4 text-alert-400" aria-hidden />
                      <h3 className="text-sm">{t('servers.add')}</h3>
                    </div>
                    <form onSubmit={createServer} className="space-y-3">
                      <Field label={t('servers.name')} htmlFor="srv-name" required>
                        <TextInput id="srv-name" value={form.name} maxLength={60} required minLength={3}
                          onChange={(e) => setForm({ ...form, name: e.target.value })} />
                      </Field>
                      <Field label={t('servers.address')} htmlFor="srv-address" required hint="Exemple : 203.0.113.10:7777 — aucune adresse privée n’est acceptée.">
                        <TextInput id="srv-address" value={form.address} required placeholder="203.0.113.10:7777"
                          onChange={(e) => setForm({ ...form, address: e.target.value })} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label={t('servers.region')} htmlFor="srv-region">
                          <TextInput id="srv-region" value={form.region} maxLength={8}
                            onChange={(e) => setForm({ ...form, region: e.target.value })} />
                        </Field>
                        <Field label={t('servers.maxPlayers')} htmlFor="srv-max">
                          <TextInput id="srv-max" type="number" min={1} max={200} value={form.maxPlayers}
                            onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })} />
                        </Field>
                      </div>
                      <Field label={t('servers.description')} htmlFor="srv-desc" optionalLabel={t('label.optional')}>
                        <TextArea id="srv-desc" value={form.description} maxLength={400}
                          onChange={(e) => setForm({ ...form, description: e.target.value })} />
                      </Field>
                      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                        {busy ? t('label.loading') : t('label.create')}
                      </Button>
                    </form>
                  </Panel>
                )}
              </>
            )}

            <Panel className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-bone-400" aria-hidden />
                <h3 className="zm-label">{t('servers.rules')}</h3>
              </div>
              <ul className="space-y-2">
                {(mine.data?.rules ?? [
                  'Trois serveurs maximum par compte.',
                  'Toute inscription est validée par l’équipe avant publication.',
                  'L’adresse IP:port est contrôlée côté serveur (protection SSRF).',
                  'Les trois serveurs les plus récemment créés ou validés sont mis en avant.',
                  'Toute modification ou suppression exige une réauthentification.',
                ]).map((rule: string) => (
                  <li key={rule} className="flex gap-2 text-[11.5px] text-bone-400 leading-relaxed">
                    <span className="text-alert-500 mt-0.5" aria-hidden>▪</span>{rule}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
