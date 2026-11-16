import { useState } from 'react';
import { CheckCircle2, LifeBuoy, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { apiPost, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Field, LinkButton, Notice, Panel, SectionTitle, Select, Spinner, StatusPill, TextArea, TextInput } from '../components/ui';

const CATEGORIES = [
  ['security', 'Sécurité'],
  ['account', 'Compte'],
  ['license', 'Licence'],
  ['server', 'Serveur communautaire'],
  ['technical', 'Technique'],
  ['game', 'Jeu'],
  ['other', 'Autre'],
];

export default function Support() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { data: status } = useApi<any>('/api/support/status');
  const mine = useApi<any>(me.authenticated ? '/api/support/tickets' : null, [me.authenticated]);
  const [form, setForm] = useState({ category: 'account', subject: '', email: '', message: '' });
  const [ref, setRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<any>('/api/support/tickets', form);
      setRef(result.ref);
      setForm({ category: 'account', subject: '', email: '', message: '' });
      mine.reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§12.3 — Assistance" title={t('support.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('support.intro')}</p>

      <Notice tone="danger" className="mb-6" title="Signalement de sécurité">
        <span className="flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            Contact direct : <span className="font-mono text-[12px]">{status?.securityContact ?? 'security@mirage-protocol.example'}</span> — traitement sous 24 h.
            Ne joignez jamais de mot de passe ni de code de double authentification.
          </span>
        </span>
      </Notice>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] items-start">
        <Panel className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <LifeBuoy className="h-4 w-4 text-alert-400" aria-hidden />
            <h3 className="text-sm">Nouvelle demande</h3>
          </div>

          {ref ? (
            <div className="space-y-4">
              <Notice tone="ok" title={t('support.sent')}>
                <p className="font-mono text-lg text-bone-100">{ref}</p>
                <p>Conservez cette référence : elle permet de suivre le traitement.</p>
              </Notice>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setRef(null)}>Nouvelle demande</Button>
                {me.authenticated && <LinkButton to="/account" variant="ghost">{t('account.title')}</LinkButton>}
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label={t('support.category')} htmlFor="sup-category" required>
                <Select id="sup-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label={t('support.subject')} htmlFor="sup-subject" required hint="5 caractères minimum, 140 maximum.">
                <TextInput id="sup-subject" value={form.subject} required minLength={5} maxLength={140}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </Field>
              {!me.authenticated && (
                <Field label={t('support.email')} htmlFor="sup-email" required hint="Utilisée uniquement pour vous répondre.">
                  <TextInput id="sup-email" type="email" autoComplete="email" value={form.email} required
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
              )}
              <Field label={t('support.message')} htmlFor="sup-message" required hint="20 caractères minimum. Aucun HTML n’est interprété.">
                <TextArea id="sup-message" rows={6} value={form.message} required minLength={20} maxLength={5000}
                  onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </Field>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button type="submit" variant="primary" disabled={busy}>{busy ? t('label.loading') : t('support.send')}</Button>
            </form>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel className="p-5">
            <h3 className="zm-label mb-3">Délais de réponse</h3>
            <dl className="space-y-2">
              {Object.entries(status?.responseTimes ?? { security: '24 h', technical: '72 h', other: '5 jours' }).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-[12px]">
                  <dt className="text-bone-400 capitalize">{key}</dt>
                  <dd className="font-mono text-bone-200">{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-signal-400/80">Valeurs indicatives — [à confirmer]</p>
          </Panel>

          <Panel>
            <div className="border-b border-ink-700 px-4 py-3">
              <h3 className="zm-label">{t('support.tracking')}</h3>
            </div>
            {!me.authenticated ? (
              <p className="px-4 py-4 text-[12px] text-bone-400">
                Connectez-vous pour suivre vos demandes. <LinkButton to="/login" size="sm" variant="ghost" className="ml-1">{t('nav.login')}</LinkButton>
              </p>
            ) : mine.loading ? <Spinner label="Chargement…" /> : !mine.data?.tickets?.length ? (
              <p className="px-4 py-4 text-[12px] text-bone-500">Aucune demande enregistrée.</p>
            ) : (
              <ul className="divide-y divide-ink-800">
                {mine.data.tickets.map((ticket: any) => (
                  <li key={ticket.ref} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] text-bone-400">{ticket.ref}</span>
                      <StatusPill status={ticket.status} />
                    </div>
                    <p className="text-[12.5px] text-bone-200 mt-1 truncate">{ticket.subject}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="neutral">{ticket.category}</Badge>
                      {ticket.priority === 'high' && <Badge tone="red">priorité haute</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
              <h3 className="zm-label">Bonnes pratiques</h3>
            </div>
            <ul className="space-y-1.5 text-[11.5px] text-bone-400 leading-relaxed">
              <li>• Ne communiquez jamais votre mot de passe ni un code 2FA.</li>
              <li>• Indiquez votre Mirage ID pour les demandes liées au compte.</li>
              <li>• Pour un litige de licence, précisez la plateforme concernée.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
