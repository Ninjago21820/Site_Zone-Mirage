import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { apiPost, ApiError } from '../lib/api';
import { Badge, Button, Field, Notice, Panel, Select, Spinner, StatusPill, Table, Tabs, TextInput } from '../components/ui';
import { ADMIN_BASE } from '../App';
import { relativeTime } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

const TYPES = [
  ['', 'Tous les types'],
  ['news', 'Actualités'],
  ['roadmap', 'Feuille de route'],
  ['wiki', 'Wiki'],
  ['map', 'Carte'],
  ['faq', 'FAQ'],
  ['buyer_extras', 'Extras acheteurs'],
  ['legal', 'Pages légales'],
];
const STATUSES = [
  ['', 'Tous les statuts'],
  ['draft', 'Brouillon'],
  ['review', 'Vérification'],
  ['scheduled', 'Planification'],
  ['published', 'Publié'],
  ['archived', 'Archivé'],
  ['deleted', 'Supprimé'],
];

export default function ContentList({ data }: BackOfficeProps) {
  const navigate = useNavigate();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const list = useApi<any>(`/api/backoffice/content?type=${type}&status=${status}`, [type, status]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ type: 'news', slug: '', title: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const creatable: string[] = list.data?.canCreate ?? [];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<any>('/api/backoffice/content', {
        type: form.type, slug: form.slug,
        translations: { fr: { title: form.title, summary: '', body: '' } },
      });
      navigate(`${ADMIN_BASE}/contenu/${result.item.id}`);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="zm-label mb-1">§11.1 — Éditeur de blocs</p>
          <h1 className="text-xl">Contenus</h1>
        </div>
        {creatable.length > 0 && (
          <Button variant="primary" onClick={() => setCreating(!creating)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Nouveau contenu
          </Button>
        )}
      </div>

      <Notice tone="info">
        Workflow à six statuts : Brouillon → Vérification → Planification → Publié → Archivé → Supprimé (restauration 30 jours).
        La séparation auteur / vérificateur est appliquée côté serveur ; un passage outre administrateur doit être motivé et journalisé.
      </Notice>

      {creating && (
        <Panel className="p-5">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[160px_1fr_1fr_auto] items-end">
            <Field label="Type" htmlFor="new-type">
              <Select id="new-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.filter(([value]) => value).map(([value, label]) => (
                  <option key={value} value={value} disabled={!creatable.includes(value)}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Identifiant (slug)" htmlFor="new-slug" required hint="minuscules, chiffres, tirets">
              <TextInput id="new-slug" value={form.slug} required pattern="[a-z0-9-]+"
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </Field>
            <Field label="Titre (FR)" htmlFor="new-title" required>
              <TextInput id="new-title" value={form.title} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? '…' : 'Créer'}</Button>
          </form>
          {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
          <p className="mt-3 font-mono text-[9.5px] text-bone-500">
            Types autorisés pour votre rôle : {creatable.join(', ') || 'aucun'}
          </p>
        </Panel>
      )}

      <div className="flex flex-wrap gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[220px]" aria-label="Filtrer par type">
          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]" aria-label="Filtrer par statut">
          {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>

      {list.loading ? <Spinner /> : (
        <Table head={['Type', 'Identifiant', 'Statut', 'Auteur', 'Vérificateur', 'Traductions', 'Mis à jour', '']}>
          {(list.data?.items ?? []).map((item: any) => (
            <tr key={item.id} className="hover:bg-ink-850/60">
              <td className="px-3 py-2 font-mono text-[10.5px] text-bone-300">{item.type}</td>
              <td className="px-3 py-2">
                <Link to={`${ADMIN_BASE}/contenu/${item.id}`} className="font-mono text-[11px] text-bone-100 hover:text-alert-300">{item.slug}</Link>
                <p className="text-[10.5px] text-bone-500 truncate max-w-[16rem]">
                  {item.translations.find((tr: any) => tr.locale === 'fr')?.title ?? '—'}
                </p>
              </td>
              <td className="px-3 py-2"><StatusPill status={item.status} /></td>
              <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{item.authorName ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-bone-400">{item.verifierName ?? '—'}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1">
                  {['fr', 'en', 'es', 'de', 'it'].map((locale) => (
                    <span key={locale} title={locale}
                      className={`h-1.5 w-3 ${item.translationsMissing.includes(locale) ? 'bg-ink-600' : 'bg-emerald-500'}`} />
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-[9.5px] text-bone-500 whitespace-nowrap">{relativeTime(item.updatedAt)}</td>
              <td className="px-3 py-2 text-right">
                <Link to={`${ADMIN_BASE}/contenu/${item.id}`} className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-alert-400 hover:text-alert-200">éditer</Link>
              </td>
            </tr>
          ))}
          {!list.data?.items?.length && (
            <tr><td colSpan={8} className="px-3 py-8 text-center text-[12px] text-bone-500">Aucun contenu pour ces filtres.</td></tr>
          )}
        </Table>
      )}

      <div className="flex flex-wrap gap-2 font-mono text-[9.5px] text-bone-600">
        <Badge tone="neutral">{list.data?.items?.length ?? 0} éléments</Badge>
        <span>Vos droits : {Object.entries(data.permissions.content).filter(([, v]: any) => v.length).map(([k, v]: any) => `${k}:${v.join('')}`).join(' · ')}</span>
      </div>
    </div>
  );
}
