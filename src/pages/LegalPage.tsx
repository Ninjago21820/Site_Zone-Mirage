import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Markdown } from '../components/Markdown';
import { EmptyState, LinkButton, Notice, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

const PAGES = [
  ['mentions-legales', 'Mentions légales'],
  ['politique-confidentialite', 'Politique de confidentialité (RGPD)'],
  ['cookies', 'Cookies'],
  ['cgu', 'Conditions générales d’utilisation'],
  ['licence-cc-by-sa', 'Licence CC BY-SA 3.0'],
];

export default function LegalPage() {
  const { slug } = useParams();
  const { locale, t } = useI18n();
  const { data, loading, error } = useApi<any>(`/api/legal/${slug}?locale=${locale}`, [slug, locale]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_240px] items-start">
        <div>
          {loading ? <Spinner /> : error || !data ? (
            <EmptyState title="Page introuvable" action={<LinkButton to="/">{t('label.back')}</LinkButton>} />
          ) : (
            <>
              <Link to="/" className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-bone-500 hover:text-bone-200 mb-6">
                <ArrowLeft className="h-3 w-3" aria-hidden /> {t('nav.home')}
              </Link>
              <p className="zm-label mb-2">{t('nav.legal')}</p>
              <h1 className="text-2xl mb-2">{data.item.title}</h1>
              <p className="font-mono text-[10px] text-bone-500 mb-6">Mise à jour : {formatDate(data.item.updatedAt, locale)}</p>
              <Notice tone="warn" className="mb-6">{t('legal.placeholder')}</Notice>
              <Markdown content={data.item.body} />
            </>
          )}
        </div>
        <aside className="lg:sticky lg:top-24">
          <p className="zm-label mb-3">{t('legal.title')}</p>
          <ul className="space-y-1">
            {PAGES.map(([pageSlug, label]) => (
              <li key={pageSlug}>
                <Link to={`/legal/${pageSlug}`}
                  className={`block px-2 py-1.5 text-[12px] rounded-[2px] ${slug === pageSlug ? 'bg-ink-800 text-bone-100' : 'text-bone-400 hover:bg-ink-850'}`}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
