import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Badge, EmptyState, Panel, SectionTitle, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

export default function News() {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<string>('');
  const { data, loading } = useApi<any>(`/api/content/news?locale=${locale}${category ? `&category=${category}` : ''}`, [category]);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§4 — Communication" title={t('news.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-8">{t('news.intro')}</p>

      {data?.categories?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-8">
          <button onClick={() => setCategory('')}
            className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1.5 border rounded-[2px] ${!category ? 'border-alert-500 text-bone-100' : 'border-ink-600 text-bone-400 hover:border-ink-400'}`}>
            {t('label.all')}
          </button>
          {data.categories.map((c: any) => (
            <button key={c.category} onClick={() => setCategory(c.category)}
              className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1.5 border rounded-[2px] ${category === c.category ? 'border-alert-500 text-bone-100' : 'border-ink-600 text-bone-400 hover:border-ink-400'}`}>
              {c.category} <span className="text-bone-500">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? <Spinner /> : !data?.items?.length ? (
        <EmptyState title={t('news.empty')} />
      ) : (
        <div className="space-y-3">
          {data.items.map((item: any) => (
            <Link key={item.slug} to={`/news/${item.slug}`} className="block group">
              <Panel className="p-5 sm:p-6 transition-colors group-hover:border-alert-600">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-center gap-2 sm:w-44 shrink-0">
                    <span className="font-mono text-[10px] text-bone-500">{formatDate(item.publishedAt)}</span>
                    <Badge tone={item.featured ? 'red' : 'neutral'}>{item.category || 'news'}</Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15.5px] group-hover:text-white transition-colors">{item.title}</h3>
                    <p className="mt-1.5 text-[13px] text-bone-400 leading-relaxed">{item.summary}</p>
                    <span className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-alert-400">
                      {t('label.readMore')} <ArrowRight className="h-3 w-3" aria-hidden />
                    </span>
                  </div>
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
