import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Map as MapIcon, Server, Trophy, TriangleAlert, UserPlus } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { Badge, LinkButton, Notice, Panel, SectionTitle, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

interface SiteResponse {
  site: { name: string; version: string; releaseLabel: string; tagline: string };
  latestNews: { slug: string; title: string; summary: string; publishedAt: number; category: string }[];
}

export default function Home() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { data: site } = useApi<SiteResponse>('/api/site');
  const { data: stats } = useApi<any>('/api/stats/global');
  const { data: servers } = useApi<any>('/api/servers');

  return (
    <div>
      {/* ---------------------------------- HERO ---------------------------------- */}
      <section className="relative overflow-hidden border-b border-ink-700 zm-grid-bg">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_-10%,rgba(225,29,46,0.16),transparent_55%)]" />
        <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6 py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1.25fr_0.75fr] items-start">
            <div className="zm-rise">
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <Badge tone="red">
                  <span className="h-1.5 w-1.5 rounded-full bg-alert-400 zm-pulse-dot" aria-hidden />
                  {t('app.inDevelopment')}
                </Badge>
                <Badge tone="neutral">{t('app.release')}</Badge>
                <Badge tone="neutral">PC</Badge>
              </div>
              <p className="zm-label mb-3 text-alert-400">{t('home.heroKicker')}</p>
              <h1 className="text-3xl sm:text-[2.9rem] sm:leading-[1.06] font-semibold tracking-tight max-w-2xl">
                {t('home.heroTitle')}
              </h1>
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-bone-400">
                {t('home.heroBody')}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton to="/wiki" variant="primary" size="lg">
                  <BookOpen className="h-4 w-4" aria-hidden /> {t('nav.wiki')}
                </LinkButton>
                <LinkButton to="/map" variant="outline" size="lg">
                  <MapIcon className="h-4 w-4" aria-hidden /> {t('nav.map')}
                </LinkButton>
                <LinkButton to="/roadmap" variant="ghost" size="lg">
                  {t('nav.roadmap')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </LinkButton>
                {!me.authenticated && (
                  <LinkButton to="/register" variant="outline" size="lg">
                    <UserPlus className="h-4 w-4" aria-hidden /> {t('home.createAccount')}
                  </LinkButton>
                )}
              </div>
              {!me.authenticated && (
                <p className="mt-3 text-[12px] text-bone-500 max-w-xl">{t('home.createAccountBody')}</p>
              )}
              <p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-bone-500">
                {t('home.noRelease')}
              </p>
            </div>

            <Panel className="overflow-hidden zm-rise">
              <div className="border-b border-ink-600 bg-ink-850 px-4 py-2.5 flex items-center justify-between">
                <span className="zm-label">Fiche technique</span>
                <span className="font-mono text-[10px] text-bone-500">v{site?.site.version ?? '1.3'}</span>
              </div>
              <dl className="divide-y divide-ink-800 text-[12.5px]">
                {[
                  ['Plateforme', 'PC'],
                  ['Modes', 'Histoire · Multijoueur'],
                  ['Carte', 'Zone Mirage (unique)'],
                  ['Sortie', site?.site.releaseLabel ?? t('app.release')],
                  ['Launcher', 'Aucun launcher sur ce site'],
                  ['Paiement', 'Aucun paiement sur ce site'],
                  ['Langues du site', 'FR · EN — ES/DE/IT en cours'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <dt className="zm-label text-[10px] shrink-0">{label}</dt>
                    <dd className="text-right text-bone-300 font-mono text-[11px]">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-ink-600 px-4 py-3 bg-ink-900/60">
                <div className="flex items-center gap-2 text-[11px] text-bone-500">
                  <TriangleAlert className="h-3.5 w-3.5 text-signal-400" aria-hidden />
                  Données de substitution. Aucun élément de lore définitif n’est inventé.
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </section>

      {/* ---------------------------------- MODES --------------------------------- */}
      <section className="mx-auto max-w-[1240px] px-4 sm:px-6 py-16">
        <SectionTitle kicker="§2 — Périmètre du jeu" title={t('home.modesTitle')} />
        <div className="grid gap-5 md:grid-cols-2">
          {[
            { title: t('home.story'), body: t('home.storyBody'), icon: BookOpen, tag: 'Solo', note: 'Grâce hors ligne proposée : 7 jours' },
            { title: t('home.multiplayer'), body: t('home.multiplayerBody'), icon: Server, tag: 'En ligne', note: 'Tickets de session à usage unique' },
          ].map((mode) => (
            <Panel key={mode.title} className="p-6 group hover:border-ink-400 transition-colors">
              <div className="flex items-start justify-between">
                <span className="grid place-items-center h-10 w-10 border border-ink-600 bg-ink-850">
                  <mode.icon className="h-5 w-5 text-alert-400" aria-hidden />
                </span>
                <Badge tone="neutral">{mode.tag}</Badge>
              </div>
              <h3 className="mt-5 text-lg">{mode.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-bone-400">{mode.body}</p>
              <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-bone-500">{mode.note}</p>
            </Panel>
          ))}
        </div>
      </section>

      {/* ---------------------------------- NEWS ---------------------------------- */}
      <section className="border-y border-ink-700 bg-ink-900/40">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-16">
          <SectionTitle
            kicker="§4 — Actualités"
            title={t('home.latestNews')}
            action={<LinkButton to="/news" size="sm">{t('label.viewAll')} <ArrowRight className="h-3 w-3" aria-hidden /></LinkButton>}
          />
          {!site ? (
            <Spinner />
          ) : (
            <div className="grid gap-5 md:grid-cols-3">
              {site.latestNews.slice(0, 3).map((item) => (
                <Link key={item.slug} to={`/news/${item.slug}`} className="group block">
                  <Panel className="h-full p-5 transition-colors group-hover:border-alert-600">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge tone="red">{item.category || 'news'}</Badge>
                      <span className="font-mono text-[10px] text-bone-500">{formatDate(item.publishedAt)}</span>
                    </div>
                    <h3 className="text-[15px] leading-snug group-hover:text-white">{item.title}</h3>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-bone-400 line-clamp-3">{item.summary}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-alert-400">
                      {t('label.readMore')} <ArrowRight className="h-3 w-3" aria-hidden />
                    </span>
                  </Panel>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* --------------------------------- METRICS -------------------------------- */}
      <section className="mx-auto max-w-[1240px] px-4 sm:px-6 py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionTitle kicker="§5.7 — Statistiques publiques" title={t('home.numbers')} />
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Joueurs inscrits', stats?.players],
                ['Serveurs actifs', stats?.servers],
                ['Pages de wiki', stats?.wikiPages],
                ['Actualités publiées', stats?.news],
              ].map(([label, value]) => (
                <Panel key={String(label)} className="p-4">
                  <p className="font-mono text-2xl text-bone-100 tabular-nums">{value ?? '—'}</p>
                  <p className="zm-label mt-1 text-[9.5px]">{label}</p>
                </Panel>
              ))}
            </div>
            <Notice tone="warn" className="mt-4">
              {t('home.numbers')} — {t('lb.syncNote')}
            </Notice>
          </div>

          <div>
            <SectionTitle
              kicker="§7 — Serveurs communautaires"
              title={t('home.serverSpotlight')}
              action={<LinkButton to="/servers" size="sm">{t('label.viewAll')}</LinkButton>}
            />
            <div className="space-y-2.5">
              {(servers?.featured ?? []).slice(0, 3).map((server: any, index: number) => (
                <Panel key={server.id} className="p-3.5 flex items-center gap-4">
                  <span className="font-mono text-lg text-ink-400 tabular-nums w-6">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13.5px] text-bone-100 truncate">{server.name}</p>
                      {server.featured && <Badge tone="red">Nouveau</Badge>}
                    </div>
                    <p className="font-mono text-[10.5px] text-bone-500 mt-0.5">{server.address} · {server.region || '—'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[13px] text-bone-200 tabular-nums">{server.currentPlayers}/{server.maxPlayers}</p>
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500">{server.maintenance ? 'maintenance' : t('servers.online')}</p>
                  </div>
                </Panel>
              ))}
              {!servers?.featured?.length && <p className="text-[13px] text-bone-500">Aucun serveur publié.</p>}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link to="/leaderboards" className="group">
                <Panel className="p-4 flex items-center gap-3 group-hover:border-alert-600 transition-colors">
                  <Trophy className="h-4 w-4 text-signal-400" aria-hidden />
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{t('nav.leaderboards')}</span>
                </Panel>
              </Link>
              <Link to="/support" className="group">
                <Panel className="p-4 flex items-center gap-3 group-hover:border-alert-600 transition-colors">
                  <Server className="h-4 w-4 text-alert-400" aria-hidden />
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{t('nav.support')}</span>
                </Panel>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------- CTA STRIP ------------------------------- */}
      <section className="border-t border-ink-700 bg-ink-900/50">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="zm-label mb-1.5">§10 — Wiki officiel</p>
            <h2 className="text-xl">{t('wiki.intro')}</h2>
            <p className="mt-2 text-[13px] text-bone-400 max-w-xl">{t('wiki.teamOnly')}</p>
          </div>
          <LinkButton to="/wiki" variant="primary" size="lg">
            {t('nav.wiki')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </LinkButton>
        </div>
      </section>
    </div>
  );
}
