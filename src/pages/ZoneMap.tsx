import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Route as RouteIcon, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { apiPost, ApiError } from '../lib/api';
import { Badge, Button, LinkButton, Notice, Panel, SectionTitle, Select, Spinner, Tabs } from '../components/ui';
import { cx } from '../lib/format';

interface MapNode {
  id: string; floor_id: string; code: string; label: string; kind: string;
  x: number; y: number; restricted: number; clearance: string | null; wiki_slug: string | null;
}
interface MapEdge { id: string; from_node: string; to_node: string; kind: string; distance: number; restricted: number }
interface MapFloor { id: string; label: string; level: number; order_index: number }

const KIND_COLOR: Record<string, string> = {
  entrance: '#22c55e', public: '#60a5fa', security: '#f59e0b', medical: '#38bdf8',
  elevator: '#e11d2e', stairs: '#fb7185', corridor: '#64748b', lab: '#a78bfa',
  cell: '#ef4444', control: '#f97316', archive: '#94a3b8', logistics: '#84cc16',
  tech: '#06b6d4', utility: '#eab308', office: '#8b5cf6', airlock: '#f43f5e', room: '#94a3b8',
};

export default function ZoneMap() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<any>('/api/map');
  const [floorId, setFloorId] = useState<string>('f0');
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clearance, setClearance] = useState('N1');
  const [route, setRoute] = useState<any>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);

  const floors: MapFloor[] = data?.floors ?? [];
  const nodes: MapNode[] = data?.nodes ?? [];
  const edges: MapEdge[] = data?.edges ?? [];

  const activeFloor = floors.find((f) => f.id === floorId) ?? floors[0];
  const floorNodes = useMemo(() => nodes.filter((n) => n.floor_id === (activeFloor?.id ?? 'f0')), [nodes, activeFloor]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const floorEdges = useMemo(() => {
    if (!activeFloor) return [];
    return edges.filter((e) => {
      const a = nodeById.get(e.from_node);
      const b = nodeById.get(e.to_node);
      return a && b && a.floor_id === activeFloor.id && b.floor_id === activeFloor.id;
    });
  }, [edges, activeFloor, nodeById]);

  const pathIds: string[] = route?.steps?.map((s: any) => s.nodeId) ?? [];
  const pathSet = new Set(pathIds);
  const pathEdges = new Set(
    pathIds.slice(1).map((id: string, i: number) => `${pathIds[i]}>${id}`),
  );

  async function computeRoute() {
    if (!from || !to) return;
    setRouting(true);
    setRouteError(null);
    try {
      const result = await apiPost<any>('/api/map/route', { from, to, clearance });
      setRoute(result);
      const first = nodeById.get(result.steps[0]?.nodeId);
      if (first) setFloorId(first.floor_id);
    } catch (err) {
      setRoute(null);
      setRouteError(err instanceof ApiError ? err.message : t('map.noRoute'));
    } finally {
      setRouting(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Notice tone="danger" className="m-8">{t('error.generic')}</Notice>;

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6 py-12">
      <SectionTitle kicker="§9 — Plans multi-niveaux" title={t('map.title')} />
      <p className="max-w-2xl text-[13.5px] text-bone-400 leading-relaxed -mt-2 mb-5">{t('map.intro')}</p>
      <Notice tone="warn" className="mb-8">
        Plans de substitution explicites. Les plans définitifs et le graphe de circulation seront fournis par l’équipe de level design.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] items-start">
        {/* ------------------------------- FLOOR PLAN ------------------------------- */}
        <Panel className="overflow-hidden">
          <div className="border-b border-ink-600 bg-ink-850 px-3 pt-2">
            <Tabs
              tabs={floors.map((f) => ({ id: f.id, label: f.level >= 0 ? `N${f.level}` : `B${Math.abs(f.level)}` }))}
              value={activeFloor?.id ?? 'f0'}
              onChange={(id) => { setFloorId(id); setSelected(null); }}
            />
          </div>
          <div className="px-3 py-2 border-b border-ink-700 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-300">{activeFloor?.label}</span>
            <span className="font-mono text-[9.5px] text-bone-500">{floorNodes.length} POINTS</span>
          </div>

          <div className="relative bg-ink-950 zm-grid-bg">
            <svg viewBox="0 0 100 100" className="w-full h-auto block" role="img" aria-label={`Plan ${activeFloor?.label}`}>
              <defs>
                <pattern id="hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="4" stroke="#3f3f4b" strokeWidth="0.6" />
                </pattern>
              </defs>
              <rect x="4" y="4" width="92" height="92" fill="url(#hatch)" opacity="0.35" stroke="#2a2a33" strokeWidth="0.5" />
              {floorEdges.map((edge) => {
                const a = nodeById.get(edge.from_node)!;
                const b = nodeById.get(edge.to_node)!;
                const key = `${edge.from_node}>${edge.to_node}`;
                const inPath = pathEdges.has(key) || pathEdges.has(`${edge.to_node}>${edge.from_node}`);
                return (
                  <line
                    key={edge.id}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={inPath ? '#ff3b4a' : edge.restricted ? '#5b2a30' : '#3a3a46'}
                    strokeWidth={inPath ? 1.3 : 0.7}
                    strokeDasharray={edge.kind === 'elevator' ? '2 1.5' : edge.kind === 'stairs' ? '1 1' : undefined}
                  />
                );
              })}
              {floorNodes.map((node) => {
                const isSelected = selected?.id === node.id;
                const inPath = pathSet.has(node.id);
                const stepIndex = pathIds.indexOf(node.id);
                return (
                  <g
                    key={node.id}
                    onClick={() => setSelected(node)}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.code} ${node.label}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(node); } }}
                  >
                    {(isSelected || inPath) && (
                      <circle cx={node.x} cy={node.y} r="4.2" fill="none" stroke={inPath ? '#ff3b4a' : '#e8e8ec'} strokeWidth="0.5" opacity="0.9" />
                    )}
                    <circle cx={node.x} cy={node.y} r={node.kind === 'elevator' || node.kind === 'stairs' ? 2 : 1.6}
                      fill={KIND_COLOR[node.kind] ?? '#94a3b8'} stroke="#08080a" strokeWidth="0.4" />
                    {inPath && (
                      <text x={node.x + 3.2} y={node.y - 2} fontSize="2.6" fill="#ff6b76" fontFamily="monospace">
                        {stepIndex + 1}
                      </text>
                    )}
                    <text
                      x={node.x} y={node.y + 5.2} fontSize="2.5" textAnchor="middle"
                      fill={isSelected ? '#f2f2f5' : '#8b8b96'} fontFamily="monospace"
                    >
                      {node.code}
                    </text>
                    {node.restricted === 1 && <Lock x={node.x + 1.6} y={node.y - 4.6} width="2.6" height="2.6" color="#f59e0b" />}
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-2 left-3 flex flex-wrap gap-3">
              {[['corridor', t('map.corridor')], ['elevator', t('map.elevator')], ['stairs', t('map.stairs')]].map(([kind, label]) => (
                <span key={kind} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-bone-500">
                  <span className={cx('block h-px w-4', kind === 'corridor' ? 'bg-ink-400' : kind === 'elevator' ? 'bg-alert-500' : 'bg-bone-500')} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {selected && (
            <div className="border-t border-ink-700 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] text-bone-500">{selected.code}</p>
                  <h3 className="text-[15px] mt-0.5">{selected.label}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{selected.kind}</Badge>
                    {selected.restricted === 1 && <Badge tone="amber"><ShieldAlert className="h-2.5 w-2.5" aria-hidden />{selected.clearance}</Badge>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 items-end">
                  {selected.wiki_slug && <LinkButton to={`/wiki/${selected.wiki_slug}`} size="sm">{t('nav.wiki')}</LinkButton>}
                  <Button size="sm" variant="ghost" onClick={() => setFrom(selected.id)}>Départ</Button>
                  <Button size="sm" variant="ghost" onClick={() => setTo(selected.id)}>Arrivée</Button>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* -------------------------------- SIDE PANEL ------------------------------ */}
        <div className="space-y-6">
          <Panel className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <RouteIcon className="h-4 w-4 text-alert-400" aria-hidden />
              <h3 className="text-sm">{t('map.route')}</h3>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="zm-label text-[9.5px]">{t('map.from')}</span>
                  <Select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1">
                    <option value="">—</option>
                    {floors.map((floor) => (
                      <optgroup key={floor.id} label={floor.label}>
                        {nodes.filter((n) => n.floor_id === floor.id).map((n) => (
                          <option key={n.id} value={n.id}>{n.code} · {n.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
                <label className="block">
                  <span className="zm-label text-[9.5px]">{t('map.to')}</span>
                  <Select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1">
                    <option value="">—</option>
                    {floors.map((floor) => (
                      <optgroup key={floor.id} label={floor.label}>
                        {nodes.filter((n) => n.floor_id === floor.id).map((n) => (
                          <option key={n.id} value={n.id}>{n.code} · {n.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
              </div>
              <label className="block">
                <span className="zm-label text-[9.5px]">{t('map.clearance')}</span>
                <Select value={clearance} onChange={(e) => setClearance(e.target.value)} className="mt-1">
                  {['N1', 'N2', 'N3', 'N4', 'N5'].map((level) => <option key={level} value={level}>{level}</option>)}
                </Select>
              </label>
              <Button variant="primary" onClick={computeRoute} disabled={!from || !to || routing} className="w-full">
                {routing ? t('label.loading') : t('map.compute')}
              </Button>
              {from && to && from === to && <p className="text-[11px] text-signal-400">Sélectionnez deux points différents.</p>}
            </div>

            {routeError && <Notice tone="danger" className="mt-3">{routeError}</Notice>}

            {route && (
              <div className="mt-4 border-t border-ink-700 pt-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="zm-label text-[9.5px]">{t('map.steps')} · {route.steps.length}</span>
                  <span className="font-mono text-[10px] text-alert-300">coût {route.totalCost}</span>
                </div>
                <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {route.steps.map((step: any, index: number) => (
                    <li key={step.nodeId} className="flex gap-3">
                      <span className="font-mono text-[10px] text-alert-400 w-4 shrink-0 pt-0.5">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] text-bone-200 leading-snug">{step.label}</p>
                        <p className="font-mono text-[9.5px] text-bone-500 mt-0.5">
                          {step.floorLabel}
                          {index > 0 && ` · ${step.via}`}
                          {step.clearance && ` · ${step.clearance}`}
                        </p>
                      </div>
                      {step.floorId !== activeFloor?.id && (
                        <button onClick={() => setFloorId(step.floorId)}
                          className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-alert-400 hover:text-alert-200">
                          voir
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="mt-3 font-mono text-[9.5px] text-bone-500">
                  Niveaux traversés : {route.floorsUsed.length}
                </p>
              </div>
            )}
          </Panel>

          <Panel>
            <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
              <h3 className="zm-label">{t('map.points')}</h3>
              <span className="font-mono text-[9.5px] text-bone-500">{activeFloor?.label}</span>
            </div>
            <ul className="max-h-[22rem] overflow-y-auto divide-y divide-ink-800">
              {floorNodes.map((node) => (
                <li key={node.id}>
                  <button onClick={() => setSelected(node)}
                    className={cx('w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-ink-850 transition-colors',
                      selected?.id === node.id && 'bg-ink-850')}>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: KIND_COLOR[node.kind] ?? '#94a3b8' }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] text-bone-200 truncate">{node.label}</span>
                      <span className="block font-mono text-[9.5px] text-bone-500">{node.code} · {node.kind}</span>
                    </span>
                    {node.restricted === 1 && <Lock className="h-3 w-3 text-signal-400 shrink-0" aria-label={t('map.restricted')} />}
                    {node.wiki_slug && <Link to={`/wiki/${node.wiki_slug}`} onClick={(e) => e.stopPropagation()}
                      className="font-mono text-[9px] uppercase tracking-[0.1em] text-alert-400 hover:text-alert-200 shrink-0">
                      wiki <ArrowRight className="inline h-2.5 w-2.5" aria-hidden />
                    </Link>}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
