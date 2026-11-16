import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileWarning, Search, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi, useDebounced } from '../lib/useApi';
import { Badge, EmptyState, Panel, SectionTitle, Spinner, TextInput } from '../components/ui';
import { formatDate } from '../lib/format';

export default function Wiki() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const debounced = useDebounced(query, 280);
  const search = useApi<any>(debounced.length >= 2 ? `/api/wiki/search?q=${encodeURIComponent(debounced)}&locale=${locale}` : null, [debounced, locale]);
  const list = useApi<any>(`/api/content/wiki?locale=${locale}${category ? `&category=${category}` : ''}`, [category, locale]);

  const items = debounced.length >= 2 ? search.data?.results : list.data?.items;
  const loading = debounced.length >= 2 ? search.loading : list.loading;

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§10 — Base de connaissances" title={t('wiki.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('wiki.intro')}</p>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px] items-start">
        <div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bone-500" aria-hidden />
            <TextInput
              className="pl-9"
              placeholder={t('wiki.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('label.search')}
              type="search"
            />
          </div>

          {loading ? <Spinner /> : !items?.length ? (
            <EmptyState title={t('wiki.noResults')} body={t('wiki.teamOnly')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item: any) => (
                <Link key={item.slug} to={`/wiki/${item.slug}`} className="group">
                  <Panel className="h-full p-4 transition-colors group-hover:border-alert-600">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {item.acsLevel && item.acsLevel !== 'none' && <Badge tone="red">ACS {item.acsLevel}</Badge>}
                      {item.clearance && <Badge tone="amber">{item.clearance}</Badge>}
                      {item.spoiler && <Badge tone="neutral"><FileWarning className="h-2.5 w-2.5" aria-hidden />{t('label.spoiler')}</Badge>}
                    </div>
                    <h3 className="text-[14.5px] leading-snug group-hover:text-white">{item.title}</h3>
                    <p className="mt-1.5 text-[12.5px] text-bone-400 leading-relaxed line-clamp-3">
                      {item.excerpt ?? item.summary}
                    </p>
                    <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500">
                      {item.category} {item.publishedAt ? `· ${formatDate(item.publishedAt, locale)}` : ''}
                    </p>
                  </Panel>
                </Link>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Panel className="p-4">
            <p className="zm-label mb-3">{t('wiki.categories')}</p>
            <div className="space-y-1">
              <button onClick={() => setCategory('')}
                className={`w-full text-left px-2 py-1.5 rounded-[2px] font-mono text-[11px] ${!category ? 'bg-ink-800 text-bone-100' : 'text-bone-400 hover:bg-ink-850'}`}>
                {t('label.all')}
              </button>
              {(list.data?.categories ?? []).map((c: any) => (
                <button key={c.category} onClick={() => setCategory(c.category)}
                  className={`w-full text-left px-2 py-1.5 rounded-[2px] font-mono text-[11px] flex justify-between ${category === c.category ? 'bg-ink-800 text-bone-100' : 'text-bone-400 hover:bg-ink-850'}`}>
                  <span>{c.category}</span><span className="text-bone-500">{c.count}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-alert-400" aria-hidden />
              <p className="zm-label">Rédaction</p>
            </div>
            <p className="text-[12px] leading-relaxed text-bone-400">{t('wiki.teamOnly')}</p>
            <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500">Licence CC BY-SA 3.0</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
