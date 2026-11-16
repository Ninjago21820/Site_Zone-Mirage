import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Markdown } from '../components/Markdown';
import { Badge, EmptyState, LinkButton, Notice, Panel, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

export default function NewsArticle() {
  const { slug } = useParams();
  const { locale, t } = useI18n();
  const { data, loading, error } = useApi<any>(`/api/content/news/${slug}?locale=${locale}`, [slug, locale]);

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Article introuvable" action={<LinkButton to="/news">{t('label.back')}</LinkButton>} />
      </div>
    );
  }

  const item = data.item;
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
      <Link to="/news" className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-bone-500 hover:text-bone-200 mb-8">
        <ArrowLeft className="h-3 w-3" aria-hidden /> {t('nav.news')}
      </Link>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge tone="red">{item.category || 'news'}</Badge>
        <span className="font-mono text-[10.5px] text-bone-500">{formatDate(item.publishedAt, locale)}</span>
        <span className="font-mono text-[10.5px] text-bone-500">· {locale.toUpperCase()}</span>
      </div>
      <h1 className="text-2xl sm:text-3xl leading-tight">{item.title}</h1>
      <p className="mt-4 text-[14px] text-bone-400 leading-relaxed border-l-2 border-ink-600 pl-4">{item.summary}</p>
      <div className="mt-8">
        <Markdown content={item.body} />
      </div>
      <Panel className="mt-10 p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-bone-500">
          {t('app.release')}
        </p>
        <LinkButton to="/support" size="sm" variant="outline">{t('nav.support')}</LinkButton>
      </Panel>
      <Notice tone="info" className="mt-4">
        Cette actualité est un contenu éditorial officiel. Les catégories définitives restent à définir avec la rédaction.
      </Notice>
    </article>
  );
}
