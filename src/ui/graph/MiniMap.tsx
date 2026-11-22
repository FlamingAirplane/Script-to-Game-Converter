import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { StoryGraph } from '../../core/analyzer';
import { CARD, type Position } from '../../core/layout';
import type { MapView } from './useMapGestures';

const { W, H } = CARD;

/** A small picture of the whole map with the part in view outlined; click it to move the view there. */
export function MiniMap({
  graph,
  placed,
  view,
  setView,
  size,
  moved,
  geometry,
  matches,
}: {
  graph: StoryGraph;
  placed: Map<string, Position>;
  view: MapView;
  setView: Dispatch<SetStateAction<MapView>>;
  /** The size of the map's frame. */
  size: { w: number; h: number };
  moved: MutableRefObject<boolean>;
  /** Passages the search found, outlined. */
  matches: string[];
  /** The minimap's own geometry (see GraphView). */
  geometry: {
    MW: number;
    MH: number;
    mk: number;
    mox: number;
    moy: number;
    bounds: { minX: number; minY: number };
    mm: (p: Position) => Position;
    vp: Position;
  };
}) {
  const { MW, MH, mk, mox, moy, bounds, mm, vp } = geometry;
  return (
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
        return (
          <rect
            key={n.id}
            x={p.x}
            y={p.y}
            width={Math.max(2, W * mk)}
            height={Math.max(2, H * mk)}
            className={`mini-node ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${matches.includes(n.id) ? 'match' : ''}`}
          />
        );
      })}
      <rect x={vp.x} y={vp.y} width={(size.w / view.k) * mk} height={(size.h / view.k) * mk} className="mini-view" />
    </svg>
  );
}
