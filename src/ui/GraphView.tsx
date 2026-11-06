import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { download } from './common';
import { plainKey } from './Shortcuts';
import type { StoryGraph } from '../core/analyzer';
import { errorData, log } from '../core/log';
import { CARD, storyLayout, type Position } from '../core/layout';
import { routeEdges } from '../core/edgeRouting';
import type { StoryProject } from '../core/isr';
import { PassageInspector } from './PassageInspector';
import { countBreaks, type Update } from './projectOps';

// The story map. Passages are laid out in columns by distance from the start (ordered to reduce
// crossings), can be dragged to new places (remembered in the project), searched, and navigated
// with a minimap. Drawn as an old map: cartouche, compass rose and ink routes.

const { W, H } = CARD;

const mapLog = log('map');
const slugName = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story';

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

// Presentation properties copied onto every element of an exported map, so it looks the same
// outside the app (stylesheets and theme variables don't travel with the file).
const MAP_STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'text-anchor', 'paint-order', 'stroke-linejoin', 'stroke-linecap'];

/** The whole map (not just the part in view) as a standalone SVG document with a title and the page colour. */
function mapSvg(live: SVGSVGElement, title: string): { svg: string; width: number; height: number } {
  const content = live.querySelector<SVGGElement>(':scope > g')!;
  const box = content.getBBox(); // story coordinates, before pan and zoom
  const pad = 40;
  const head = 56;
  const width = Math.ceil(box.width + pad * 2);
  const height = Math.ceil(box.height + pad * 2 + head);
  const out = live.cloneNode(true) as SVGSVGElement;
  // Inline the computed styles by walking the live and cloned trees side by side.
  const src = [live, ...live.querySelectorAll('*')];
  const dst = [out, ...out.querySelectorAll('*')];
  const hitAreas: Element[] = [];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i] as SVGElement;
    if (el.classList.contains('edge-hit')) hitAreas.push(target);
    target.setAttribute('style', MAP_STYLE_PROPS.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';'));
    target.removeAttribute('class');
    for (const a of ['tabindex', 'role', 'aria-description', 'data-id']) target.removeAttribute(a);
  });
  hitAreas.forEach((el) => el.remove()); // wide invisible strokes for hovering
  const g = out.querySelector(':scope > g')!;
  g.setAttribute('transform', `translate(${pad - box.x},${pad + head - box.y})`);
  out.removeAttribute('style');
  out.removeAttribute('aria-label');
  out.setAttribute('role', 'img');
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rootStyle = getComputedStyle(document.documentElement);
  const paper = rootStyle.getPropertyValue('--paper').trim() || '#fefae0';
  const ink = rootStyle.getPropertyValue('--ink').trim() || '#283618';
  const NS = 'http://www.w3.org/2000/svg';
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', paper);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(width / 2));
  t.setAttribute('y', String(pad + 8));
  t.setAttribute('style', `fill:${ink};font-family:'IM Fell English SC','EB Garamond',Georgia,serif;font-size:26px;text-anchor:middle;letter-spacing:0.04em`);
  t.textContent = `A Map of ${title}`;
  const label = document.createElementNS(NS, 'title');
  label.textContent = `Story map of ${title}`;
  out.prepend(label, bg, t);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}`, width, height };
}

/** Renders the exported SVG to a PNG at twice its size (sharp on high-density screens and in print). */
async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, 16000 / Math.max(width, height)); // browsers cap canvas size
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('The map is too large to save as a picture. Save it as SVG instead.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decorative compass rose, pinned to the frame's corner (outside the panned drawing, so it never clips). */
function Compass() {
  return (
    <svg className="compass" viewBox="-40 -54 80 94" width="58" height="68" aria-hidden>
      <circle r="30" className="compass-ring" />
      <circle r="24" className="compass-ring thin" />
      <path d="M0 -36 L6 0 L0 36 L-6 0 Z" className="compass-ns" />
      <path d="M-36 0 L0 -6 L36 0 L0 6 Z" className="compass-ew" />
      <text y="-42" textAnchor="middle" className="compass-n">
        N
      </text>
    </svg>
  );
}

type TagKind = 'start' | 'ending' | 'unreachable';
const TAG_LABEL: Record<TagKind, string> = { start: 'Start', ending: 'Ending', unreachable: 'Can’t be reached' };
const tagWidth = (kind: TagKind) => Math.round(TAG_LABEL[kind].length * 6.2 + 18);

/** A plain-word tag pinned to the top edge of a passage card. */
function NodeTag({ kind, x, y = -9 }: { kind: TagKind; x: number; y?: number }) {
  const w = tagWidth(kind);
  return (
    <g className={`node-tag tag-${kind}`} transform={`translate(${x},${y})`}>
      <rect width={w} height={18} rx={9} />
      <text x={w / 2} y={12.5} textAnchor="middle">
        {TAG_LABEL[kind]}
      </text>
    </g>
  );
}

/** Small sign at the middle of a route: a padlock (needs an item or value) or ◆ (suggested, waiting for approval). */
function RouteSign({ kind, x, y }: { kind: 'cond' | 'pending'; x: number; y: number }) {
  return (
    <g className={`route-sign ${kind}`} transform={`translate(${x},${y})`} pointerEvents="none">
      <circle r={9.5} />
      {kind === 'cond' ? (
        <>
          <path d="M-3.2 -0.5 V-3 A3.2 3.2 0 0 1 3.2 -3 V-0.5" className="sign-line" />
          <rect x={-4.6} y={-0.8} width={9.2} height={6.6} rx={1.3} className="sign-fill" />
        </>
      ) : (
        <path d="M0 -4.8 L4.8 0 L0 4.8 L-4.8 0 Z" className="sign-fill" />
      )}
    </g>
  );
}

/** How many Continue breaks a passage has, pinned to its card's bottom edge (decorative: the card's text says it). */
function BreakSign({ count, x, y, exit }: { count: number; x: number; y: number; exit?: boolean }) {
  const label = `${exit ? '⇥' : '⏸'} ${count}`;
  const w = label.length * 6.4 + 12;
  return (
    <g className={exit ? 'break-sign exit-sign' : 'break-sign'} transform={`translate(${x},${y})`} aria-hidden pointerEvents="none">
      <rect width={w} height={17} rx={8.5} />
      <text x={w / 2} y={12.5} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

const KEY_STORE = 'narrative-bridge.map-key';

/** The map's key, in plain words, drawn with the same marks as the map. */
function MapKey({ hiddenGated }: { hiddenGated: number }) {
  const line = (kind: string, sign?: 'cond' | 'pending') => (
    <svg width="58" height="20" aria-hidden>
      <path d="M2 10 H50" className={`edge ${kind}`} markerEnd={`url(#arrow-${kind})`} />
      {sign && <RouteSign kind={sign} x={26} y={10} />}
    </svg>
  );
  const tag = (kind: TagKind) => (
    <svg width={tagWidth(kind) + 2} height="20" aria-hidden>
      <NodeTag kind={kind} x={1} y={1} />
    </svg>
  );
  return (
    <ul className="map-key" aria-label="Map key">
      <li>{tag('start')} the story begins here</li>
      <li>{tag('ending')} the story can end here</li>
      <li>{tag('unreachable')} no route leads here yet</li>
      <li>{line('edge')} a choice</li>
      <li>
        {line('cond', 'cond')} a choice that needs an item or value
        {hiddenGated > 0 && <span className="muted"> ({hiddenGated} locked route{hiddenGated === 1 ? '' : 's'} hidden; press “Locked routes” to see them)</span>}
      </li>
      <li>{line('fallback')} continues on its own</li>
      <li>{line('pending', 'pending')} suggested, waiting for your OK</li>
      <li>
        <svg width="40" height="20" aria-hidden>
          <BreakSign count={2} x={2} y={1} />
        </svg>{' '}
        Continue breaks inside the passage
      </li>
      <li>
        <svg width="40" height="20" aria-hidden>
          <BreakSign count={1} x={2} y={1} exit />
        </svg>{' '}
        exits to the game (gameplay takes over)
      </li>
    </ul>
  );
}

export function GraphView({
  graph,
  start,
  selected,
  onOpen,
  onSelect,
  project,
  update,
  endingsReached,
  title,
  layout,
  onMove,
  onResetLayout,
  showGated,
  onShowGated,
}: {
  graph: StoryGraph;
  start: string;
  selected?: string;
  onOpen: (id: string) => void;
  /** Selects a passage on the map (and opens the passage panel). */
  onSelect: (id: string) => void;
  /** The live project, for the passage panel and break counts (the graph comes from the processed copy). */
  project: StoryProject;
  update: Update;
  endingsReached?: Record<string, number>;
  title: string;
  layout?: Record<string, Position>;
  onMove: (id: string, pos: Position) => void;
  onResetLayout: () => void;
  /** Whether routes that need an item or value are drawn. */
  showGated: boolean;
  onShowGated: (on: boolean) => void;
}) {
  const edges = useMemo(() => (showGated ? graph.edges : graph.edges.filter((e) => !e.conditional)), [graph.edges, showGated]);
  // The passage panel: open after a passage is clicked (or chosen with Space), closed with Esc or ×.
  const [inspecting, setInspecting] = useState(false);
  const breaks = useMemo(() => new Map(project.passages.map((p) => [p.id, countBreaks(p)])), [project]);
  const exits = useMemo(() => new Map(project.passages.map((p) => [p.id, p.content.filter((b) => b.type === 'exit').map((b) => (b.type === 'exit' ? b.name : ''))])), [project]);
  const auto = useMemo(() => storyLayout(graph, start), [graph, start]);
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
  // Each arrow leaves and enters its cards by whichever sides make the least clutter (see edgeRouting.ts).
  const routes = useMemo(
    () => routeEdges(new Map([...placed].map(([id, p]) => [id, { x: p.x, y: p.y, w: W, h: H }])), edges.filter((e) => placed.has(e.to)).map((e) => ({ id: e.id, from: e.from, to: e.to }))),
    [placed, edges],
  );
  const lanes = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const e of edges) {
      const key = `${e.from}->${e.to}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(e.id);
    }
    const out = new Map<string, { i: number; n: number }>();
    for (const ids of groups.values()) ids.forEach((id, i) => out.set(id, { i, n: ids.length }));
    return out;
  }, [edges]);

  // Whether the reader has panned or zoomed since the last fit; if not, the map refits on resize.
  const moved = useRef(false);
  const fit = () => {
    const el = svg.current;
    if (!el) return;
    // The frame's own size: unlike getBoundingClientRect, not shrunk while the page-turn animation runs.
    const box = el.getBoundingClientRect();
    const r = { width: el.clientWidth || box.width, height: el.clientHeight || box.height };
    if (!r.width || !r.height) return;
    moved.current = false;
    setSize({ w: r.width, h: r.height });
    const pad = Math.min(60, Math.max(14, r.width * 0.05)); // smaller margins on small screens
    const k = Math.min(1.2, Math.max(0.45, Math.min((r.width - 2 * pad) / bounds.width, (r.height - 2 * pad) / bounds.height)));
    setView({ x: (r.width - bounds.width * k) / 2 - bounds.minX * k, y: (r.height - bounds.height * k) / 2 - bounds.minY * k, k });
  };
  const centerOn = (id: string) => {
    const p = placed.get(id);
    const r = svg.current?.getBoundingClientRect();
    if (!p || !r) return;
    moved.current = true;
    setView((v) => ({ ...v, x: r.width / 2 - (p.x + W / 2) * v.k, y: r.height / 2 - (p.y + H / 2) * v.k }));
  };
  // Fit when the map's overall size changes (not on every edit, so panning is preserved).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(fit, [Math.round(bounds.width), Math.round(bounds.height)]);
  // Follow the frame's size (window resizes, the side panel opening), so the overlays and the
  // minimap's view box stay right. Deferred a frame to avoid resize-observer loops in WebKit.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // Fit again once the chapter has finished opening, so the whole map shows without pressing Fit.
  useEffect(() => {
    const t = [80, 450].map((ms) => setTimeout(() => !moved.current && fitRef.current(), ms));
    return () => t.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    const el = svg.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (moved.current) setSize({ w: r.width, h: r.height });
        else fitRef.current();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const inspect = (id: string) => {
    // The panel narrows the map: keep the view where it is rather than refitting under the reader's hand.
    moved.current = true;
    onSelect(id);
    setInspecting(true);
  };
  // Once the panel has narrowed the map, bring the selected passage into view if it went under the panel.
  useEffect(() => {
    if (!inspecting || !selected) return;
    const r = svg.current?.getBoundingClientRect();
    const card = svg.current?.querySelector(`.node[data-id="${CSS.escape(selected)}"]`)?.getBoundingClientRect();
    if (r && card && (card.right > r.right || card.left < r.left || card.bottom > r.bottom || card.top < r.top)) centerOn(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspecting, selected]);
  const closeInspector = () => {
    setInspecting(false);
    if (selected) svg.current?.querySelector<SVGGElement>(`.node[data-id="${CSS.escape(selected)}"]`)?.focus();
  };
  const zoomBy = (f: number) => {
    moved.current = true;
    setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.2, v.k * f)) }));
  };
  // The key starts open, except on phones where it would crowd the map; the choice is remembered.
  const [showKey, setShowKey] = useState(() => {
    const wide = typeof window === 'undefined' || window.innerWidth > 760;
    try {
      const saved = localStorage.getItem(KEY_STORE);
      return saved ? saved === 'shown' : wide;
    } catch {
      return wide;
    }
  });
  const toggleKey = () => {
    setShowKey(!showKey);
    try {
      localStorage.setItem(KEY_STORE, showKey ? 'hidden' : 'shown');
    } catch {
      /* remembered for this visit only */
    }
  };

  // Map keys: / find, F fit, + and − zoom.
  const mapKeys = useRef({ fit, zoom: zoomBy });
  mapKeys.current = { fit, zoom: zoomBy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e)) return;
      if (e.key === '/') document.querySelector<HTMLInputElement>('.graph-search')?.focus();
      else if (e.key.toLowerCase() === 'f') mapKeys.current.fit();
      else if (e.key === '+' || e.key === '=') mapKeys.current.zoom(1.2);
      else if (e.key === '-' || e.key === '_') mapKeys.current.zoom(1 / 1.2);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveMap = async (format: 'svg' | 'png') => {
    if (!svg.current) return;
    const name = `${slugName(title)}-map`;
    try {
      const m = mapSvg(svg.current, title);
      if (format === 'svg') download(`${name}.svg`, m.svg, 'image/svg+xml');
      else download(`${name}.png`, await svgToPng(m.svg, m.width, m.height), 'image/png');
      mapLog.info('Saved story map', { format, passages: graph.nodes.length, width: m.width, height: m.height });
    } catch (e) {
      mapLog.error('Could not save story map', errorData(e));
      alert(e instanceof Error ? e.message : String(e));
    }
  };

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
        <span className="spacer" />
        <span className="tool-group" role="group" aria-label="Zoom">
          <button className="btn tiny" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button className="btn tiny" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
            +
          </button>
          <button className="btn tiny" onClick={fit} title="Show the whole map (F)">
            Fit
          </button>
        </span>
        {layout && Object.keys(layout).length > 0 && (
          <button className="btn tiny" onClick={onResetLayout} title="Forget dragged positions and arrange automatically">
            Reset layout
          </button>
        )}
        <span className="tool-group" role="group" aria-label="Save the map">
          <button className="btn tiny" onClick={() => saveMap('svg')} title="Save the whole map as a scalable image (SVG)">
            Save map
          </button>
          <button className="btn tiny" onClick={() => saveMap('png')} title="Save the whole map as a picture (PNG)">
            PNG
          </button>
        </span>
        <button
          className={`btn tiny ${showGated ? 'ok' : ''}`}
          aria-pressed={showGated}
          onClick={() => onShowGated(!showGated)}
          title="Locked routes are choices that need an item or a value first (like a key). Show or hide them (G)"
        >
          🔒 Locked routes
        </button>
        <button className="btn tiny" aria-pressed={showKey} onClick={toggleKey} title="Show or hide what the marks on the map mean">
          Key
        </button>
      </div>
      <div className="map-frame">
        <div className="map-canvas">
        <svg
          ref={svg}
          className="graph"
          role="group"
          aria-label={`Story map: ${graph.nodes.length} passages and ${edges.length} links${edges.length < graph.edges.length ? ` (${graph.edges.length - edges.length} locked routes hidden)` : ''}. Tab moves between passages, Space shows a passage's lines, Enter opens it in Review. Drag a passage to move it.`}
          onWheel={(e) => {
            const r = svg.current!.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            moved.current = true;
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
            moved.current = true;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }}
          onPointerUp={() => {
            const nd = nodeDrag.current;
            nodeDrag.current = null;
            pan.current = null;
            if (!nd) return;
            if (nd.moved && dragging) onMove(nd.id, dragging.pos);
            else inspect(nd.id);
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
            {edges.map((e) => {
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
                      {missing ? `⚠ Missing: ${e.to}` : 'The End'}
                    </text>
                    {(kind === 'cond' || kind === 'pending') && !missing && <RouteSign kind={kind} x={x1 + 20} y={y1} />}
                    {showLabel && <EdgeLabel x={x1 + 20} y={y1 - 14} text={e.label} />}
                  </g>
                );
              }
              const route = routes.get(e.id)!;
              const d = route.d;
              const [mx, my] = route.mid;
              return (
                <g key={e.id} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
                  <path d={d} className="edge-hit" />
                  <path d={d} className={`edge ${kind} ${hl ? 'hl' : ''}`} markerEnd={`url(#arrow-${hl ? 'hl' : kind})`} />
                  {(kind === 'cond' || kind === 'pending') && !showLabel && <RouteSign kind={kind} x={mx} y={my} />}
                  {showLabel && <EdgeLabel x={mx} y={my} text={e.kind === 'fallback' ? 'otherwise' : e.label} />}
                </g>
              );
            })}
            {graph.nodes.map((n) => {
              const p = placed.get(n.id)!;
              const reached = endingsReached?.[n.id];
              const tags: TagKind[] = [...(n.isStart ? ['start' as const] : []), ...(n.isEnding ? ['ending' as const] : []), ...(n.reachable ? [] : ['unreachable' as const])];
              const out = graph.edges.filter((e) => e.from === n.id && !e.pending).length;
              const about = [
                n.isStart ? 'The story begins here.' : '',
                n.isEnding ? 'The story can end here.' : '',
                n.reachable ? '' : 'No route leads here yet.',
                out ? `${out} route${out === 1 ? '' : 's'} lead${out === 1 ? 's' : ''} on.` : '',
                reached ? `Reached in ${reached} automated test play${reached === 1 ? '' : 's'}.` : '',
                breaks.get(n.id) ? `${breaks.get(n.id)} Continue break${breaks.get(n.id) === 1 ? '' : 's'}.` : '',
                exits.get(n.id)?.length ? `Exits to the game: ${exits.get(n.id)!.join(', ')}.` : '',
              ]
                .filter(Boolean)
                .join(' ');
              let tagX = 10;
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  className={`node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${n.reachable ? '' : 'unreachable'} ${selected === n.id ? 'selected' : ''} ${matches.includes(n.id) ? 'match' : ''} ${dragging?.id === n.id ? 'dragging' : ''} origin-${n.origin}`}
                  transform={`translate(${p.x},${p.y})`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onOpen(n.id);
                    } else if (e.key === ' ') {
                      e.preventDefault();
                      inspect(n.id);
                    }
                  }}
                  onDoubleClick={() => onOpen(n.id)}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  role="button"
                  aria-description={about}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  <title>{`${n.title}${about ? ` — ${about}` : ''} Click to see its lines, double-click to edit, drag to move.`}</title>
                  <rect width={W} height={H} rx={3} />
                  <rect x={3} y={3} width={W - 6} height={H - 6} rx={2} className="node-inner" />
                  <text x={12} y={tags.length ? 26 : 24} className="node-title">
                    {n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title}
                  </text>
                  <text x={12} y={tags.length ? 43 : 41} className="node-id">
                    {n.id.length > 26 ? n.id.slice(0, 25) + '…' : n.id}
                  </text>
                  {tags.map((t) => {
                    const x = tagX;
                    tagX += tagWidth(t) + 5;
                    return <NodeTag key={t} kind={t} x={x} />;
                  })}
                  {!!breaks.get(n.id) && <BreakSign count={breaks.get(n.id)!} x={W - 46} y={H - 9} />}
                  {!!exits.get(n.id)?.length && <BreakSign count={exits.get(n.id)!.length} x={breaks.get(n.id) ? W - 92 : W - 46} y={H - 9} exit />}
                </g>
              );
            })}
          </g>
        </svg>
        {size.w >= 560 && size.h >= 300 && <Compass />}
        <div className="cartouche" aria-hidden>
          <span className="cartouche-kicker">A Map of</span>
          <span className="cartouche-title">{title}</span>
        </div>
        {size.w >= 520 && size.h >= 400 && (
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
            moved.current = true;
            setView((v) => ({ ...v, x: size.w / 2 - x * v.k, y: size.h / 2 - y * v.k }));
          }}
        >
          {graph.nodes.map((n) => {
            const p = mm(placed.get(n.id)!);
            return <rect key={n.id} x={p.x} y={p.y} width={Math.max(2, W * mk)} height={Math.max(2, H * mk)} className={`mini-node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${matches.includes(n.id) ? 'match' : ''}`} />;
          })}
          <rect x={vp.x} y={vp.y} width={(size.w / view.k) * mk} height={(size.h / view.k) * mk} className="mini-view" />
        </svg>
        )}
        </div>
        {inspecting && selected && project.passages.some((p) => p.id === selected) && (
          <PassageInspector project={project} passageId={selected} update={update} onOpen={onOpen} onClose={closeInspector} />
        )}
      </div>
      {showKey && <MapKey hiddenGated={graph.edges.length - edges.length} />}
    </div>
  );
}
