import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { LinkButton } from '../components/ui';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-2xl px-4 py-24">
      <div className="border border-ink-600 bg-ink-900/60 p-8 font-mono">
        <p className="text-[11px] uppercase tracking-[0.2em] text-bone-500">SCP://mirage-protocol/erreur</p>
        <p className="mt-3 text-4xl text-alert-500">404</p>
        <h1 className="mt-4 text-lg font-sans">{t('error.notFound')}</h1>
        <p className="mt-2 text-[12.5px] text-bone-400 leading-relaxed font-sans">{t('error.notFoundBody')}</p>
        <p className="mt-4 text-[10.5px] text-bone-600 break-all">{typeof window !== 'undefined' ? window.location.pathname : ''}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton to="/" variant="primary" size="sm">{t('nav.home')}</LinkButton>
          <LinkButton to="/wiki" variant="outline" size="sm">{t('nav.wiki')}</LinkButton>
          <Link to="/support" className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-bone-400 hover:text-bone-100">
            {t('nav.support')}
          </Link>
        </div>
      </div>
    </div>
  );
}
