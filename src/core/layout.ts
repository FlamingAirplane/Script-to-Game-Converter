import type { StoryGraph } from './analyzer';

// Automatic arrangement of the story map, shared by the Graph chapter and the Twine export (so a
// story opened in Twine is laid out the same way). Each passage goes in a column after every passage that leads
// into it, so routes read left to right (loops back are drawn as short stubs instead), and passages are ordered
// within each column to cross as few routes as possible; unreachable passages go last.

/** Passage card size and gaps on the story map, in pixels. */
export const CARD = { W: 188, H: 56, GX: 96, GY: 26 };
const { W, H, GX, GY } = CARD;

export type Position = { x: number; y: number };

function routesOf(graph: StoryGraph): { ids: string[]; out: Map<string, string[]> } {
  const ids = graph.nodes.map((n) => n.id);
  const known = new Set(ids);
  const out = new Map<string, string[]>();
  for (const e of graph.edges)
    if (!e.pending && known.has(e.to) && e.to !== e.from) {
      const list = out.get(e.from) ?? out.set(e.from, []).get(e.from)!;
      if (!list.includes(e.to)) list.push(e.to);
    }
  return { ids, out };
}

/**
 * Routes that loop back to a passage still being read on the way there (found by a depth-first walk from the start,
 * then from anything it didn't reach), as "from>to"; and the passages the start reaches.
 */
function findLoops(ids: string[], out: Map<string, string[]>, start: string): { back: Set<string>; fromStart: Set<string> } {
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>(); // 1 on the current path, 2 done
  const reached = new Set<string>();
  const walk = (root: string) => {
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    reached.add(root);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (out.get(top[0]) ?? [])[top[1]++];
      if (next === undefined) {
        state.set(top[0], 2);
        stack.pop();
      } else if (state.get(next) === 1) back.add(`${top[0]}>${next}`);
      else if (!state.has(next)) {
        state.set(next, 1);
        reached.add(next);
        stack.push([next, 0]);
      }
    }
  };
  if (ids.includes(start)) walk(start);
  const fromStart = new Set(reached);
  for (const id of ids) if (!state.has(id)) walk(id);
  return { back, fromStart };
}

/** The routes the map draws as "↩ back to …" stubs: loops back to an earlier passage, as "from>to". */
export function loopRoutes(graph: StoryGraph, start: string): Set<string> {
  const { ids, out } = routesOf(graph);
  return findLoops(ids, out, start).back;
}

export function storyLayout(graph: StoryGraph, start: string): Map<string, Position> {
  const { ids, out } = routesOf(graph);
  const order = new Map(ids.map((id, i) => [id, i]));

  // 1. Loops: a route back to a passage still being read on the way here doesn't decide columns, so the rest of the
  //    story reads left to right.
  const { back, fromStart } = findLoops(ids, out, start);
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const [a, list] of out)
    for (const b of list)
      if (!back.has(`${a}>${b}`)) {
        (fwd.get(a) ?? fwd.set(a, []).get(a)!).push(b);
        (rev.get(b) ?? rev.set(b, []).get(b)!).push(a);
      }

  // 2. Columns: each passage goes after everything that leads into it (the longest route from the start), so routes
  //    run forward. Then a passage whose routes all go far ahead moves up beside them, keeping routes short.
  const topo: string[] = [];
  const indeg = new Map(ids.map((id) => [id, (rev.get(id) ?? []).length]));
  const ready = ids.filter((id) => !indeg.get(id));
  while (ready.length) {
    const id = ready.shift()!;
    topo.push(id);
    for (const b of fwd.get(id) ?? []) {
      indeg.set(b, indeg.get(b)! - 1);
      if (!indeg.get(b)) ready.push(b);
    }
  }
  const rank = new Map<string, number>();
  for (const id of topo) rank.set(id, Math.max(0, ...(rev.get(id) ?? []).map((a) => (rank.get(a) ?? 0) + 1)));
  // Shorten routes: move each passage, within the columns its routes allow (after what leads in, before what it leads
  // to), to where its routes in and out are shortest in total (the median of where they'd want it). A few rounds settle it.
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const id of [...topo].reverse()) {
      if (id === start) continue;
      const ins = (rev.get(id) ?? []).map((a) => rank.get(a)! + 1);
      const outs = (fwd.get(id) ?? []).map((b) => rank.get(b)! - 1);
      if (!outs.length) continue; // endings stay at the far end of their routes
      const lo = ins.length ? Math.max(...ins) : 0;
      const hi = Math.min(...outs);
      const wants = [...ins, ...outs].sort((a, b) => a - b);
      // Of the medians, the later one: ties keep the story moving right.
      const best = Math.min(hi, Math.max(lo, wants[Math.floor(wants.length / 2)]));
      if (best !== rank.get(id)) {
        rank.set(id, best);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Passages no route from the start reaches go in a trailing column, in source order.
  const maxD = Math.max(0, ...[...fromStart].map((id) => rank.get(id)!));
  for (const id of ids) if (!fromStart.has(id)) rank.set(id, maxD + 1);

  const cols: string[][] = [];
  for (const id of ids) (cols[rank.get(id)!] ??= []).push(id);
  for (const c of cols) c?.sort((a, b) => order.get(a)! - order.get(b)!);

  // 3. Order within each column: barycentre sweeps (each passage near the average row of the passages it connects
  //    to, nearer columns counting more), keeping whichever order crosses the fewest routes.
  const links: [string, string][] = [];
  for (const [a, list] of fwd) for (const b of list) links.push([a, b]);
  const rowOf = new Map<string, number>();
  // The same as numbers, for the crossing counts below (which run many times): each route's ends and columns.
  const num = new Map(ids.map((id, i) => [id, i]));
  const rows = new Float64Array(ids.length);
  const L = links.length;
  const la = new Int32Array(L), lb = new Int32Array(L), ra = new Float64Array(L), rb = new Float64Array(L);
  links.forEach(([a, b], i) => {
    la[i] = num.get(a)!;
    lb[i] = num.get(b)!;
    ra[i] = rank.get(a)!;
    rb[i] = rank.get(b)!;
  });
  const setRow = (id: string, r: number) => {
    rowOf.set(id, r);
    rows[num.get(id)!] = r;
  };
  const index = () => cols.forEach((c) => c?.forEach((id, i) => setRow(id, i)));
  // Comparisons done so far: the swapping below stops at a fixed amount of work (not a time limit), so very large
  // maps stay quick and the same story always gets the same map.
  let work = 0;
  /** Whether two routes cross, comparing where they are at the columns they share. */
  const cross = (i: number, j: number) => {
    work++;
    const a = la[i], b = lb[i], c = la[j], d = lb[j];
    if (a === c || b === d || a === d || b === c) return false;
    const lo = ra[i] > ra[j] ? ra[i] : ra[j];
    const hi = rb[i] < rb[j] ? rb[i] : rb[j];
    if (lo >= hi) return false;
    const ya = rows[a], yb = rows[b], yc = rows[c], yd = rows[d];
    const si = (yb - ya) / (rb[i] - ra[i]);
    const sj = (yd - yc) / (rb[j] - ra[j]);
    const s0 = ya + si * (lo - ra[i]) - (yc + sj * (lo - ra[j]));
    const s1 = ya + si * (hi - ra[i]) - (yc + sj * (hi - ra[j]));
    return s0 * s1 < 0;
  };
  const crossings = () => {
    let n = 0;
    for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) if (cross(i, j)) n++;
    return n;
  };
  const touching = new Map<string, number[]>();
  links.forEach(([a, b], i) => {
    (touching.get(a) ?? touching.set(a, []).get(a)!).push(i);
    (touching.get(b) ?? touching.set(b, []).get(b)!).push(i);
  });
  /** Crossings that involve the routes into or out of these passages (the only ones a swap of them can change). */
  const crossingsAt = (u: string, v: string) => {
    const mine = [...new Set([...(touching.get(u) ?? []), ...(touching.get(v) ?? [])])];
    const isMine = new Uint8Array(L);
    for (const i of mine) isMine[i] = 1;
    let n = 0;
    for (const i of mine) for (let j = 0; j < L; j++) if ((!isMine[j] || j > i) && cross(i, j)) n++;
    return n;
  };
  const bary = (id: string, nbrs: string[] | undefined, before: boolean) => {
    let sum = 0;
    let weight = 0;
    for (const n of nbrs ?? []) {
      const gap = Math.abs(rank.get(n)! - rank.get(id)!);
      if (!gap || (before ? rank.get(n)! > rank.get(id)! : rank.get(n)! < rank.get(id)!)) continue;
      sum += rowOf.get(n)! / gap;
      weight += 1 / gap;
    }
    return weight ? sum / weight : rowOf.get(id)!;
  };
  index();
  let best = cols.map((c) => c?.slice());
  let bestCount = crossings();
  for (let pass = 0; pass < 12 && bestCount > 0; pass++) {
    for (let d = 1; d < cols.length; d++) {
      cols[d]?.sort((a, b) => bary(a, rev.get(a), true) - bary(b, rev.get(b), true));
      index();
    }
    for (let d = cols.length - 2; d >= 0; d--) {
      cols[d]?.sort((a, b) => bary(a, fwd.get(a), false) - bary(b, fwd.get(b), false));
      index();
    }
    const n = crossings();
    if (n < bestCount) {
      bestCount = n;
      best = cols.map((c) => c?.slice());
    }
  }
  best.forEach((c, d) => (cols[d] = c));
  index();
  // Then swap neighbours in a column while that removes crossings.
  const budget = work + 1_500_000;
  {
    let count = bestCount;
    for (let round = 0, improved = true; improved && round < 6 && count > 0 && work < budget; round++) {
      improved = false;
      for (const c of cols) {
        if (!c) continue;
        for (let i = 0; i + 1 < c.length && work < budget; i++) {
          const u = c[i];
          const v = c[i + 1];
          const before = crossingsAt(u, v);
          [c[i], c[i + 1]] = [v, u];
          setRow(u, i + 1);
          setRow(v, i);
          const after = crossingsAt(u, v);
          if (after < before) {
            count -= before - after;
            improved = true;
          } else {
            [c[i], c[i + 1]] = [u, v];
            setRow(u, i);
            setRow(v, i + 1);
          }
        }
      }
    }
  }

  const maxRows = Math.max(1, ...cols.map((c) => c?.length ?? 0));
  const placed = new Map<string, Position>();
  cols.forEach((list, d) => {
    const off = ((maxRows - (list?.length ?? 0)) * (H + GY)) / 2;
    list?.forEach((id, i) => placed.set(id, { x: d * (W + GX), y: off + i * (H + GY) }));
  });
  return placed;
}

