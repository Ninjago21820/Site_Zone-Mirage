import { useEffect, useState } from 'react';
import { Check, ExternalLink, Heart, Info, Lock } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Badge, Button, Notice, Panel, Placeholder, SectionTitle, Spinner } from '../components/ui';
import { cx } from '../lib/format';

export default function Store() {
  const { t } = useI18n();
  const { data, loading } = useApi<any>('/api/store');
  const [platform, setPlatform] = useState<string>(() => {
    try { return localStorage.getItem('zm.platform') ?? 'steam'; } catch { return 'steam'; }
  });
  const [platformNotice, setPlatformNotice] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('zm.platform', platform); } catch { /* ignore */ }
  }, [platform]);

  if (loading) return <Spinner />;

  const editions = data?.editions ?? [];
  const platforms = data?.platforms ?? [];
  const epicAvailable = platforms.find((p: any) => p.id === 'epic')?.available === true;

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§8 — Vitrine" title={t('store.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-6">{t('store.intro')}</p>

      <div className="grid gap-3 sm:grid-cols-3 mb-8">
        <Notice tone="info" title="Aucun paiement">{t('store.intro')}</Notice>
        <Notice tone="info" title="Aucun launcher">Aucun téléchargement ni manifeste d’intégrité n’est distribué depuis ce site.</Notice>
        <Notice tone="warn" title="Prix en attente">Les éditions Supporter et Deluxe restent <Placeholder />.</Notice>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        {editions.map((edition: any) => (
          <Panel key={edition.id} className={cx('p-6 flex flex-col relative', edition.id === 'standard' && 'border-alert-600/70')}>
            {edition.id === 'standard' && (
              <span className="absolute -top-px left-0 right-0 h-[2px] bg-alert-500" aria-hidden />
            )}
            <div className="flex items-center justify-between">
              <h3 className="text-[15px]">{edition.name}</h3>
              {edition.status === 'placeholder' && <Badge tone="amber">À définir</Badge>}
              {edition.status === 'defined' && <Badge tone="red">Prix défini</Badge>}
            </div>
            <p className={cx('mt-4 font-mono text-2xl', edition.defined ? 'text-bone-100' : 'text-signal-400/90 text-base')}>
              {edition.priceLabel}
            </p>
            <ul className="mt-5 space-y-2 flex-1">
              {edition.features.map((feature: string) => (
                <li key={feature} className="flex items-start gap-2 text-[12.5px] text-bone-300">
                  <Check className="h-3.5 w-3.5 text-alert-400 mt-0.5 shrink-0" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            {edition.note && <p className="mt-4 text-[11px] text-bone-500 leading-relaxed">{edition.note}</p>}
            <div className="mt-5">
              <Button variant={edition.id === 'standard' ? 'primary' : 'outline'} className="w-full"
                onClick={() => setPlatformNotice(true)}>
                {edition.id === 'standard' ? t('store.buy') : 'Bientôt disponible'}
              </Button>
            </div>
          </Panel>
        ))}
      </div>

      {platformNotice && (
        <Notice tone="warn" className="mt-6" title="Redirection vers une boutique externe">
          Aucun paiement n’est traité sur ce site. Les liens d’achat et de liste de souhaits seront activés lorsque les pages de boutique officielles seront en ligne.
        </Notice>
      )}

      <section className="mt-12 grid gap-6 lg:grid-cols-2 items-start">
        <Panel className="p-6">
          <h3 className="text-[15px] mb-1">Plateformes</h3>
          <p className="text-[12.5px] text-bone-400 mb-4">{t('store.platformMemory')}</p>
          <div className="space-y-2">
            {platforms.filter((p: any) => p.id === 'steam' || epicAvailable).map((p: any) => (
              <label key={p.id} className={cx('flex items-center gap-3 border px-3 py-3 cursor-pointer rounded-[2px]',
                platform === p.id ? 'border-alert-600 bg-alert-500/[0.05]' : 'border-ink-600 hover:border-ink-400')}>
                <input type="radio" name="platform" value={p.id} checked={platform === p.id}
                  onChange={() => setPlatform(p.id)} className="accent-[#e11d2e]" />
                <span className="flex-1">
                  <span className="block text-[13px] text-bone-100">{p.label}</span>
                  <span className="block font-mono text-[10px] text-bone-500">{p.note}</span>
                </span>
                {platform === p.id && <Badge tone="red">Sélectionnée</Badge>}
              </label>
            ))}
          </div>
          {!epicAvailable && (
            <p className="mt-4 flex items-start gap-2 font-mono text-[10.5px] leading-relaxed text-bone-500">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" aria-hidden /> {t('store.epicHidden')}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {t('store.buy')}
            </Button>
            <Button variant="outline" disabled>
              <Heart className="h-3.5 w-3.5" aria-hidden /> {t('store.wishlist')}
            </Button>
          </div>
          <p className="mt-3 font-mono text-[10px] text-bone-500">
            Boutons désactivés tant que les pages de boutique ne sont pas en ligne.
          </p>
        </Panel>

        <Panel className="p-6">
          <h3 className="text-[15px] mb-1">{t('store.buyerExtras')}</h3>
          <p className="text-[12.5px] text-bone-400 mb-4">{data?.buyerExtrasNote}</p>
          <ul className="space-y-2">
            {(data?.buyerExtras ?? []).map((extra: any) => (
              <li key={extra.slug} className="border border-ink-600 rounded-[2px] p-3 flex items-start gap-3">
                <div className="h-12 w-12 shrink-0 border border-dashed border-ink-500 grid place-items-center">
                  <span className="font-mono text-[8px] text-bone-600">NO IMG</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] text-bone-100">{extra.title}</p>
                  <p className="text-[11.5px] text-bone-500 leading-snug mt-0.5">{extra.summary}</p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-signal-400/80 mt-1">{t('store.noVisuals')}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-ink-700 pt-4 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-bone-500 mt-0.5 shrink-0" aria-hidden />
            <p className="text-[11px] text-bone-500 leading-relaxed">{t('store.dlc')}</p>
          </div>
        </Panel>
      </section>
    </div>
  );
}
