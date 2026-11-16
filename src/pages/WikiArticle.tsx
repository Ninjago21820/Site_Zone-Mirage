import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, FileWarning, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Markdown } from '../components/Markdown';
import { Badge, Button, EmptyState, LinkButton, Notice, Panel, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

function AcsHeader({ level, clearance }: { level?: string | null; clearance?: string | null }) {
  const rows = [
    ['Classe d’objet', '[À définir]'],
    ['Niveau de perturbation', '[À définir]'],
    ['Niveau de risque', '[À définir]'],
    ['Procédures de confinement', '[À définir]'],
  ];
  return (
    <div className="border border-alert-700/60 bg-alert-500/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-alert-700/50 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-alert-300">
          Anomaly Classification System
        </span>
        <div className="flex gap-1.5">
          {level && level !== 'none' && <Badge tone="red">{level === 'pending' ? 'En attente' : level}</Badge>}
          {clearance && <Badge tone="amber">{clearance}</Badge>}
        </div>
      </div>
      <dl className="grid sm:grid-cols-2 divide-y sm:divide-y-0 divide-ink-700">
        {rows.map(([label, value]) => (
          <div key={label} className="px-4 py-3 border-b border-ink-800 last:border-0">
            <dt className="zm-label text-[9.5px]">{label}</dt>
            <dd className="mt-1 font-mono text-[11px] text-signal-400/90">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function WikiArticle() {
  const { slug } = useParams();
  const { t, locale } = useI18n();
  const { data, loading, error } = useApi<any>(`/api/content/wiki/${slug}?locale=${locale}`, [slug, locale]);
  const [revealed, setRevealed] = useState(false);

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Page introuvable" action={<LinkButton to="/wiki">{t('nav.wiki')}</LinkButton>} />
      </div>
    );
  }

  const item = data.item;
  const gated = item.spoiler && !revealed;

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
      <Link to="/wiki" className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-bone-500 hover:text-bone-200 mb-8">
        <ArrowLeft className="h-3 w-3" aria-hidden /> {t('nav.wiki')}
      </Link>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge tone="neutral">{item.category}</Badge>
        {item.clearance && <Badge tone="amber">Habilitation {item.clearance}</Badge>}
        {item.spoiler && <Badge tone="red"><FileWarning className="h-2.5 w-2.5" aria-hidden />{t('label.spoiler')}</Badge>}
        <span className="font-mono text-[10px] text-bone-500">{formatDate(item.publishedAt, locale)}</span>
      </div>
      <h1 className="text-2xl sm:text-3xl leading-tight mb-6">{item.title}</h1>

      <AcsHeader level={item.acsLevel} clearance={item.clearance} />

      {gated ? (
        <Panel className="mt-6 p-6 text-center">
          <FileWarning className="h-6 w-6 text-signal-400 mx-auto mb-3" aria-hidden />
          <p className="text-[13.5px] text-bone-200">{t('wiki.spoilerWarning')}</p>
          <p className="mt-2 text-[12px] text-bone-500 max-w-md mx-auto">
            Le contenu de cette page révèle des éléments de l’intrigue du jeu. Vous pouvez l’afficher explicitement.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => setRevealed(true)}>
            <Eye className="h-3.5 w-3.5" aria-hidden /> {t('label.reveal')}
          </Button>
        </Panel>
      ) : (
        <div className="mt-8">
          <Markdown content={item.body} />
        </div>
      )}

      <div className="mt-12 border-t border-ink-700 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="zm-label mb-1.5">{t('wiki.license')}</p>
            <p className="text-[12px] text-bone-400 max-w-lg leading-relaxed">
              {t('footer.wikiLicense')}
            </p>
            <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-alert-300 hover:text-alert-200">
              CC BY-SA 3.0 ↗
            </a>
          </div>
          <div className="border border-ink-600 px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-500">Source</p>
            <p className="font-mono text-[11px] text-bone-200 mt-0.5">SCP: Mirage Protocol — Wiki</p>
            <p className="font-mono text-[9.5px] text-bone-500 mt-0.5">/wiki/{item.slug}</p>
          </div>
        </div>
      </div>

      {item.availableLocales?.length > 0 && (
        <Notice tone="info" className="mt-6">
          Traductions disponibles : {item.availableLocales.map((l: string) => l.toUpperCase()).join(' · ')}
          {item.availableLocales.length < 5 && ' — les autres langues sont en cours de traduction.'}
        </Notice>
      )}

      {data.related?.length > 0 && (
        <div className="mt-8">
          <p className="zm-label mb-3">Pages liées</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {data.related.map((r: any) => (
              <Link key={r.slug} to={`/wiki/${r.slug}`}>
                <Panel className="p-3 h-full hover:border-alert-600 transition-colors">
                  <p className="text-[12.5px] text-bone-200 leading-snug">{r.title}</p>
                  <p className="font-mono text-[9.5px] text-bone-500 mt-1">{r.category}</p>
                </Panel>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-bone-500">
        <ShieldCheck className="h-3 w-3" aria-hidden /> {t('wiki.teamOnly')}
      </p>
    </article>
  );
}
