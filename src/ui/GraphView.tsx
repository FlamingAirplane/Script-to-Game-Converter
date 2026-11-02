import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryGraph } from '../core/analyzer';

// The story map. Passages are laid out in columns by distance from the start (ordered to reduce
// crossings), can be dragged to new places (remembered in the project), searched, and navigated
// with a minimap. Drawn as an old map: cartouche, compass rose and ink routes.

const W = 188;
const H = 56;
const GX = 96;
const GY = 26;

export type Position = { x: number; y: number };

function autoLayout(graph: StoryGraph, start: string): Map<string, Position> {
  const ids = graph.nodes.map((n) => n.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const depth = new Map<string, number>();
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of graph.edges)
    if (!e.pending) {
      (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
      (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e.from);
    }
  const q: string[] = ids.includes(start) ? [start] : [];
  if (q.length) depth.set(start, 0);
  while (q.length) {
    const id = q.shift()!;
    for (const t of out.get(id) ?? []) {
      if (!order.has(t) || depth.has(t)) continue;
      depth.set(t, depth.get(id)! + 1);
      q.push(t);
    }
  }
  const maxD = Math.max(0, ...depth.values());
  // Unreachable passages go in a trailing column, in source order.
  for (const id of ids) if (!depth.has(id)) depth.set(id, maxD + 1);
  const cols: string[][] = [];
  for (const id of ids) (cols[depth.get(id)!] ??= []).push(id);
  for (const c of cols) c?.sort((a, b) => order.get(a)! - order.get(b)!);
  // Barycentre sweeps: order each column by the average row of its neighbours, which removes most crossings.
  const row = (id: string) => cols[depth.get(id)!].indexOf(id);
  const bary = (id: string, nbrs: string[] | undefined, d: number) => {
    const rows = (nbrs ?? []).filter((n) => depth.get(n) === d).map(row);
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : row(id);
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let d = 1; d < cols.length; d++) cols[d]?.sort((a, b) => bary(a, inc.get(a), d - 1) - bary(b, inc.get(b), d - 1));
    for (let d = cols.length - 2; d >= 0; d--) cols[d]?.sort((a, b) => bary(a, out.get(a), d + 1) - bary(b, out.get(b), d + 1));
  }
  const maxRows = Math.max(1, ...cols.map((c) => c?.length ?? 0));
  const placed = new Map<string, Position>();
  cols.forEach((list, d) => {
    const off = ((maxRows - (list?.length ?? 0)) * (H + GY)) / 2;
    list?.forEach((id, i) => placed.set(id, { x: d * (W + GX), y: off + i * (H + GY) }));
  });
  return placed;
}

const clampLane = (offset: number) => Math.max(-H / 2 + 8, Math.min(H / 2 - 8, offset));

function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const label = text.length > 34 ? `${text.slice(0, 33)}…` : text;
  const w = label.length * 6.6 + 16;
  return (
    <g className="edge-label" transform={`translate(${x - w / 2},${y - 11})`} pointerEvents="none">
      <rect width={w} height={22} rx={3} />
      <text x={w / 2} y={15} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function Compass() {
  return (
    <g className="compass" aria-hidden>
      <circle r="30" className="compass-ring" />
      <circle r="24" className="compass-ring thin" />
      <path d="M0 -36 L6 0 L0 36 L-6 0 Z" className="compass-ns" />
      <path d="M-36 0 L0 -6 L36 0 L0 6 Z" className="compass-ew" />
      <text y="-40" textAnchor="middle" className="compass-n">
        N
      </text>
    </g>
  );
}

export function GraphView({
  graph,
  start,
  selected,
  onOpen,
  endingsReached,
  title,
  layout,
  onMove,
  onResetLayout,
}: {
  graph: StoryGraph;
  start: string;
  selected?: string;
  onOpen: (id: string) => void;
  endingsReached?: Record<string, number>;
  title: string;
  layout?: Record<string, Position>;
  onMove: (id: string, pos: Position) => void;
  onResetLayout: () => void;
}) {
  const auto = useMemo(() => autoLayout(graph, start), [graph, start]);
  const [dragging, setDragging] = useState<{ id: string; pos: Position } | null>(null);
  const placed = useMemo(() => {
    const m = new Map<string, Position>();
    for (const [id, p] of auto) m.set(id, layout?.[id] ?? p);
    if (dragging) m.set(dragging.id, dragging.pos);
    return m;
  }, [auto, layout, dragging]);
  const bounds = useMemo(() => {
    const ps = [...placed.values()];
    const minX = Math.min(0, ...ps.map((p) => p.x));
    const minY = Math.min(0, ...ps.map((p) => p.y));
    const maxX = Math.max(W, ...ps.map((p) => p.x + W));
    const maxY = Math.max(H, ...ps.map((p) => p.y + H));
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [placed]);

  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? graph.nodes.filter((n) => `${n.title} ${n.id}`.toLowerCase().includes(q)).map((n) => n.id) : [];
  }, [query, graph.nodes]);

  // Parallel edges between the same two passages get their own lane so they don't draw on top of each other.
  const lanes = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const e of graph.edges) {
      const key = `${e.from}->${e.to}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(e.id);
    }
    const out = new Map<string, { i: number; n: number }>();
    for (const ids of groups.values()) ids.forEach((id, i) => out.set(id, { i, n: ids.length }));
    return out;
  }, [graph.edges]);

  const fit = () => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    setSize({ w: r.width, h: r.height });
    const k = Math.min(1.2, Math.max(0.25, Math.min((r.width - 120) / bounds.width, (r.height - 120) / bounds.height)));
    setView({ x: (r.width - bounds.width * k) / 2 - bounds.minX * k, y: (r.height - bounds.height * k) / 2 - bounds.minY * k, k });
  };
  const centerOn = (id: string) => {
    const p = placed.get(id);
    const r = svg.current?.getBoundingClientRect();
    if (!p || !r) return;
    setView((v) => ({ ...v, x: r.width / 2 - (p.x + W / 2) * v.k, y: r.height / 2 - (p.y + H / 2) * v.k }));
  };
  // Fit when the map's overall size changes (not on every edit, so panning is preserved).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(fit, [Math.round(bounds.width), Math.round(bounds.height)]);

  // Minimap geometry.
  const MW = 180;
  const MH = 112;
  const mk = Math.min((MW - 12) / bounds.width, (MH - 12) / bounds.height);
  const mox = (MW - bounds.width * mk) / 2;
  const moy = (MH - bounds.height * mk) / 2;
  const mm = (p: Position) => ({ x: mox + (p.x - bounds.minX) * mk, y: moy + (p.y - bounds.minY) * mk });
  const vp = mm({ x: -view.x / view.k, y: -view.y / view.k });

  return (
    <div className="view graph-view">
      <div className="graph-toolbar">
        <input
          className="input small graph-search"
          placeholder="Find a passage…"
          value={query}
          aria-label="Find a passage on the map"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && matches[0] && centerOn(matches[0])}
        />
        {query && <span className="muted small">{matches.length ? `${matches.length} found · Enter to go` : 'none found'}</span>}
        <span className="legend">
          <span className="lg lg-start" /> start
          <span className="lg lg-end" /> ending
          <span className="lg lg-unreach" /> unreachable
          <span className="lg-line" /> choice
          <span className="lg-line dashed" /> conditional
          <span className="lg-line pending" /> proposed
          <span className="lg-line fallback" /> divert
        </span>
        <span className="spacer" />
        {layout && Object.keys(layout).length > 0 && (
          <button className="btn tiny" onClick={onResetLayout} title="Forget dragged positions and arrange automatically">
            Reset layout
          </button>
        )}
        <button className="btn tiny" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>
          +
        </button>
        <button className="btn tiny" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}>
          −
        </button>
        <button className="btn tiny" onClick={fit}>
          Fit
        </button>
      </div>
      <div className="map-frame">
        <svg
          ref={svg}
          className="graph"
          role="group"
          aria-label={`Story map: ${graph.nodes.length} passages and ${graph.edges.length} links. Use Tab to move between passages and Enter to open one. Drag a passage to move it.`}
          onWheel={(e) => {
            const r = svg.current!.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            setView((v) => {
              const k = Math.min(2.5, Math.max(0.2, v.k * f));
              return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
            });
          }}
          onPointerDown={(e) => {
            const node = (e.target as Element).closest('.node');
            const id = node?.getAttribute('data-id');
            (e.target as Element).setPointerCapture?.(e.pointerId);
            if (id) {
              const p = placed.get(id)!;
              nodeDrag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
            } else pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const nd = nodeDrag.current;
            if (nd) {
              const dx = (e.clientX - nd.sx) / view.k;
              const dy = (e.clientY - nd.sy) / view.k;
              if (!nd.moved && Math.hypot(dx, dy) * view.k < 4) return;
              nd.moved = true;
              setDragging({ id: nd.id, pos: { x: Math.round(nd.ox + dx), y: Math.round(nd.oy + dy) } });
              return;
            }
            if (!pan.current) return;
            const d = pan.current;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }}
          onPointerUp={() => {
            const nd = nodeDrag.current;
            nodeDrag.current = null;
            pan.current = null;
            if (!nd) return;
            if (nd.moved && dragging) onMove(nd.id, dragging.pos);
            else onOpen(nd.id);
            setDragging(null);
          }}
        >
          <defs>
            {['edge', 'cond', 'pending', 'fallback', 'hl'].map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={`arrowhead ${k}`} />
              </marker>
            ))}
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {graph.edges.map((e) => {
              const a = placed.get(e.from);
              const b = placed.get(e.to);
              if (!a) return null;
              const kind = e.pending ? 'pending' : e.kind === 'fallback' || e.kind === 'divert' ? 'fallback' : e.conditional ? 'cond' : 'edge';
              const hl = hover === e.from || hover === e.to || hoverEdge === e.id;
              const showLabel = !!e.label && (hoverEdge === e.id || hover === e.from);
              const { i, n } = lanes.get(e.id)!;
              const lane = i - (n - 1) / 2; // 0 for a lone edge; spreads parallel edges apart
              if (!b) {
                // END or missing destination
                const x1 = a.x + W;
                const y1 = a.y + H / 2 + clampLane(lane * 10);
                const missing = e.to !== 'END';
                return (
                  <g key={e.id} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
                    <line x1={x1} y1={y1} x2={x1 + 40} y2={y1} className={`edge ${missing ? 'missing' : kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`} />
                    <text x={x1 + 44} y={y1 + 4} className={`edge-end ${missing ? 'missing' : ''}`}>
                      {missing ? `⚠ ${e.to}` : 'Finis'}
                    </text>
                    {showLabel && <EdgeLabel x={x1 + 20} y={y1 - 14} text={e.label} />}
                  </g>
                );
              }
              const forward = b.x > a.x + W / 2;
              const x1 = forward ? a.x + W : a.x + W / 2 + lane * 18;
              const y1 = forward ? a.y + H / 2 + clampLane(lane * 10) : a.y + H;
              const x2 = forward ? b.x : b.x + W / 2 + lane * 18;
              const y2 = forward ? b.y + H / 2 + clampLane(lane * 10) : b.y + H;
              const dx = Math.max(40, (x2 - x1) / 2);
              const sag = Math.max(50, Math.abs(x2 - x1) * 0.25) + (lane + (n - 1) / 2) * 24;
              const c1 = forward ? [x1 + dx, y1 + lane * 26] : [x1, y1 + sag];
              const c2 = forward ? [x2 - dx, y2 + lane * 26] : [x2, y2 + sag];
              const end = forward ? [x2, y2] : [x2, y2 + 2];
              const d = `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${end[0]},${end[1]}`;
              // Midpoint of the cubic Bézier (t = 0.5) for the label.
              const mx = (x1 + 3 * c1[0] + 3 * c2[0] + end[0]) / 8;
              const my = (y1 + 3 * c1[1] + 3 * c2[1] + end[1]) / 8;
              return (
                <g key={e.id} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
                  <path d={d} className="edge-hit" />
                  <path d={d} className={`edge ${kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`} />
                  {showLabel && <EdgeLabel x={mx} y={my} text={e.kind === 'fallback' ? 'otherwise' : e.label} />}
                </g>
              );
            })}
            {graph.nodes.map((n) => {
              const p = placed.get(n.id)!;
              const reached = endingsReached?.[n.id];
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  className={`node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${n.reachable ? '' : 'unreachable'} ${selected === n.id ? 'selected' : ''} ${matches.includes(n.id) ? 'match' : ''} ${dragging?.id === n.id ? 'dragging' : ''} origin-${n.origin}`}
                  transform={`translate(${p.x},${p.y})`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(n.id);
                    }
                  }}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  role="button"
                  aria-description={`${n.isStart ? 'Start' : 'Passage'}${n.isEnding ? ', ending' : ''}${n.reachable ? '' : ', unreachable'}. ${graph.edges.filter((e) => e.from === n.id && !e.pending).length} outgoing links.`}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  <rect width={W} height={H} rx={3} />
                  <rect x={3} y={3} width={W - 6} height={H - 6} rx={2} className="node-inner" />
                  <text x={12} y={23} className="node-title">
                    {n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title}
                  </text>
                  <text x={12} y={41} className="node-id">
                    {n.id.length > 26 ? n.id.slice(0, 25) + '…' : n.id}
                    {reached ? `  · ${reached} runs` : ''}
                  </text>
                </g>
              );
            })}
          </g>
          <g transform={`translate(64, ${Math.max(120, size.h - 70)})`}>
            <Compass />
          </g>
        </svg>
        <div className="cartouche" aria-hidden>
          <span className="cartouche-kicker">A Map of</span>
          <span className="cartouche-title">{title}</span>
        </div>
        <svg
          className="minimap"
          width={MW}
          height={MH}
          role="img"
          aria-label="Minimap. Click to move the view."
          onPointerDown={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = (e.clientX - r.left - mox) / mk + bounds.minX;
            const y = (e.clientY - r.top - moy) / mk + bounds.minY;
            setView((v) => ({ ...v, x: size.w / 2 - x * v.k, y: size.h / 2 - y * v.k }));
          }}
        >
          {graph.nodes.map((n) => {
            const p = mm(placed.get(n.id)!);
            return <rect key={n.id} x={p.x} y={p.y} width={Math.max(2, W * mk)} height={Math.max(2, H * mk)} className={`mini-node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${matches.includes(n.id) ? 'match' : ''}`} />;
          })}
          <rect x={vp.x} y={vp.y} width={(size.w / view.k) * mk} height={(size.h / view.k) * mk} className="mini-view" />
        </svg>
      </div>
    </div>
  );
}
