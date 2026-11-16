import { Badge, Notice, Panel } from '../components/ui';
import type { BackOfficeProps } from './BackOffice';

const TYPES = ['wiki', 'news', 'roadmap', 'map', 'faq', 'buyer_extras', 'legal'];
const ROLES = ['admin', 'moderator', 'translator', 'writer', 'game_designer', 'animator', 'dev', 'community_manager'];

export default function Matrices({ data }: BackOfficeProps) {
  const { matrices, permissions } = data;

  function cellClass(type: string, role: string) {
    const actions = matrices.content[type]?.[role];
    if (!actions) return 'text-bone-700';
    if (permissions.content[type]?.length && role === data.user.role) return 'text-alert-300 font-medium';
    return 'text-bone-200';
  }

  return (
    <div className="space-y-6 max-w-[1100px]">
      <div>
        <p className="zm-label mb-1">§11.3 / §11.4</p>
        <h1 className="text-xl">Matrices de droits</h1>
      </div>

      <Notice tone="info">
        C = création et édition du brouillon · V = vérification · P = publication · T = traduction.
        Les matrices sont appliquées côté serveur ; l’interface ne fait que refléter ces droits.
      </Notice>

      <Panel className="overflow-x-auto">
        <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
          <h2 className="zm-label">Contenus — §11.3</h2>
          <Badge tone="red">{data.user.roleLabel}</Badge>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-ink-700">
              <th className="text-left px-3 py-2 zm-label font-normal">Type</th>
              {ROLES.map((role) => (
                <th key={role} className={`px-2 py-2 zm-label font-normal text-center ${role === data.user.role ? 'text-alert-300' : ''}`}>
                  {matrices.roles[role]?.split(' ')[0] ?? role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {TYPES.map((type) => (
              <tr key={type} className={permissions.content[type]?.length ? 'bg-ink-850/30' : ''}>
                <td className="px-3 py-2 font-mono text-[11px] text-bone-200">{type}</td>
                {ROLES.map((role) => (
                  <td key={role} className={`px-2 py-2 text-center font-mono text-[11px] ${cellClass(type, role)}`}>
                    {matrices.content[type]?.[role] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <div className="border-b border-ink-700 px-4 py-2.5">
          <h2 className="zm-label">Fonctions — §11.4</h2>
        </div>
        <ul className="divide-y divide-ink-800">
          {matrices.functions.map((fn: any) => (
            <li key={fn.key} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-bone-100 min-w-[13rem]">{fn.label}</span>
              <div className="flex flex-wrap gap-1">
                {fn.roles.map((role: string) => (
                  <Badge key={role} tone={role === data.user.role ? 'red' : 'neutral'}>{matrices.roles[role] ?? role}</Badge>
                ))}
              </div>
              {fn.note && <span className="font-mono text-[9.5px] text-signal-400/90 ml-auto">{fn.note}</span>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="p-4">
        <h2 className="zm-label mb-3">Workflow éditorial — §11.2</h2>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
          {['draft', 'review', 'scheduled', 'published', 'archived', 'deleted'].map((status, index) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="border border-ink-600 px-2 py-1 text-bone-200">{matrices.statuses[status]}</span>
              {index < 5 && <span className="text-bone-600">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-bone-400">
          Restauration depuis « Supprimé » : 30 jours maximum, vers « Brouillon ». Suppression logique uniquement, aucune destruction immédiate.
        </p>
      </Panel>
    </div>
  );
}
