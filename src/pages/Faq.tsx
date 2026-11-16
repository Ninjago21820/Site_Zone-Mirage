import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { LinkButton, Notice, Panel, SectionTitle, Spinner } from '../components/ui';

export default function Faq() {
  const { t, locale } = useI18n();
  const { data, loading } = useApi<any>(`/api/content/faq?locale=${locale}`, [locale]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
      <SectionTitle kicker="§4 — Aide" title={t('faq.title')} />
      <p className="text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-8">{t('faq.intro')}</p>

      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {data?.items?.map((item: any) => (
            <Panel key={item.slug} className="overflow-hidden">
              <button
                onClick={() => setOpen(open === item.slug ? null : item.slug)}
                aria-expanded={open === item.slug}
                className="w-full flex items-start justify-between gap-4 px-4 py-3.5 text-left hover:bg-ink-850 transition-colors"
              >
                <span className="text-[13.5px] text-bone-200">{item.title}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-bone-500 transition-transform ${open === item.slug ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {open === item.slug && (
                <div className="px-4 pb-4 pt-1 border-t border-ink-800">
                  <p className="text-[12.5px] leading-relaxed text-bone-400 whitespace-pre-line">{item.summary}</p>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Notice tone="info" className="mt-8" title="Une question sans réponse ?">
        Ouvrez une demande depuis la page support. Les signalements de sécurité sont traités sous 24 h.
        <div className="mt-3"><LinkButton to="/support" size="sm" variant="primary">{t('nav.support')}</LinkButton></div>
      </Notice>
    </div>
  );
}
