import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { download } from './common';
import { plainKey } from './Shortcuts';
import type { StoryGraph } from '../core/analyzer';
import { errorData, log } from '../core/log';
import { CARD, loopRoutes, storyLayout, type Position } from '../core/layout';
import { foldGraph, sceneGroups, traceRoutes } from '../core/scenes';
import { StoryOutline } from './StoryOutline';
import { routeEdges } from '../core/edgeRouting';
import { fileBase, type StoryProject } from '../core/isr';
import { PassageInspector } from './PassageInspector';
import { NewSceneSheet, sceneFix, type SceneRequest } from './NewScene';
import { countBreaks, type Update } from './projectOps';
import { Compass, MapKey } from './graph/MapParts';
import { mapSvg, svgToPng } from './graph/mapImage';
import { useMapGestures } from './graph/useMapGestures';
import { MapEdges } from './graph/MapEdges';
import { MapNodes } from './graph/MapNodes';
import { MiniMap } from './graph/MiniMap';
import { Toolbar } from './graph/Toolbar';

// The story map. Passages are laid out in columns by distance from the start (ordered to reduce
// crossings), can be dragged to new places (remembered in the project), searched, and navigated
// with a minimap. Drawn as an old map: cartouche, compass rose and ink routes.

const { W, H } = CARD;

const mapLog = log('map');

const KEY_STORE = 'narrative-bridge.map-key';
/** The smallest zoom at which a card's title can still be read on a phone (see fit). */
const MIN_READABLE = 0.6;

/** A map setting remembered in this browser. */
function useRemembered<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* this visit only */
      }
    },
  ];
}

export function GraphView({
  graph: fullGraph,
  start: fullStart,
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
  // Outline or map, focus on the selected passage, and how strongly straight-on routes are drawn: remembered here.
  const [mode, setMode] = useRemembered<'map' | 'outline'>('narrative-bridge.map-mode', 'map');
  const [focusMode, setFocusMode] = useRemembered<'on' | 'off'>('narrative-bridge.map-focus', 'on');
  const [straight, setStraight] = useRemembered<'full' | 'faint'>('narrative-bridge.map-straight', 'full');
  // Scenes (passages under one scene heading) can be folded into one card; which are folded is kept per story.
  const groups = useMemo(() => sceneGroups(project), [project]);
  const foldKey = `narrative-bridge.map-folded.${project.project.id}`;
  const [folded, setFoldedState] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(foldKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const setFolded = (next: Set<string>) => {
    setFoldedState(next);
    try {
      localStorage.setItem(foldKey, JSON.stringify([...next]));
    } catch {
      /* this visit only */
    }
  };
  const [showScenes, setShowScenes] = useState(false);
  const { graph, of } = useMemo(() => foldGraph(fullGraph, groups, folded), [fullGraph, groups, folded]);
  const start = of.get(fullStart) ?? fullStart;
  const sceneOf = useMemo(() => new Map(groups.flatMap((g, i) => g.members.map((m) => [m, i] as const))), [groups]);
  // Trace: every route from the start to one passage.
  const [trace, setTrace] = useState('');
  const edges = useMemo(() => (showGated ? graph.edges : graph.edges.filter((e) => !e.conditional)), [graph.edges, showGated]);
  const loops = useMemo(() => loopRoutes(graph, start), [graph, start]);
  const isLoop = (e: { from: string; to: string }) => loops.has(`${e.from}>${e.to}`);
  // The passage panel: open after a passage is clicked (or chosen with Space), closed with Esc or ×.
  const [inspecting, setInspecting] = useState(false);
  // The New scene form: after a passage, or on its own (at a place on the map when the map was double-clicked).
  const [sceneForm, setSceneForm] = useState<SceneRequest | null>(null);
  const breaks = useMemo(() => new Map(project.passages.map((p) => [p.id, countBreaks(p)])), [project]);
  const exits = useMemo(
    () => new Map(project.passages.map((p) => [p.id, p.content.filter((b) => b.type === 'exit').map((b) => (b.type === 'exit' ? b.name : ''))])),
    [project],
  );
  const auto = useMemo(() => storyLayout(graph, start), [graph, start]);
  // What's lit: a traced route, or the selected passage and its neighbours; everything else is dimmed.
  const lit = useMemo(() => {
    if (trace) {
      const t = traceRoutes(edges, start, of.get(trace) ?? trace);
      return t.nodes.size ? t : null;
    }
    const sel = selected ? (of.get(selected) ?? selected) : '';
    if (focusMode !== 'on' || !inspecting || !sel || !graph.nodes.some((n) => n.id === sel)) return null;
    const near = edges.filter((e) => e.from === sel || e.to === sel);
    return { nodes: new Set([sel, ...near.map((e) => e.from), ...near.map((e) => e.to)]), edges: new Set(near.map((e) => e.id)) };
  }, [trace, edges, start, of, selected, focusMode, inspecting, graph.nodes]);
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
    () =>
      routeEdges(
        new Map([...placed].map(([id, p]) => [id, { x: p.x, y: p.y, w: W, h: H }])),
        edges.filter((e) => placed.has(e.to) && !isLoop(e)).map((e) => ({ id: e.id, from: e.from, to: e.to })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placed, edges, loops],
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
  /** Whether the map last opened at a readable size on a small screen, rather than showing all of it. */
  const [readable, setReadable] = useState(false);
  /**
   * Shows the whole map. On a phone-sized frame, where the whole map would shrink the cards past reading, the map
   * opens at a readable size on the start passage instead (unless `whole`, as from the Fit button): drag to move.
   */
  const fit = (whole = false) => {
    const el = svg.current;
    if (!el) return;
    // The frame's own size: unlike getBoundingClientRect, not shrunk while the page-turn animation runs.
    const box = el.getBoundingClientRect();
    const r = { width: el.clientWidth || box.width, height: el.clientHeight || box.height };
    if (!r.width || !r.height) return;
    moved.current = false;
    setSize({ w: r.width, h: r.height });
    const pad = Math.min(60, Math.max(14, r.width * 0.05)); // smaller margins on small screens
    const k = Math.min(1.2, Math.max(0.2, Math.min((r.width - 2 * pad) / bounds.width, (r.height - 2 * pad) / bounds.height)));
    const first = placed.get(start);
    if (!whole && r.width < 640 && k < MIN_READABLE && first) {
      setReadable(true);
      const kr = MIN_READABLE;
      setView({ x: pad - first.x * kr, y: Math.max(pad - bounds.minY * kr, r.height / 2 - (first.y + H / 2) * kr), k: kr });
      return;
    }
    setReadable(false);
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

  // Map keys: / find, F fit, N new scene, + and − zoom.
  // A route to a passage that doesn't exist: click it to create that passage.
  const fixMissing = (to: string, from: string) => sceneFix('INK_TARGET_MISSING', { target: to, passageId: from }, from, project)?.request ?? null;
  const unfold = (nodeId: string) => {
    const next = new Set(folded);
    next.delete(nodeId.slice(6));
    setFolded(next);
  };
  const newScene = () => setSceneForm(selected && project.passages.some((p) => p.id === selected) ? { from: selected } : {});
  const mapKeys = useRef({ fit, zoom: zoomBy, newScene });
  mapKeys.current = { fit, zoom: zoomBy, newScene };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e)) return;
      if (e.key === '/') document.querySelector<HTMLInputElement>('.graph-search')?.focus();
      else if (e.key.toLowerCase() === 'f') mapKeys.current.fit(true);
      else if (e.key.toLowerCase() === 'n') mapKeys.current.newScene();
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
    const name = `${fileBase(project)}-map`;
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

  const gestures = useMapGestures({ svg, view, setView, placed, dragging, setDragging, moved, unfold, inspect, onMove, setSceneForm });

  return (
    <div className="view graph-view">
      <Toolbar
        mode={mode}
        setMode={setMode}
        query={query}
        setQuery={setQuery}
        matches={matches}
        centerOn={centerOn}
        newScene={newScene}
        fullGraph={fullGraph}
        trace={trace}
        setTrace={setTrace}
        focusMode={focusMode}
        setFocusMode={setFocusMode}
        straight={straight}
        setStraight={setStraight}
        groups={groups}
        folded={folded}
        setFolded={setFolded}
        showScenes={showScenes}
        setShowScenes={setShowScenes}
        zoomBy={zoomBy}
        fit={fit}
        readable={readable}
        layout={layout}
        onResetLayout={onResetLayout}
        saveMap={saveMap}
        showGated={showGated}
        onShowGated={onShowGated}
        showKey={showKey}
        toggleKey={toggleKey}
      />
      {mode === 'outline' ? (
        <StoryOutline project={project} onOpen={onOpen} selected={selected} />
      ) : (
        <>
          <div className="map-frame">
            <div className="map-canvas">
              <svg
                ref={svg}
                className="graph"
                role="group"
                aria-label={`Story map: ${graph.nodes.length} passages and ${edges.length} links${edges.length < graph.edges.length ? ` (${graph.edges.length - edges.length} locked routes hidden)` : ''}. Tab moves between passages, Space shows a passage's lines, Enter opens it in Review, N adds a new scene. Drag a passage to move it.`}
                {...gestures}
              >
                <defs>
                  {['edge', 'cond', 'forced', 'pending', 'fallback', 'hl'].map((k) => (
                    <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" className={`arrowhead ${k}`} />
                    </marker>
                  ))}
                </defs>
                <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                  <MapEdges
                    graph={graph}
                    edges={edges}
                    placed={placed}
                    lanes={lanes}
                    routes={routes}
                    hover={hover}
                    hoverEdge={hoverEdge}
                    setHoverEdge={setHoverEdge}
                    lit={lit}
                    trace={trace}
                    straight={straight}
                    isLoop={isLoop}
                    fixMissing={fixMissing}
                    centerOn={centerOn}
                    setSceneForm={setSceneForm}
                  />
                  <MapNodes
                    graph={graph}
                    placed={placed}
                    lit={lit}
                    groups={groups}
                    sceneOf={sceneOf}
                    endingsReached={endingsReached}
                    breaks={breaks}
                    exits={exits}
                    selected={selected}
                    matches={matches}
                    dragging={dragging}
                    setHover={setHover}
                    unfold={unfold}
                    onOpen={onOpen}
                    inspect={inspect}
                  />
                </g>
              </svg>
              {size.w >= 560 && size.h >= 300 && <Compass />}
              <div className="cartouche" aria-hidden>
                <span className="cartouche-kicker">A Map of</span>
                <span className="cartouche-title">{title}</span>
              </div>
              {size.w >= 520 && size.h >= 400 && (
                <MiniMap
                  graph={graph}
                  placed={placed}
                  view={view}
                  setView={setView}
                  size={size}
                  moved={moved}
                  matches={matches}
                  geometry={{ MW, MH, mk, mox, moy, bounds, mm, vp }}
                />
              )}
            </div>
            {inspecting && selected && project.passages.some((p) => p.id === selected) && (
              <PassageInspector
                project={project}
                passageId={selected}
                update={update}
                onOpen={onOpen}
                onClose={closeInspector}
                onAddScene={(link) => setSceneForm({ from: selected, link })}
              />
            )}
          </div>
          {showKey && <MapKey hiddenGated={graph.edges.length - edges.length} />}
        </>
      )}
      {sceneForm && (
        <NewSceneSheet
          project={project}
          update={update}
          request={sceneForm}
          onCreated={(id) => {
            moved.current = true;
            onSelect(id);
            setInspecting(true);
          }}
          onClose={() => setSceneForm(null)}
        />
      )}
    </div>
  );
}
