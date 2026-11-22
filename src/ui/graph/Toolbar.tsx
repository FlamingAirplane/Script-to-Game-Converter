import type { StoryGraph } from '../../core/analyzer';
import type { Position } from '../../core/layout';
import type { SceneGroup } from '../../core/scenes';

/** "Trace the ways to…": lights up every route from the start to one passage. */
function TraceSelect({ nodes, trace, setTrace }: { nodes: StoryGraph['nodes']; trace: string; setTrace: (id: string) => void }) {
  return (
    <select
      className="input small trace-select"
      value={trace}
      onChange={(e) => setTrace(e.target.value)}
      aria-label="Show every way to a passage"
      title="Light up every route from the start to one passage; the rest of the map dims"
    >
      <option value="">Trace the ways to…</option>
      <optgroup label="Endings">
        {nodes
          .filter((n) => n.isEnding)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
      </optgroup>
      <optgroup label="Any passage">
        {nodes
          .filter((n) => !n.isEnding)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
      </optgroup>
    </select>
  );
}

/** "Scenes": fold a scene's passages into one card. */
function ScenesMenu({
  groups,
  folded,
  setFolded,
  showScenes,
  setShowScenes,
}: {
  groups: SceneGroup[];
  folded: Set<string>;
  setFolded: (next: Set<string>) => void;
  showScenes: boolean;
  setShowScenes: (on: boolean) => void;
}) {
  if (groups.length < 2) return null;
  return (
    <span className="scenes-menu">
      <button
        className={`btn tiny ${folded.size ? 'ok' : ''}`}
        aria-expanded={showScenes}
        onClick={() => setShowScenes(!showScenes)}
        title="Fold a scene's passages into one card"
      >
        Scenes{folded.size ? ` (${folded.size} folded)` : ''}
      </button>
      {showScenes && (
        <div className="scenes-popover card" role="group" aria-label="Fold scenes">
          <div className="row">
            <button className="btn tiny" onClick={() => setFolded(new Set(groups.filter((g) => g.members.length > 1).map((g) => g.id)))}>
              Fold all
            </button>
            <button className="btn tiny" onClick={() => setFolded(new Set())}>
              Unfold all
            </button>
            <span className="spacer" />
            <button className="btn tiny ghost" aria-label="Close" onClick={() => setShowScenes(false)}>
              ×
            </button>
          </div>
          <ul>
            {groups.map((g, i) => (
              <li key={g.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={g.members.length < 2}
                    checked={folded.has(g.id)}
                    onChange={(e) => {
                      const next = new Set(folded);
                      if (e.target.checked) next.add(g.id);
                      else next.delete(g.id);
                      setFolded(next);
                    }}
                  />
                  <span className={`scene-swatch scene-c${i % 6}`} aria-hidden />
                  {g.title} <span className="muted small">({g.members.length})</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

/** The row above the map: outline or map, find, new scene, trace, focus, scenes, zoom, save, locked routes, key. */
export function Toolbar({
  mode,
  setMode,
  query,
  setQuery,
  matches,
  centerOn,
  newScene,
  fullGraph,
  trace,
  setTrace,
  focusMode,
  setFocusMode,
  straight,
  setStraight,
  groups,
  folded,
  setFolded,
  showScenes,
  setShowScenes,
  zoomBy,
  fit,
  readable,
  layout,
  onResetLayout,
  saveMap,
  showGated,
  onShowGated,
  showKey,
  toggleKey,
}: {
  mode: 'map' | 'outline';
  setMode: (m: 'map' | 'outline') => void;
  query: string;
  setQuery: (q: string) => void;
  /** The passages the search found. */
  matches: string[];
  centerOn: (id: string) => void;
  /** Opens the New scene form (after the selected passage, if there is one). */
  newScene: () => void;
  /** The whole story's graph, so a trace can reach passages inside folded scenes. */
  fullGraph: StoryGraph;
  trace: string;
  setTrace: (id: string) => void;
  focusMode: 'on' | 'off';
  setFocusMode: (m: 'on' | 'off') => void;
  straight: 'full' | 'faint';
  setStraight: (s: 'full' | 'faint') => void;
  groups: SceneGroup[];
  folded: Set<string>;
  setFolded: (next: Set<string>) => void;
  showScenes: boolean;
  setShowScenes: (on: boolean) => void;
  zoomBy: (factor: number) => void;
  fit: (whole?: boolean) => void;
  /** The map opened at a readable size rather than showing all of it. */
  readable: boolean;
  layout?: Record<string, Position>;
  onResetLayout: () => void;
  saveMap: (format: 'svg' | 'png') => void;
  showGated: boolean;
  onShowGated: (on: boolean) => void;
  showKey: boolean;
  toggleKey: () => void;
}) {
  return (
    <div className="graph-toolbar">
      <span className="tool-group" role="group" aria-label="Show the story as">
        <button
          className={`btn tiny ${mode === 'map' ? 'ok' : ''}`}
          aria-pressed={mode === 'map'}
          onClick={() => setMode('map')}
          title="The story as a map of passages and routes"
        >
          Map
        </button>
        <button
          className={`btn tiny ${mode === 'outline' ? 'ok' : ''}`}
          aria-pressed={mode === 'outline'}
          onClick={() => setMode('outline')}
          title="The story as an indented list that reads like a branching script"
        >
          Outline
        </button>
      </span>
      {mode === 'map' && (
        <input
          className="input small graph-search"
          placeholder="Find a passage…"
          value={query}
          aria-label="Find a passage on the map"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && matches[0] && centerOn(matches[0])}
        />
      )}
      {mode === 'map' && query && <span className="muted small">{matches.length ? `${matches.length} found · Enter to go` : 'none found'}</span>}
      <button
        className="btn tiny primary"
        onClick={() => newScene()}
        title="Add a scene to the story: after the selected passage, as a new choice, or on its own (N). You can also double-click an empty part of the map."
      >
        + New scene
      </button>
      <span className="spacer" />
      {mode === 'map' && (
        <>
          <TraceSelect nodes={fullGraph.nodes} trace={trace} setTrace={setTrace} />
          {trace && (
            <button className="btn tiny" onClick={() => setTrace('')} title="Show the whole map again">
              Clear trace
            </button>
          )}
          <button
            className={`btn tiny ${focusMode === 'on' ? 'ok' : ''}`}
            aria-pressed={focusMode === 'on'}
            onClick={() => setFocusMode(focusMode === 'on' ? 'off' : 'on')}
            title="When a passage is selected, dim everything except the routes into and out of it"
          >
            ◎ Focus
          </button>
          <button
            className={`btn tiny ${straight === 'faint' ? 'ok' : ''}`}
            aria-pressed={straight === 'faint'}
            onClick={() => setStraight(straight === 'faint' ? 'full' : 'faint')}
            title="Draw routes that continue on their own (no choice) faintly, so the choices stand out"
          >
            ⋯ Faint straight-on routes
          </button>
          <ScenesMenu groups={groups} folded={folded} setFolded={setFolded} showScenes={showScenes} setShowScenes={setShowScenes} />
        </>
      )}
      {mode === 'map' && (
        <>
          <span className="tool-group" role="group" aria-label="Zoom">
            <button className="btn tiny" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.2)}>
              −
            </button>
            <button className="btn tiny" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
              +
            </button>
            <button className="btn tiny" onClick={() => fit(true)} title="Show the whole map (F)">
              Fit
            </button>
          </span>
          {readable && <span className="muted small map-hint">Shown at a size you can read: drag to move around, or Fit to see it all.</span>}
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
        </>
      )}
    </div>
  );
}
