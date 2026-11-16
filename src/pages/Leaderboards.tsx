import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Badge, EmptyState, Notice, Panel, SectionTitle, Spinner, Tabs } from '../components/ui';
import { cx, duration } from '../lib/format';

type Mode = 'story' | 'multiplayer';
type Tab = 'operations' | 'endings' | 'score' | 'deaths';

export default function Leaderboards() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('story');
  const [tab, setTab] = useState<Tab>('operations');
  const { data, loading } = useApi<any>(`/api/leaderboards?mode=${mode}`, [mode]);

  const bestTimes = data?.bestTimes ?? [];
  const endings = data?.byEnding ?? [];

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§5.7 — Statistiques validées côté serveur" title={t('lb.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('lb.intro')}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1.5">
          {(['story', 'multiplayer'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={cx('font-mono text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 border rounded-[2px]',
                mode === m ? 'border-alert-500 text-bone-100 bg-alert-500/10' : 'border-ink-600 text-bone-400 hover:border-ink-400')}>
              {m === 'story' ? t('lb.storyMode') : t('lb.multiplayerMode')}
            </button>
          ))}
        </div>
        <Badge tone="neutral">{t('lb.syncNote')}</Badge>
      </div>

      {loading ? <Spinner /> : mode === 'multiplayer' ? (
        <Panel>
          <div className="border-b border-ink-700 px-4 py-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-signal-400" aria-hidden />
            <h3 className="text-sm">{t('lb.multiplayerMode')}</h3>
          </div>
          {(data?.byScore ?? []).length === 0 ? <EmptyState title={t('wiki.noResults')} /> : (
            <ul className="divide-y divide-ink-800">
              {data.byScore.map((entry: any, index: number) => (
                <li key={`${entry.displayName}-${index}`} className="flex items-center gap-4 px-4 py-2.5">
                  <span className="font-mono text-[11px] text-ink-400 w-6 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-[13px] text-bone-200 truncate">{entry.displayName}</span>
                  <span className="font-mono text-[10.5px] text-bone-500">{entry.reputation} rép.</span>
                  <span className="font-mono text-[12px] text-bone-100 tabular-nums">{entry.score}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 py-3 border-t border-ink-800 font-mono text-[10px] text-bone-500">
            Le mode Multijoueur ne suit que le temps de jeu et la réputation.
          </p>
        </Panel>
      ) : (
        <>
          <Tabs
            tabs={[
              { id: 'operations' as Tab, label: t('lb.byOperation'), count: bestTimes.length },
              { id: 'endings' as Tab, label: t('lb.byEnding'), count: endings.length },
              { id: 'score' as Tab, label: t('lb.byScore') },
              { id: 'deaths' as Tab, label: t('lb.deaths') },
            ]}
            value={tab}
            onChange={setTab}
            className="mb-5"
          />

          {tab === 'operations' && (
            <div className="space-y-5">
              {bestTimes.length === 0 && <EmptyState title="Aucun temps enregistré." />}
              {bestTimes.map((group: any) => (
                <Panel key={group.operation}>
                  <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
                    <h3 className="font-mono text-[12px] text-bone-100">{group.operation}</h3>
                    <span className="font-mono text-[9.5px] text-bone-500">{group.entries.length} entrées</span>
                  </div>
                  <ul className="divide-y divide-ink-800">
                    {group.entries.map((entry: any, index: number) => (
                      <li key={`${entry.displayName}-${index}`} className="flex items-center gap-4 px-4 py-2.5">
                        <span className={cx('font-mono text-[11px] w-6 tabular-nums', index === 0 ? 'text-signal-400' : 'text-ink-400')}>
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 text-[13px] text-bone-200 truncate">
                          {entry.displayName}
                          {entry.ending && <span className="ml-2 font-mono text-[9.5px] text-bone-500">{entry.ending}</span>}
                        </span>
                        <span className="font-mono text-[10.5px] text-bone-500">{entry.deaths} morts</span>
                        <span className="font-mono text-[12px] text-bone-100 tabular-nums w-20 text-right">{duration(entry.bestTimeMs)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}

          {tab === 'endings' && (
            <div className="space-y-5">
              {endings.length === 0 && <EmptyState title="Aucune fin enregistrée." />}
              {endings.map((group: any) => (
                <Panel key={group.ending}>
                  <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
                    <h3 className="font-mono text-[12px] text-bone-100">{group.ending}</h3>
                    <span className="font-mono text-[9.5px] text-bone-500">meilleur temps par fin</span>
                  </div>
                  <ul className="divide-y divide-ink-800">
                    {group.entries.map((entry: any, index: number) => (
                      <li key={`${entry.displayName}-${index}`} className="flex items-center gap-4 px-4 py-2.5">
                        <span className="font-mono text-[11px] text-ink-400 w-6 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                        <span className="flex-1 text-[13px] text-bone-200 truncate">{entry.displayName}</span>
                        <span className="font-mono text-[10.5px] text-bone-500">{entry.operation}</span>
                        <span className="font-mono text-[12px] text-bone-100 tabular-nums w-20 text-right">{duration(entry.bestTimeMs)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ))}
            </div>
          )}

          {tab === 'score' && (
            <Panel>
              <ul className="divide-y divide-ink-800">
                {(data?.byScore ?? []).map((entry: any, index: number) => (
                  <li key={`${entry.displayName}-${index}`} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-ink-400 w-6 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span className="flex-1 text-[13px] text-bone-200 truncate">{entry.displayName}</span>
                    <span className="font-mono text-[10.5px] text-bone-500">{entry.operation}</span>
                    <span className="font-mono text-[12px] text-bone-100 tabular-nums">{entry.score}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'deaths' && (
            <Panel>
              <ul className="divide-y divide-ink-800">
                {(data?.deathsTop ?? []).map((entry: any, index: number) => (
                  <li key={`${entry.displayName}-${index}`} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-ink-400 w-6 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span className="flex-1 text-[13px] text-bone-200 truncate">{entry.displayName}</span>
                    <span className="font-mono text-[10.5px] text-bone-500">{entry.operation}</span>
                    <span className="font-mono text-[12px] text-alert-300 tabular-nums">{entry.deaths}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Notice tone="info" className="mt-5">
            {t('lb.reputationTitles')} : <span className="font-mono text-signal-400/90">[titres à définir]</span> — les scores peuvent être retirés par un modérateur en cas de triche.
          </Notice>
        </>
      )}
    </div>
  );
}
