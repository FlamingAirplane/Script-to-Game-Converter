import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryGraph } from '../core/analyzer';

const W = 188;
const H = 56;
const GX = 96;
const GY = 26;

interface Placed {
  id: string;
  x: number;
  y: number;
}

function layout(graph: StoryGraph, start: string) {
  const ids = graph.nodes.map((n) => n.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const depth = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const e of graph.edges) if (!e.pending) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
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
  // Unreachable nodes go in a trailing column, in source order.
  for (const id of ids) if (!depth.has(id)) depth.set(id, maxD + 1);
  const cols = new Map<number, string[]>();
  for (const id of ids) (cols.get(depth.get(id)!) ?? cols.set(depth.get(id)!, []).get(depth.get(id)!)!).push(id);
  const placed = new Map<string, Placed>();
  let maxRows = 0;
  for (const [d, list] of cols) {
    list.sort((a, b) => order.get(a)! - order.get(b)!);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((id, i) => placed.set(id, { id, x: d * (W + GX), y: i * (H + GY) }));
  }
  // Vertically centre each column.
  const totalH = maxRows * (H + GY);
  for (const [, list] of cols) {
    const off = (totalH - list.length * (H + GY)) / 2;
    list.forEach((id) => (placed.get(id)!.y += off));
  }
  return { placed, width: (Math.max(...cols.keys()) + 1) * (W + GX), height: totalH };
}

export function GraphView({ graph, start, selected, onOpen, endingsReached }: { graph: StoryGraph; start: string; selected?: string; onOpen: (id: string) => void; endingsReached?: Record<string, number> }) {
  const { placed, width, height } = useMemo(() => layout(graph, start), [graph, start]);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  const fit = () => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.min(1.2, Math.max(0.25, Math.min((r.width - 80) / width, (r.height - 80) / height)));
    setView({ x: (r.width - width * k) / 2, y: (r.height - height * k) / 2, k });
  };
  // Fit once when the graph's overall size changes (not on every edit, so panning is preserved).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(fit, [width, height]);

  return (
    <div className="view graph-view">
      <div className="graph-toolbar">
        <span className="legend">
          <span className="lg lg-start" /> start
          <span className="lg lg-end" /> ending
          <span className="lg lg-unreach" /> unreachable
          <span className="lg-line" /> choice
          <span className="lg-line dashed" /> conditional
          <span className="lg-line pending" /> proposed
          <span className="lg-line fallback" /> divert / fallback
        </span>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>
          +
        </button>
        <button className="btn tiny" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}>
          −
        </button>
        <button className="btn tiny" onClick={fit}>
          Fit
        </button>
      </div>
      <svg
        ref={svg}
        className="graph"
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
          if ((e.target as Element).closest('.node')) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const d = drag.current;
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
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
            const hl = hover && (e.from === hover || e.to === hover);
            if (!b) {
              // END or missing destination
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const missing = e.to !== 'END';
              return (
                <g key={e.id}>
                  <line x1={x1} y1={y1} x2={x1 + 40} y2={y1} className={`edge ${missing ? 'missing' : kind}`} markerEnd={`url(#arrow-${kind})`} />
                  <text x={x1 + 44} y={y1 + 4} className={`edge-end ${missing ? 'missing' : ''}`}>
                    {missing ? `⚠ ${e.to}` : 'END'}
                  </text>
                </g>
              );
            }
            const forward = b.x > a.x;
            const x1 = forward ? a.x + W : a.x + W / 2;
            const y1 = forward ? a.y + H / 2 : a.y + H;
            const x2 = forward ? b.x : b.x + W / 2;
            const y2 = forward ? b.y + H / 2 : b.y + H;
            const dx = Math.max(40, (x2 - x1) / 2);
            const sag = Math.max(50, Math.abs(x2 - x1) * 0.25);
            const d = forward ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + sag} ${x2},${y2 + sag} ${x2},${y2 + 2}`;
            return (
              <g key={e.id}>
                <path d={d} className={`edge ${kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`}>
                  <title>{e.label || e.kind}</title>
                </path>
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = placed.get(n.id)!;
            const reached = endingsReached?.[n.id];
            return (
              <g
                key={n.id}
                className={`node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${n.reachable ? '' : 'unreachable'} ${selected === n.id ? 'selected' : ''} origin-${n.origin}`}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => onOpen(n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
              >
                <rect width={W} height={H} rx={8} />
                <text x={12} y={22} className="node-title">
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
      </svg>
    </div>
  );
}
