import { useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { CARD, type Position } from '../../core/layout';
import { isGroupNode } from '../../core/scenes';
import type { SceneRequest } from '../NewScene';

const { W, H } = CARD;

/** How the map is shown: the pan offset and the zoom. */
export interface MapView {
  x: number;
  y: number;
  k: number;
}

/**
 * The map's pointer gestures: drag the background to pan, the wheel and a two-finger pinch to zoom, drag a card to move
 * it, click a card to inspect it, double-click the background to add a scene there. Returns the handlers for the map's
 * <svg>. The pieces of the gesture in progress live here; what they change (the view, a card being dragged) is the map's.
 */
export function useMapGestures({
  svg,
  view,
  setView,
  placed,
  dragging,
  setDragging,
  moved,
  unfold,
  inspect,
  onMove,
  setSceneForm,
}: {
  svg: RefObject<SVGSVGElement | null>;
  view: MapView;
  setView: Dispatch<SetStateAction<MapView>>;
  /** Where each card is now. */
  placed: Map<string, Position>;
  /** The card being dragged, and where it is. */
  dragging: { id: string; pos: Position } | null;
  setDragging: (d: { id: string; pos: Position } | null) => void;
  /** Set when the reader has panned or zoomed, so the map stops refitting itself on resize. */
  moved: MutableRefObject<boolean>;
  unfold: (nodeId: string) => void;
  inspect: (id: string) => void;
  onMove: (id: string, pos: Position) => void;
  setSceneForm: (r: SceneRequest) => void;
}) {
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  /** Fingers on the map, and a two-finger pinch in progress (its starting spread, midpoint and view). */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number; view: MapView } | null>(null);
  return {
    onDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest('.node')) return;
      const r = svg.current!.getBoundingClientRect();
      setSceneForm({ at: { x: (e.clientX - r.left - view.x) / view.k - W / 2, y: (e.clientY - r.top - view.y) / view.k - H / 2 } });
    },
    onWheel: (e: React.WheelEvent<SVGSVGElement>) => {
      const r = svg.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      moved.current = true;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.2, v.k * f));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    },
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === 'touch') {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          // Two fingers: pinch to zoom, about the point between them (no dragging a card meanwhile).
          const [a, b] = [...touches.current.values()];
          const r = svg.current!.getBoundingClientRect();
          nodeDrag.current = null;
          pan.current = null;
          setDragging(null);
          pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view };
          return;
        }
      }
      const node = (e.target as Element).closest('.node');
      const id = node?.getAttribute('data-id');
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (id && isGroupNode(id)) return;
      if (id) {
        const p = placed.get(id)!;
        nodeDrag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
      } else pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    },
    onClick: (e: React.MouseEvent<SVGSVGElement>) => {
      const id = (e.target as Element).closest('.node')?.getAttribute('data-id');
      if (id && isGroupNode(id)) unfold(id);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pz = pinch.current;
      if (pz && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const k = Math.min(2.5, Math.max(0.2, (pz.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / pz.dist));
        const r = svg.current!.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        moved.current = true;
        setView({ k, x: mx - ((pz.mx - pz.view.x) * k) / pz.view.k, y: my - ((pz.my - pz.view.y) * k) / pz.view.k });
        return;
      }
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
    },
    onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      nodeDrag.current = null;
      pan.current = null;
      setDragging(null);
    },
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        // Lifting a finger ends the pinch; the other finger doesn't start a drag or open a card.
        if (touches.current.size < 2) pinch.current = null;
        return;
      }
      const nd = nodeDrag.current;
      nodeDrag.current = null;
      pan.current = null;
      if (!nd) return;
      if (nd.moved && dragging) onMove(nd.id, dragging.pos);
      else inspect(nd.id);
      setDragging(null);
    },
  };
}
