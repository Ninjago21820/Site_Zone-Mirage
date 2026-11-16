import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Markdown } from '../components/Markdown';
import { Badge, Notice, Panel, SectionTitle, Spinner } from '../components/ui';

const STATUS_TONE: Record<string, 'red' | 'amber' | 'green' | 'neutral'> = {
  in_progress: 'red',
  planned: 'neutral',
  done: 'green',
  blocked: 'amber',
};
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'En cours',
  planned: 'Planifié',
  done: 'Terminé',
  blocked: 'Bloqué',
};

export default function Roadmap() {
  const { t, locale } = useI18n();
  const { data, loading } = useApi<any>(`/api/content/roadmap?locale=${locale}`, [locale]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§4 — Développement" title={t('roadmap.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('roadmap.intro')}</p>
      <Notice tone="warn" className="mb-10">
        Aucune date de sortie n’est annoncée. Les jalons ci-dessous décrivent l’avancement du développement, sans engagement de calendrier.
      </Notice>

      {loading ? <Spinner /> : (
        <ol className="relative border-l border-ink-600 ml-2 space-y-8">
          {data?.items?.map((item: any, index: number) => (
            <li key={item.slug} className="pl-6 sm:pl-8 relative">
              <span
                className={`absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full border ${
                  item.category === 'done' ? 'bg-emerald-500 border-emerald-400'
                  : item.category === 'in_progress' ? 'bg-alert-500 border-alert-400'
                  : 'bg-ink-700 border-ink-500'
                }`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-mono text-[10px] text-bone-500">J{index + 1}</span>
                <h3 className="text-[15px]">{item.title}</h3>
                <Badge tone={STATUS_TONE[item.category] ?? 'neutral'}>
                  {STATUS_LABEL[item.category] ?? item.category}
                </Badge>
              </div>
              <Panel className="mt-2 p-4">
                <p className="text-[13px] text-bone-400 leading-relaxed">{item.summary}</p>
                <details className="mt-3 group">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-bone-500 hover:text-bone-200 list-none">
                    Détail du jalon <span className="text-alert-400">+</span>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-ink-700">
                    <Markdown content={item.body} />
                  </div>
                </details>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
