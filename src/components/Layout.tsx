import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X, ShieldCheck, User, LogOut, LayoutDashboard, ChevronDown, ScanLine, Languages, Lock } from 'lucide-react';
import { useI18n, MASKED_LOCALES, CROWDIN_URL, type Locale } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { cx } from '../lib/format';
import { Badge, Button, LinkButton, Modal } from './ui';

const NAV = [
  { key: 'nav.home', to: '/' },
  { key: 'nav.news', to: '/news' },
  { key: 'nav.roadmap', to: '/roadmap' },
  { key: 'nav.map', to: '/map' },
  { key: 'nav.wiki', to: '/wiki' },
  { key: 'nav.store', to: '/store' },
  { key: 'nav.servers', to: '/servers' },
  { key: 'nav.leaderboards', to: '/leaderboards' },
  { key: 'nav.faq', to: '/faq' },
  { key: 'nav.support', to: '/support' },
];

function useScanlines() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('zm.scanlines') !== 'off';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('zm-no-scanlines', !enabled);
    try {
      localStorage.setItem('zm.scanlines', enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, [enabled]);
  return { enabled, toggle: () => setEnabled((v) => !v) };
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3 group" aria-label="SCP: Mirage Protocol — accueil">
      <span className="relative grid place-items-center h-9 w-9 border border-alert-600 bg-alert-500/10 shrink-0">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="none" stroke="#ff3b4a" strokeWidth="1.4" />
          <circle cx="12" cy="12" r="3.1" fill="#e11d2e" />
          <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="#ff3b4a" strokeWidth="1.1" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block font-mono text-[10px] tracking-[0.3em] text-alert-400">SCP</span>
        <span className="block font-semibold text-[15px] tracking-tight text-bone-100 group-hover:text-white">MIRAGE PROTOCOL</span>
      </span>
    </Link>
  );
}

function LanguageMenu() {
  const { locale, setLocale, t, showMaskedNotice } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-bone-400 hover:text-bone-100"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label.language')}
      >
        <Languages className="h-3.5 w-3.5" aria-hidden />
        {locale.toUpperCase()}
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 zm-panel rounded-[2px] p-1.5 z-[75]" role="menu">
          <p className="zm-label px-2 py-1.5">{t('label.language')}</p>
          {(['fr', 'en'] as Locale[]).map((code) => (
            <button
              key={code}
              role="menuitemradio"
              aria-checked={locale === code}
              onClick={() => { setLocale(code); setOpen(false); }}
              className={cx('w-full text-left px-2 py-1.5 text-[13px] rounded-[2px] flex items-center justify-between',
                locale === code ? 'bg-ink-800 text-bone-100' : 'text-bone-300 hover:bg-ink-800')}
            >
              {code === 'fr' ? 'Français' : 'English'}
              {locale === code && <span className="text-alert-400 font-mono text-[10px]">ACTIF</span>}
            </button>
          ))}
          <div className="my-1.5 zm-hairline" />
          {MASKED_LOCALES.map((entry) => (
            <button
              key={entry.code}
              role="menuitem"
              onClick={() => { showMaskedNotice(entry.label, entry.progress); setOpen(false); }}
              className="w-full text-left px-2 py-1.5 text-[13px] text-bone-500 hover:bg-ink-800 flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2"><Lock className="h-3 w-3" aria-hidden />{entry.label}</span>
              <span className="font-mono text-[10px]">{Math.round(entry.progress * 100)}%</span>
            </button>
          ))}
          <p className="px-2 py-1.5 text-[10px] text-bone-500 leading-snug">
            {t('masked.body')}
          </p>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const { me, logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!me.authenticated) {
    return (
      <LinkButton to="/login" size="sm" variant="primary" className="hidden sm:inline-flex">
        <User className="h-3 w-3" aria-hidden /> {t('nav.login')}
      </LinkButton>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border border-ink-600 px-2.5 py-1.5 rounded-[2px] hover:border-ink-400"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 zm-pulse-dot" aria-hidden />
        <span className="font-mono text-[11px] text-bone-200 max-w-[9rem] truncate">{me.username}</span>
        <ChevronDown className="h-3 w-3 text-bone-500" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 zm-panel rounded-[2px] p-1.5 z-[75]" role="menu">
          <div className="px-2 py-2 border-b border-ink-700 mb-1">
            <p className="font-mono text-[10px] text-bone-500 truncate">{me.mirageId}</p>
            <p className="text-[12px] text-bone-300 mt-0.5">{t('account.title')}</p>
          </div>
          <Link to="/account" role="menuitem" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2 py-2 text-[13px] text-bone-300 hover:bg-ink-800 rounded-[2px]">
            <User className="h-3.5 w-3.5" aria-hidden /> {t('account.title')}
          </Link>
          {me.mirageId && (
            <Link to={`/profile/${me.mirageId}`} role="menuitem" onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-2 text-[13px] text-bone-300 hover:bg-ink-800 rounded-[2px]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t('profile.title')}
            </Link>
          )}
          {me.staff && (
            <Link to="/console-mirage" role="menuitem" onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-2 text-[13px] text-bone-300 hover:bg-ink-800 rounded-[2px]">
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden /> {t('nav.backoffice')}
            </Link>
          )}
          <div className="my-1 zm-hairline" />
          <button role="menuitem" onClick={() => { void logout(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-2 py-2 text-[13px] text-alert-300 hover:bg-alert-500/10 rounded-[2px]">
            <LogOut className="h-3.5 w-3.5" aria-hidden /> {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function MaskedLanguageModal() {
  const { maskedNotice, clearMaskedNotice, t } = useI18n();
  return (
    <Modal open={!!maskedNotice} onClose={clearMaskedNotice} title={t('masked.title')}>
      <div className="space-y-4">
        <p className="text-[13px] text-bone-300 leading-relaxed">{t('masked.body')}</p>
        {maskedNotice && (
          <div className="border border-ink-600 rounded-[2px] p-3">
            <div className="flex justify-between font-mono text-[11px] mb-2">
              <span className="text-bone-200">{maskedNotice.label}</span>
              <span className="text-signal-400">{Math.round(maskedNotice.progress * 100)}%</span>
            </div>
            <div className="h-1.5 bg-ink-800 overflow-hidden">
              <div className="h-full bg-signal-500" style={{ width: `${Math.max(3, maskedNotice.progress * 100)}%` }} />
            </div>
            <p className="text-[10px] text-bone-500 mt-2 font-mono">Seuil de publication : 85 %</p>
          </div>
        )}
        <a href={CROWDIN_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-alert-300 hover:text-alert-200">
          {t('masked.help')} ↗
        </a>
      </div>
    </Modal>
  );
}

export function Ticker() {
  const items = [
    'EN DÉVELOPPEMENT — DATE DE SORTIE NON ANNONCÉE',
    'AUCUN LAUNCHER · AUCUN PAIEMENT SUR CE SITE',
    'SERVEURS COMMUNAUTAIRES : 3 MAXIMUM PAR COMPTE',
    'WIKI SOUS LICENCE CC BY-SA 3.0',
    'DOUBLE AUTHENTIFICATION OBLIGATOIRE POUR LE PERSONNEL',
  ];
  const content = items.join('   ///   ');
  return (
    <div className="border-y border-ink-700 bg-ink-900/80 overflow-hidden">
      <div className="flex whitespace-nowrap py-1.5 zm-ticker">
        {[0, 1].map((i) => (
          <span key={i} className="font-mono text-[10px] tracking-[0.22em] text-bone-500 pr-8" aria-hidden={i === 1}>
            {content}   ///   {content}   ///   
          </span>
        ))}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const { enabled, toggle } = useScanlines();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-ink-950 zm-scanlines">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[90] focus:left-4 focus:top-4 focus:bg-alert-500 focus:text-white focus:px-4 focus:py-2">
        Aller au contenu principal
      </a>
      <div className="h-[2px] bg-gradient-to-r from-alert-600 via-alert-500 to-transparent" />
      <header className="sticky top-0 z-[65] border-b border-ink-700 bg-ink-950/92 backdrop-blur">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <Logo />
            <nav className="hidden xl:flex items-center gap-0.5" aria-label="Navigation principale">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cx(
                    'px-2.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors border-b border-transparent',
                    isActive ? 'text-bone-100 border-alert-500' : 'text-bone-400 hover:text-bone-100',
                  )}
                >
                  {t(item.key)}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggle}
                aria-pressed={enabled}
                title={t('label.scanlines')}
                className={cx('hidden sm:flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] border rounded-[2px]',
                  enabled ? 'border-alert-600 text-alert-300' : 'border-ink-600 text-bone-500')}
              >
                <ScanLine className="h-3.5 w-3.5" aria-hidden />
                {enabled ? 'CRT' : 'OFF'}
              </button>
              <LanguageMenu />
              <AccountMenu />
              <button
                onClick={() => setMobileOpen((v) => !v)}
                className="xl:hidden p-2 text-bone-300 hover:text-bone-100"
                aria-label={mobileOpen ? t('nav.closeMenu') : t('nav.openMenu')}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
        {mobileOpen && (
          <div className="xl:hidden border-t border-ink-700 bg-ink-950">
            <nav className="mx-auto max-w-[1240px] px-4 py-3 grid grid-cols-2 gap-1" aria-label="Navigation mobile">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'}
                  className={({ isActive }) => cx('px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] rounded-[2px]',
                    isActive ? 'bg-ink-800 text-bone-100' : 'text-bone-400 hover:bg-ink-850')}>
                  {t(item.key)}
                </NavLink>
              ))}
              {!me.authenticated && (
                <Link to="/login" className="px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-alert-300">
                  {t('nav.login')}
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>
      <Ticker />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-ink-700 bg-ink-900/60 mt-16">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 text-[12px] leading-relaxed text-bone-500 max-w-xs">
              {t('footer.built')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="red">{t('app.inDevelopment')}</Badge>
              <Badge tone="neutral">PC</Badge>
            </div>
          </div>
          <div>
            <p className="zm-label mb-3">{t('nav.home')}</p>
            <ul className="space-y-1.5 text-[12.5px]">
              {[['/news', 'nav.news'], ['/roadmap', 'nav.roadmap'], ['/map', 'nav.map'], ['/wiki', 'nav.wiki'], ['/servers', 'nav.servers'], ['/leaderboards', 'nav.leaderboards']].map(([to, key]) => (
                <li key={to}><Link to={to} className="text-bone-400 hover:text-bone-100">{t(key)}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="zm-label mb-3">{t('nav.legal')}</p>
            <ul className="space-y-1.5 text-[12.5px]">
              {[
                ['/legal/mentions-legales', 'footer.legal'],
                ['/legal/politique-confidentialite', 'footer.privacy'],
                ['/legal/cookies', 'footer.cookies'],
                ['/legal/cgu', 'footer.terms'],
                ['/legal/licence-cc-by-sa', 'footer.license'],
              ].map(([to, key]) => (
                <li key={to}><Link to={to} className="text-bone-400 hover:text-bone-100">{t(key)}</Link></li>
              ))}
              <li><Link to="/maintenance" className="text-bone-400 hover:text-bone-100">{t('nav.maintenance')}</Link></li>
              <li><Link to="/support" className="text-bone-400 hover:text-bone-100">{t('nav.support')}</Link></li>
            </ul>
          </div>
          <div>
            <p className="zm-label mb-3">{t('label.language')}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">FR</Badge>
              <Badge tone="neutral">EN</Badge>
              {MASKED_LOCALES.map((l) => (
                <span key={l.code} className="inline-flex items-center gap-1 border border-ink-600 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-500">
                  <Lock className="h-2.5 w-2.5" aria-hidden />{l.code}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-bone-500">
              {t('footer.wikiLicense')}
            </p>
            <a href={CROWDIN_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-alert-300 hover:text-alert-200">
              Crowdin ↗
            </a>
          </div>
        </div>
        <div className="border-t border-ink-800">
          <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="font-mono text-[10px] tracking-[0.14em] text-bone-500 uppercase">
              © {new Date().getFullYear()} SCP: Mirage Protocol — site officiel
            </p>
            <p className="font-mono text-[10px] tracking-[0.14em] text-bone-500 uppercase">
              {t('app.release')} · v1.3
            </p>
          </div>
        </div>
      </footer>
      <MaskedLanguageModal />
    </div>
  );
}

export { useScanlines };
