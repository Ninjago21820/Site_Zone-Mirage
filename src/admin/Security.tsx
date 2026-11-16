import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { Badge, Notice, Panel, Spinner } from '../components/ui';
import type { BackOfficeProps } from './BackOffice';

const TONE = {
  pass: { tone: 'green' as const, icon: ShieldCheck, label: 'Conforme' },
  warn: { tone: 'amber' as const, icon: ShieldAlert, label: 'À surveiller' },
  fail: { tone: 'red' as const, icon: ShieldX, label: 'Écart' },
};

export default function Security({ data }: BackOfficeProps) {
  const { data: report, loading } = useApi<any>('/api/backoffice/criteria');

  return (
    <div className="space-y-5 max-w-[1000px]">
      <div>
        <p className="zm-label mb-1">§6.14 — Critères d’acceptation</p>
        <h1 className="text-xl">Posture de sécurité</h1>
      </div>

      <Notice tone="info" title="Vérifications calculées">
        Chaque critère est évalué à partir de l’état réel de la base de données et des mécanismes serveur, pas d’une
        déclaration statique. Le détail et le fichier responsable sont indiqués pour chaque ligne.
      </Notice>

      {loading || !report ? <Spinner label="Évaluation des critères…" /> : (
        <div className="space-y-2">
          {report.criteria.map((criterion: any) => {
            const meta = TONE[criterion.status as keyof typeof TONE] ?? TONE.warn;
            const Icon = meta.icon;
            return (
              <Panel key={criterion.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${criterion.status === 'pass' ? 'text-emerald-400' : criterion.status === 'warn' ? 'text-signal-400' : 'text-alert-400'}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[9.5px] text-bone-600">#{criterion.id}</span>
                      <p className="text-[13px] text-bone-100">{criterion.title}</p>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <p className="text-[11.5px] text-bone-400 mt-1">{criterion.detail}</p>
                    <p className="font-mono text-[9.5px] text-bone-600 mt-1">{criterion.evidence}</p>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="p-4">
        <h2 className="zm-label mb-3">Défenses transverses</h2>
        <ul className="space-y-1.5 text-[11.5px] text-bone-400 leading-relaxed">
          <li>• En-têtes stricts : CSP, HSTS (production), Permissions-Policy, Referrer-Policy, nosniff.</li>
          <li>• CSRF à double soumission sur toutes les requêtes mutantes du navigateur.</li>
          <li>• Vérification d’origine et cookies HttpOnly / Secure / SameSite.</li>
          <li>• Protection SSRF sur le référencement des serveurs (résolution DNS contrôlée, plages privées refusées).</li>
          <li>• Assainissement HTML et blocs côté serveur ; rendu Markdown sans injection de HTML.</li>
          <li>• Signature Ed25519 des interactions Discord, protection anti-rejeu.</li>
          <li>• Back-office sur un chemin non standard, <code>/admin</code> renvoie un 404 strict.</li>
        </ul>
      </Panel>

      <Panel className="p-4">
        <h2 className="zm-label mb-2">Portée de la session</h2>
        <p className="text-[11.5px] text-bone-400">
          Rôle : <span className="text-bone-100">{data.user.roleLabel}</span> · session personnel 15 min d’inactivité / 8 h maximum ·
          réauthentification exigée pour toute action sensible (moins de 5 minutes).
        </p>
      </Panel>
    </div>
  );
}
