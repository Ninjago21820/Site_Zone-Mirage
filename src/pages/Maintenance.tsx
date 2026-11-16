import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { Badge, LinkButton, Notice, Panel, SectionTitle, Spinner } from '../components/ui';

export default function Maintenance() {
  const { t } = useI18n();
  const { data, loading } = useApi<any>('/api/maintenance');

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
      <SectionTitle kicker="§12.3 — État des services" title={t('maintenance.title')} />
      {loading ? <Spinner /> : (
        <>
          <Panel className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${data?.enabled ? 'bg-signal-400' : 'bg-emerald-400'} zm-pulse-dot`} aria-hidden />
                <div>
                  <p className="text-[14px] text-bone-100">{data?.enabled ? 'Maintenance en cours' : 'Services opérationnels'}</p>
                  <p className="font-mono text-[10px] text-bone-500 mt-0.5">Site officiel · API jeu · Wiki</p>
                </div>
              </div>
              <Badge tone={data?.enabled ? 'amber' : 'green'}>{data?.enabled ? 'MAINTENANCE' : 'OK'}</Badge>
            </div>
            <p className="mt-5 text-[13px] text-bone-400 leading-relaxed">{data?.message}</p>
          </Panel>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Panel className="p-4">
              <p className="zm-label mb-2">Prochain créneau</p>
              <p className="font-mono text-[12px] text-signal-400/90">[À définir]</p>
              <p className="mt-2 text-[11px] text-bone-500">Les créneaux sont annoncés par l’équipe technique.</p>
            </Panel>
            <Panel className="p-4">
              <p className="zm-label mb-2">Services concernés</p>
              <p className="font-mono text-[12px] text-signal-400/90">[À définir]</p>
              <p className="mt-2 text-[11px] text-bone-500">Aucune opération planifiée à ce jour.</p>
            </Panel>
          </div>

          <Notice tone="info" className="mt-6" title="Pendant une maintenance">
            L’accès au site peut être interrompu. Les serveurs de jeu communautaires ne sont pas concernés par les opérations menées sur ce site.
            <div className="mt-3"><LinkButton to="/support" size="sm">{t('nav.support')}</LinkButton></div>
          </Notice>
        </>
      )}
    </div>
  );
}
