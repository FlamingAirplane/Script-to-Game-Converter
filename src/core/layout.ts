import type { StoryGraph } from './analyzer';

// Automatic arrangement of the story map, shared by the Graph chapter and the Twine export (so a
// story opened in Twine is laid out the same way). Passages are placed in columns by distance from
// the start, ordered within each column to reduce crossings; unreachable passages go last.

/** Passage card size and gaps on the story map, in pixels. */
export const CARD = { W: 188, H: 56, GX: 96, GY: 26 };
const { W, H, GX, GY } = CARD;

export type Position = { x: number; y: number };

export function storyLayout(graph: StoryGraph, start: string): Map<string, Position> {
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

