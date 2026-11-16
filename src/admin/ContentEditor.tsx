import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { apiPost, apiPut, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, Checkbox, Field, Notice, Panel, Select, Spinner, StatusPill, TextArea, TextInput,
} from '../components/ui';
import { ADMIN_BASE } from '../App';
import { formatDateTime, relativeTime } from '../lib/format';
import type { BackOfficeProps } from './BackOffice';

const LOCALES = [
  ['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'],
];
const STATUS_FLOW: Record<string, string[]> = {
  draft: ['review', 'deleted'],
  review: ['scheduled', 'published', 'draft', 'deleted'],
  scheduled: ['published', 'draft', 'deleted'],
  published: ['archived', 'deleted'],
  archived: ['published', 'deleted'],
  deleted: ['draft'],
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', review: 'Vérification', scheduled: 'Planification',
  published: 'Publié', archived: 'Archivé', deleted: 'Supprimé',
};
const BLOCK_KINDS = ['paragraph', 'heading', 'list', 'quote', 'code', 'spoiler', 'divider', 'image', 'table'];

interface Block { kind: string; text?: string; items?: string[]; level?: number; src?: string; alt?: string; spoilerLabel?: string }

export default function ContentEditor({ data }: BackOfficeProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openReauth } = useAuth();
  const { data: payload, loading, error, reload } = useApi<any>(id ? `/api/backoffice/content/${id}` : null, [id]);
  const [locale, setLocale] = useState('fr');
  const [form, setForm] = useState<any>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState({ enabled: false, reason: '', to: '' });
  const [scheduleAt, setScheduleAt] = useState('');

  useEffect(() => {
    if (!payload?.item) return;
    const item = payload.item;
    const translations: Record<string, { title: string; summary: string; body: string }> = {};
    for (const entry of LOCALES) {
      const found = item.translations.find((tr: any) => tr.locale === entry[0]);
      translations[entry[0]] = { title: found?.title ?? '', summary: found?.summary ?? '', body: found?.body ?? '' };
    }
    setForm({
      category: item.category,
      spoiler: item.spoiler,
      acsLevel: item.acsLevel ?? '',
      clearance: item.clearance ?? '',
      seoTitle: item.seoTitle,
      seoDesc: item.seoDesc,
      featured: item.featured,
      order: item.order,
      editorNote: item.editorNote,
      translations,
    });
    setBlocks(item.blocks ?? []);
  }, [payload]);

  const allowedTransitions = useMemo(() => {
    if (!payload?.item) return [];
    return STATUS_FLOW[payload.item.status] ?? [];
  }, [payload]);

  function handleError(err: unknown) {
    const apiError = err as ApiError;
    if (apiError.code === 'reauth_required') {
      openReauth();
      setFlash({ tone: 'warn', message: 'Réauthentification requise puis relancez l’action.' });
      return;
    }
    setFlash({ tone: 'danger', message: apiError.message });
  }

  async function save() {
    if (!form || !payload?.item) return;
    setBusy(true);
    setFlash(null);
    try {
      await apiPut(`/api/backoffice/content/${payload.item.id}`, {
        category: form.category,
        spoiler: form.spoiler,
        acsLevel: form.acsLevel || null,
        clearance: form.clearance || null,
        seoTitle: form.seoTitle,
        seoDesc: form.seoDesc,
        featured: form.featured,
        order: Number(form.order) || 0,
        editorNote: form.editorNote,
        blocks,
        translations: form.translations,
      });
      setFlash({ tone: 'ok', message: 'Contenu enregistré. Une révision a été créée.' });
      reload();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: string, useOverride = false) {
    if (!payload?.item) return;
    setBusy(true);
    setFlash(null);
    try {
      await apiPost(`/api/backoffice/content/${payload.item.id}/transition`, {
        to,
        override: useOverride,
        overrideReason: useOverride ? override.reason : undefined,
        scheduledAt: to === 'scheduled' ? new Date(scheduleAt).getTime() : undefined,
      });
      setFlash({ tone: 'ok', message: `Transition appliquée : ${STATUS_LABEL[to]}${useOverride ? ' (passage outre journalisé)' : ''}.` });
      setOverride({ enabled: false, reason: '', to: '' });
      reload();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  function updateBlock(index: number, patch: Partial<Block>) {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }
  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  if (loading) return <Spinner label="Chargement du contenu…" />;
  if (error || !payload?.item) return <Notice tone="danger">{error?.message ?? 'Contenu introuvable.'}</Notice>;
  if (!form) return <Spinner />;

  const item = payload.item;
  const translation = form.translations[locale] ?? { title: '', summary: '', body: '' };
  const permissions: string[] = payload.permissions ?? [];
  const isAuthor = item.authorId === data.user.id;
  const canOverride = data.user.role === 'admin';

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate(`${ADMIN_BASE}/contenu`)} className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-bone-500 hover:text-bone-200">
            ← Contenus
          </button>
          <h1 className="text-xl mt-1 font-mono break-all">{item.type} / {item.slug}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            <Badge tone="neutral">{permissions.join('') || 'lecture seule'}</Badge>
            {isAuthor && <Badge tone="amber">vous êtes l’auteur</Badge>}
            <span className="font-mono text-[9.5px] text-bone-500">maj {relativeTime(item.updatedAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save} disabled={busy}>
            <Save className="h-3.5 w-3.5" aria-hidden /> {busy ? '…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      {flash && <Notice tone={flash.tone}>{flash.message}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
        <div className="space-y-5">
          {/* ---------------------------- TRANSLATIONS ---------------------------- */}
          <Panel>
            <div className="border-b border-ink-700 px-3 pt-2 flex flex-wrap">
              {LOCALES.map(([code, label]) => {
                const tr = form.translations[code];
                const filled = !!(tr?.title || tr?.body);
                return (
                  <button key={code} onClick={() => setLocale(code)}
                    className={`px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] border-b-2 -mb-px flex items-center gap-1.5 ${
                      locale === code ? 'border-alert-500 text-bone-100' : 'border-transparent text-bone-500 hover:text-bone-300'}`}>
                    {code}
                    <span className={`h-1 w-1 rounded-full ${filled ? 'bg-emerald-500' : 'bg-ink-600'}`} aria-hidden />
                  </button>
                );
              })}
            </div>
            <div className="p-4 space-y-3">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500">
                {LOCALES.find(([c]) => c === locale)?.[1]} {locale === 'fr' && '· obligatoire'}
              </p>
              <Field label="Titre" htmlFor={`title-${locale}`} required={locale === 'fr'}>
                <TextInput id={`title-${locale}`} value={translation.title}
                  onChange={(e) => setForm({ ...form, translations: { ...form.translations, [locale]: { ...translation, title: e.target.value } } })} />
              </Field>
              <Field label="Résumé" htmlFor={`summary-${locale}`} hint="Utilisé dans les listes et les métadonnées.">
                <TextArea id={`summary-${locale}`} rows={2} value={translation.summary}
                  onChange={(e) => setForm({ ...form, translations: { ...form.translations, [locale]: { ...translation, summary: e.target.value } } })} />
              </Field>
              <Field label="Corps (Markdown restreint)" htmlFor={`body-${locale}`} hint="Titres, listes, citations, tableaux, liens. Le HTML brut est affiché comme texte.">
                <TextArea id={`body-${locale}`} rows={16} className="font-mono text-[12px]" value={translation.body}
                  onChange={(e) => setForm({ ...form, translations: { ...form.translations, [locale]: { ...translation, body: e.target.value } } })} />
              </Field>
            </div>
          </Panel>

          {/* ------------------------------- BLOCKS ------------------------------- */}
          <Panel>
            <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
              <h2 className="zm-label">Éditeur de blocs</h2>
              <Button size="sm" variant="ghost" onClick={() => setBlocks([...blocks, { kind: 'paragraph', text: '' }])}>
                <Plus className="h-3 w-3" aria-hidden /> bloc
              </Button>
            </div>
            <div className="p-4 space-y-3">
              {blocks.length === 0 && <p className="text-[12px] text-bone-500">Aucun bloc structuré. Le corps Markdown reste la source principale.</p>}
              {blocks.map((block, index) => (
                <div key={index} className="border border-ink-600 rounded-[2px] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[9px] text-bone-600 w-5">{String(index + 1).padStart(2, '0')}</span>
                    <Select value={block.kind} onChange={(e) => updateBlock(index, { kind: e.target.value })}
                      className="max-w-[150px] py-1 text-[11px]" aria-label="Type de bloc">
                      {BLOCK_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </Select>
                    {block.kind === 'heading' && (
                      <Select value={String(block.level ?? 2)} onChange={(e) => updateBlock(index, { level: Number(e.target.value) })}
                        className="max-w-[80px] py-1 text-[11px]" aria-label="Niveau">
                        <option value="2">H2</option><option value="3">H3</option><option value="4">H4</option>
                      </Select>
                    )}
                    <div className="ml-auto flex gap-1">
                      <button onClick={() => moveBlock(index, -1)} className="p-1 text-bone-500 hover:text-bone-100" aria-label="Monter"><ArrowUp className="h-3 w-3" /></button>
                      <button onClick={() => moveBlock(index, 1)} className="p-1 text-bone-500 hover:text-bone-100" aria-label="Descendre"><ArrowDown className="h-3 w-3" /></button>
                      <button onClick={() => setBlocks(blocks.filter((_, i) => i !== index))} className="p-1 text-bone-500 hover:text-alert-300" aria-label="Supprimer">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {block.kind === 'list' ? (
                    <TextArea rows={3} className="text-[12px]" placeholder="Un élément par ligne"
                      value={(block.items ?? []).join('\n')}
                      onChange={(e) => updateBlock(index, { items: e.target.value.split('\n').filter(Boolean) })} />
                  ) : block.kind === 'divider' ? (
                    <p className="font-mono text-[10px] text-bone-600">— séparateur —</p>
                  ) : block.kind === 'image' ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <TextInput placeholder="URL de l’image" value={block.src ?? ''} onChange={(e) => updateBlock(index, { src: e.target.value })} />
                      <TextInput placeholder="Texte alternatif" value={block.alt ?? ''} onChange={(e) => updateBlock(index, { alt: e.target.value })} />
                    </div>
                  ) : (
                    <TextArea rows={block.kind === 'paragraph' ? 3 : 2} className="text-[12px]"
                      value={block.text ?? ''} onChange={(e) => updateBlock(index, { text: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {/* ----------------------------- REVISIONS ----------------------------- */}
          <Panel>
            <div className="border-b border-ink-700 px-4 py-2.5">
              <h2 className="zm-label">Révisions</h2>
            </div>
            {payload.revisions?.length ? (
              <ul className="divide-y divide-ink-800 max-h-64 overflow-y-auto">
                {payload.revisions.map((rev: any) => (
                  <li key={rev.id} className="px-4 py-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-bone-300">{rev.note}</span>
                    <span className="font-mono text-[9.5px] text-bone-500">{formatDateTime(rev.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-3 text-[12px] text-bone-500">Aucune révision.</p>}
          </Panel>
        </div>

        {/* ------------------------------- SIDEBAR ------------------------------- */}
        <div className="space-y-4">
          <Panel className="p-4">
            <h2 className="zm-label mb-3">Workflow</h2>
            <div className="space-y-1.5">
              {allowedTransitions.map((to) => (
                <Button key={to} size="sm" variant={to === 'published' ? 'primary' : 'outline'} className="w-full justify-start"
                  disabled={busy || (to === 'scheduled' && !scheduleAt)}
                  onClick={() => transition(to)}>
                  → {STATUS_LABEL[to]}
                </Button>
              ))}
              {allowedTransitions.length === 0 && <p className="text-[12px] text-bone-500">Aucune transition disponible.</p>}
            </div>
            {allowedTransitions.includes('scheduled') && (
              <div className="mt-3">
                <Field label="Publication planifiée" htmlFor="schedule-at">
                  <TextInput id="schedule-at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                </Field>
              </div>
            )}
            <p className="mt-3 font-mono text-[9px] leading-relaxed text-bone-500">
              Auteur ≠ vérificateur : un auteur ne peut pas publier son propre contenu sans passage outre administrateur.
            </p>

            {canOverride && (
              <div className="mt-4 border-t border-ink-700 pt-3">
                <Checkbox id="override" checked={override.enabled} onChange={(next) => setOverride({ ...override, enabled: next })}
                  label="Passage outre (administrateur)" hint="Tracé dans le journal d’audit, motif obligatoire." />
                {override.enabled && (
                  <div className="mt-2 space-y-2">
                    <Select value={override.to} onChange={(e) => setOverride({ ...override, to: e.target.value })} aria-label="Cible du passage outre">
                      <option value="">Choisir la cible…</option>
                      {['review', 'scheduled', 'published', 'archived', 'deleted', 'draft'].map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </Select>
                    <TextArea rows={2} placeholder="Motif (10 caractères minimum)" value={override.reason}
                      onChange={(e) => setOverride({ ...override, reason: e.target.value })} />
                    <Button size="sm" variant="danger" className="w-full" disabled={!override.to || override.reason.trim().length < 10}
                      onClick={() => transition(override.to, true)}>
                      Appliquer le passage outre
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel className="p-4 space-y-3">
            <h2 className="zm-label">Métadonnées</h2>
            <Field label="Catégorie" htmlFor="meta-category">
              <TextInput id="meta-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ACS" htmlFor="meta-acs">
                <Select id="meta-acs" value={form.acsLevel} onChange={(e) => setForm({ ...form, acsLevel: e.target.value })}>
                  <option value="">—</option>
                  {['none', 'pending', 'safe', 'euclid', 'keter', 'thaumiel'].map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Habilitation" htmlFor="meta-clearance">
                <Select id="meta-clearance" value={form.clearance} onChange={(e) => setForm({ ...form, clearance: e.target.value })}>
                  <option value="">—</option>
                  {['N1', 'N2', 'N3', 'N4', 'N5'].map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Ordre d’affichage" htmlFor="meta-order">
              <TextInput id="meta-order" type="number" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} />
            </Field>
            <Checkbox id="meta-spoiler" checked={form.spoiler} onChange={(next) => setForm({ ...form, spoiler: next })} label="Contient des spoilers" />
            <Checkbox id="meta-featured" checked={form.featured} onChange={(next) => setForm({ ...form, featured: next })} label="Mettre en avant" />
            <Field label="Titre SEO" htmlFor="meta-seo-title">
              <TextInput id="meta-seo-title" value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} />
            </Field>
            <Field label="Description SEO" htmlFor="meta-seo-desc">
              <TextArea id="meta-seo-desc" rows={2} value={form.seoDesc} onChange={(e) => setForm({ ...form, seoDesc: e.target.value })} />
            </Field>
            <Field label="Note éditoriale (interne)" htmlFor="meta-note">
              <TextArea id="meta-note" rows={2} value={form.editorNote} onChange={(e) => setForm({ ...form, editorNote: e.target.value })} />
            </Field>
          </Panel>

          <Panel className="p-4">
            <h2 className="zm-label mb-2">Traçabilité</h2>
            <dl className="space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2"><dt className="text-bone-500">Auteur</dt><dd className="font-mono text-bone-300">{item.authorName ?? '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-bone-500">Vérificateur</dt><dd className="font-mono text-bone-300">{item.verifierName ?? '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-bone-500">Créé</dt><dd className="font-mono text-bone-300">{formatDateTime(item.createdAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-bone-500">Publié</dt><dd className="font-mono text-bone-300">{item.publishedAt ? formatDateTime(item.publishedAt) : '—'}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
