import type { StoryGraph } from '../../core/analyzer';
import type { Position } from '../../core/layout';
import type { SceneRequest } from '../NewScene';
import { CARD } from '../../core/layout';
import { EdgeLabel, RouteSign } from './MapParts';

const { W, H } = CARD;
const clampLane = (offset: number) => Math.max(-H / 2 + 8, Math.min(H / 2 - 8, offset));

type Edge = StoryGraph['edges'][number];

/** The routes between passages: arrows, loop stubs back to earlier passages, and the ends (The End, or a missing passage). */
export function MapEdges({
  graph,
  edges,
  placed,
  lanes,
  routes,
  hover,
  hoverEdge,
  setHoverEdge,
  lit,
  trace,
  straight,
  isLoop,
  fixMissing,
  centerOn,
  setSceneForm,
}: {
  graph: StoryGraph;
  edges: Edge[];
  placed: Map<string, Position>;
  /** Parallel routes between the same two passages each get a lane: which one this is, of how many. */
  lanes: Map<string, { i: number; n: number }>;
  routes: Map<string, { d: string; mid: [number, number] }>;
  hover: string | null;
  hoverEdge: string | null;
  setHoverEdge: (id: string | null) => void;
  /** What is lit (a traced route, or the selected passage and its neighbours); everything else is dimmed. */
  lit: { nodes: Set<string>; edges: Set<string> } | null;
  trace: string;
  straight: 'full' | 'faint';
  isLoop: (e: { from: string; to: string }) => boolean;
  /** The request that creates a missing destination, when there is one. */
  fixMissing: (to: string, from: string) => SceneRequest | null;
  centerOn: (id: string) => void;
  setSceneForm: (r: SceneRequest) => void;
}) {
  return (
    <>
      {edges.map((e) => {
        const a = placed.get(e.from);
        const b = placed.get(e.to);
        if (!a) return null;
        const kind = e.pending ? 'pending' : e.kind === 'fallback' || e.kind === 'divert' ? 'fallback' : e.forced ? 'forced' : e.conditional ? 'cond' : 'edge';
        const hl = hover === e.from || hover === e.to || hoverEdge === e.id || (!!lit && lit.edges.has(e.id) && !trace);
        const shade = lit && !lit.edges.has(e.id) ? 'dim' : straight === 'faint' && kind === 'fallback' && !hl ? 'faint' : '';
        const showLabel = !!e.label && (hoverEdge === e.id || hover === e.from);
        const { i, n } = lanes.get(e.id)!;
        const lane = i - (n - 1) / 2; // 0 for a lone edge; spreads parallel edges apart
        if (b && isLoop(e)) {
          // A loop back to an earlier passage: a short stub that names it (click to go there), not a long arrow.
          const x1 = a.x + W;
          const y1 = a.y + H / 2 + clampLane(lane * 10) + 8;
          const name = graph.nodes.find((n) => n.id === e.to)?.title ?? e.to;
          return (
            <g key={e.id} className={`loop-stub ${shade}`} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
              <line x1={x1} y1={y1} x2={x1 + 26} y2={y1} className={`edge loop ${kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`} />
              <text
                x={x1 + 30}
                y={y1 + 4}
                className="edge-end loop"
                role="button"
                tabIndex={0}
                aria-label={`Loops back to ${name}. Go there`}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => centerOn(e.to)}
                onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), centerOn(e.to))}
              >
                ↩ {name.length > 22 ? `${name.slice(0, 21)}…` : name}
              </text>
              {showLabel && <EdgeLabel x={x1 + 20} y={y1 - 14} text={e.label} />}
            </g>
          );
        }
        if (!b) {
          // END or missing destination
          const x1 = a.x + W;
          const y1 = a.y + H / 2 + clampLane(lane * 10);
          const missing = e.to !== 'END';
          return (
            <g key={e.id} className={shade} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
              <line
                x1={x1}
                y1={y1}
                x2={x1 + 40}
                y2={y1}
                className={`edge ${missing ? 'missing' : kind} ${hl ? 'hl' : ''}`}
                markerEnd={`url(#arrow-${hl ? 'hl' : kind})`}
              />
              <text
                x={x1 + 44}
                y={y1 + 4}
                className={`edge-end ${missing ? 'missing' : ''}`}
                {...(missing && fixMissing(e.to, e.from)
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `${e.to} doesn’t exist yet. Create it`,
                      onClick: () => setSceneForm(fixMissing(e.to, e.from)!),
                      onKeyDown: (k: React.KeyboardEvent) =>
                        (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), setSceneForm(fixMissing(e.to, e.from)!)),
                    }
                  : {})}
              >
                {missing ? `⚠ Missing: ${e.to}${fixMissing(e.to, e.from) ? ' (click to create it)' : ''}` : 'The End'}
              </text>
              {(kind === 'cond' || kind === 'pending' || kind === 'forced') && !missing && <RouteSign kind={kind} x={x1 + 20} y={y1} />}
              {showLabel && <EdgeLabel x={x1 + 20} y={y1 - 14} text={e.label} />}
            </g>
          );
        }
        const route = routes.get(e.id)!;
        const d = route.d;
        const [mx, my] = route.mid;
        return (
          <g key={e.id} className={shade} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
            <path d={d} className="edge-hit" />
            <path d={d} className={`edge ${kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`} />
            {(kind === 'cond' || kind === 'pending' || kind === 'forced') && !showLabel && <RouteSign kind={kind} x={mx} y={my} />}
            {showLabel && <EdgeLabel x={mx} y={my} text={e.kind === 'fallback' ? 'otherwise' : e.label} />}
          </g>
        );
      })}
    </>
  );
}
