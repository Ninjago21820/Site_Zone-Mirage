import { useParams } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Badge, EmptyState, LinkButton, Notice, Panel, SectionTitle, Spinner } from '../components/ui';
import { duration, formatDate, playtime } from '../lib/format';

const SOCIAL_LABELS: Record<string, string> = {
  discord: 'Discord', steam: 'Steam', epic: 'Epic Games', google: 'Google',
  youtube: 'YouTube', twitch: 'Twitch', x: 'X',
};

export default function Profile() {
  const { mirageId } = useParams();
  const { t, locale } = useI18n();
  const { data, loading, error } = useApi<any>(`/api/profile/${encodeURIComponent(mirageId ?? '')}`, [mirageId]);

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <EmptyState title={t('error.notFound')} body="Ce Mirage ID n’existe pas ou le compte a été supprimé."
          action={<LinkButton to="/" variant="primary">{t('nav.home')}</LinkButton>} />
      </div>
    );
  }

  const profile = data.profile;
  const stats = data.stats ?? [];
  const socials = data.socials ?? null;
  const story = stats.filter((s: any) => s.mode === 'story');
  const multiplayer = stats.filter((s: any) => s.mode === 'multiplayer');

  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="zm-label mb-2">{t('profile.title')}</p>
          <h1 className="text-2xl">{profile.username}</h1>
          <p className="font-mono text-[11.5px] text-bone-500 mt-1">{profile.mirageId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile.restricted ? <Badge tone="neutral"><Lock className="h-2.5 w-2.5" aria-hidden />{t('label.private')}</Badge>
            : <Badge tone="green">{t('label.public')}</Badge>}
          {profile.role && <Badge tone="neutral">{profile.role}</Badge>}
          {profile.createdAt && <span className="font-mono text-[10px] text-bone-500">membre depuis {formatDate(profile.createdAt, locale)}</span>}
        </div>
      </div>

      {profile.restricted ? (
        <Notice tone="info" title={t('profile.privateNotice')}>
          <p>
            Le pseudonyme et le Mirage ID restent toujours visibles. Les statistiques, la présentation et les liens
            sociaux ne sont affichés que si la personne rend son profil public.
          </p>
        </Notice>
      ) : (
        <>
          {profile.bio && (
            <Panel className="p-5 mb-5">
              <p className="zm-label mb-2">{t('account.bio')}</p>
              <p className="text-[13px] text-bone-300 leading-relaxed whitespace-pre-line">{profile.bio}</p>
            </Panel>
          )}

          {socials && Object.keys(socials).length > 0 && (
            <Panel className="p-5 mb-5">
              <p className="zm-label mb-3">{t('account.socials')}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(socials).map(([key, value]) => (
                  <a key={key} href={String(value)} target="_blank" rel="noopener noreferrer nofollow"
                    className="border border-ink-600 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-bone-300 hover:border-alert-500 hover:text-bone-100">
                    {SOCIAL_LABELS[key] ?? key} ↗
                  </a>
                ))}
              </div>
            </Panel>
          )}

          <SectionTitle kicker="§5.7 — Statistiques publiques" title={t('account.stats')} />
          {stats.length === 0 ? (
            <EmptyState title="Aucune statistique publiée." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Panel className="p-4">
                  <p className="font-mono text-xl text-bone-100">{playtime(story.reduce((a: number, s: any) => a + s.playtimeMs, 0))}</p>
                  <p className="zm-label mt-1 text-[9.5px]">{t('account.playtimeStory')}</p>
                </Panel>
                <Panel className="p-4">
                  <p className="font-mono text-xl text-bone-100">{playtime(multiplayer.reduce((a: number, s: any) => a + s.playtimeMs, 0))}</p>
                  <p className="zm-label mt-1 text-[9.5px]">{t('account.playtimeMp')}</p>
                </Panel>
                <Panel className="p-4">
                  <p className="font-mono text-xl text-bone-100">{story.reduce((a: number, s: any) => a + s.deaths, 0)}</p>
                  <p className="zm-label mt-1 text-[9.5px]">{t('account.totalDeaths')}</p>
                </Panel>
              </div>

              <Panel>
                <div className="border-b border-ink-700 px-4 py-2.5 flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-alert-400" aria-hidden />
                  <h3 className="zm-label">Détail par opération</h3>
                </div>
                <ul className="divide-y divide-ink-800">
                  {stats.map((row: any, index: number) => (
                    <li key={index} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <span className="font-mono text-[11.5px] text-bone-200 w-20">{row.operation}</span>
                      <Badge tone="neutral">{row.mode}</Badge>
                      {row.ending && <span className="font-mono text-[10px] text-bone-500">{row.ending}</span>}
                      <span className="ml-auto font-mono text-[10.5px] text-bone-500">{row.deaths} morts</span>
                      <span className="font-mono text-[11.5px] text-bone-100 tabular-nums">
                        {row.bestTimeMs ? duration(row.bestTimeMs) : `${playtime(row.playtimeMs)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}
          <p className="mt-4 font-mono text-[9.5px] text-bone-500">{t('lb.syncNote')}</p>
        </>
      )}
    </div>
  );
}
