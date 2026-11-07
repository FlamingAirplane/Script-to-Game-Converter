// Routes the story map's arrows so they make as little clutter as possible. Each arrow may leave and
// enter a passage card by any side (top, right, bottom, left); for each one, every pair of sides is
// tried as a curve and scored: going through other cards costs most, then crossing arrows already
// routed, then length and turning back on itself. The cheapest wins. Arrows sharing a side of a card
// are then spread along it, ordered by where they go, so they fan out instead of piling up.
//
// An arrow that skips columns of cards (from a passage to one several columns on) is threaded instead: it leaves
// the right side, passes each column in between through the nearest gap between cards, and enters the left side,
// so it runs along the map rather than looping around it.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RouteEdge {
  id: string;
  from: string;
  to: string;
}
export interface Route {
  d: string;
  /** The curve's middle, for a label or sign. */
  mid: [number, number];
  fromSide: Side;
  toSide: Side;
}

type P = [number, number];
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const NORMAL: Record<Side, P> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const SAMPLES = 14;

function port(r: Rect, side: Side, offset = 0): P {
  switch (side) {
    case 'top':
      return [r.x + r.w / 2 + offset, r.y];
    case 'bottom':
      return [r.x + r.w / 2 + offset, r.y + r.h];
    case 'left':
      return [r.x, r.y + r.h / 2 + offset];
    default:
      return [r.x + r.w, r.y + r.h / 2 + offset];
  }
}

function curve(a: P, sa: Side, b: P, sb: Side, gap = 0): [P, P, P, P] {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const reach = Math.max(30, Math.min(160, dist * 0.42)) + gap;
  const na = NORMAL[sa];
  const nb = NORMAL[sb];
  // The arrow stops a little short of the card, so its head sits outside it.
  const end: P = [b[0] + nb[0] * 2, b[1] + nb[1] * 2];
  return [a, [a[0] + na[0] * reach, a[1] + na[1] * reach], [end[0] + nb[0] * reach, end[1] + nb[1] * reach], end];
}

function at(c: [P, P, P, P], t: number): P {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [k[0] * c[0][0] + k[1] * c[1][0] + k[2] * c[2][0] + k[3] * c[3][0], k[0] * c[0][1] + k[1] * c[1][1] + k[2] * c[2][1] + k[3] * c[3][1]];
}

function sample(c: [P, P, P, P]): P[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => at(c, i / SAMPLES));
}

function cross(p: P, q: P, r: P, s: P): boolean {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

interface Poly {
  pts: P[];
  box: Rect;
}
function poly(pts: P[]): Poly {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { pts, box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
}
const overlaps = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

function crossings(a: Poly, b: Poly): number {
  if (!overlaps(a.box, b.box)) return 0;
  let n = 0;
  for (let i = 0; i < a.pts.length - 1; i++) for (let j = 0; j < b.pts.length - 1; j++) if (cross(a.pts[i], a.pts[i + 1], b.pts[j], b.pts[j + 1])) n++;
  return n;
}

/** How many sample points fall inside cards other than the arrow's own two (slightly enlarged). */
function throughCards(pts: P[], cards: Rect[]): number {
  let n = 0;
  for (const c of cards)
    for (const [x, y] of pts.slice(1, -1)) if (x > c.x - 6 && x < c.x + c.w + 6 && y > c.y - 6 && y < c.y + c.h + 6) n++;
  return n;
}

function length(pts: P[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}

/** A side that faces away from the other card makes the curve double back: allowed, but discouraged. */
function facing(r: Rect, side: Side, other: P): number {
  const [nx, ny] = NORMAL[side];
  const c: P = [r.x + r.w / 2, r.y + r.h / 2];
  const dot = (other[0] - c[0]) * nx + (other[1] - c[1]) * ny;
  return dot >= 0 ? 0 : 1;
}

const fmt = (n: number) => Math.round(n * 10) / 10;
const pathOf = (c: [P, P, P, P]) => `M${fmt(c[0][0])},${fmt(c[0][1])} C${fmt(c[1][0])},${fmt(c[1][1])} ${fmt(c[2][0])},${fmt(c[2][1])} ${fmt(c[3][0])},${fmt(c[3][1])}`;

/** Cards that sit wholly between two cards, left to right: the columns an arrow from `a` to `b` has to pass. */
function between(a: Rect, b: Rect, others: Rect[]): Rect[] {
  return others.filter((r) => r.x >= a.x + a.w + 8 && r.x + r.w <= b.x - 8);
}

/** A smooth path through points (Catmull-Rom as cubic curves), leaving and arriving level. */
function smooth(pts: P[]): string {
  const lead: P = [pts[0][0] - 60, pts[0][1]];
  const tail: P = [pts[pts.length - 1][0] + 60, pts[pts.length - 1][1]];
  const all = [lead, ...pts, tail];
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
  for (let i = 1; i < all.length - 2; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${fmt(c1[0])},${fmt(c1[1])} ${fmt(c2[0])},${fmt(c2[1])} ${fmt(p2[0])},${fmt(p2[1])}`;
  }
  return d;
}

/**
 * Waypoints for a threaded arrow: at each column it passes, the free height nearest the straight line from start to
 * end (between cards, or above or below the column), entered and left level. `used` spreads arrows that share a gap.
 */
function threadPoints(start: P, end: P, columns: Rect[], used: Map<string, number>): P[] {
  const cols = new Map<number, Rect[]>();
  for (const r of columns) (cols.get(r.x) ?? cols.set(r.x, []).get(r.x)!).push(r);
  const pts: P[] = [start];
  for (const [x, cards] of [...cols].sort((p, q) => p[0] - q[0])) {
    const w = Math.max(...cards.map((c) => c.w));
    const t = (x + w / 2 - start[0]) / (end[0] - start[0]);
    const want = start[1] + (end[1] - start[1]) * t;
    const pad = 9;
    const blocked = cards.map((c) => [c.y - pad, c.y + c.h + pad] as const).sort((p, q) => p[0] - q[0]);
    const free = (y: number) => blocked.every(([lo, hi]) => y <= lo || y >= hi);
    let y = want;
    if (!free(y)) {
      const options = blocked.flatMap(([lo, hi]) => [lo, hi]).filter(free);
      y = options.reduce((best, o) => (Math.abs(o - want) < Math.abs(best - want) ? o : best), options[0] ?? want);
      // Arrows sharing a gap are spread a little apart.
      const key = `${x}:${Math.round(y)}`;
      const n = used.get(key) ?? 0;
      used.set(key, n + 1);
      const gapAbove = blocked.some(([lo]) => Math.abs(lo - y) < 0.5);
      y += (gapAbove ? -1 : 1) * n * 5;
    }
    pts.push([x - 4, y], [x + w + 4, y]);
  }
  pts.push(end);
  return pts;
}

export function routeEdges(cards: Map<string, Rect>, edges: RouteEdge[]): Map<string, Route> {
  const out = new Map<string, Route>();
  const routed: Poly[] = [];
  const all = [...cards.entries()];
  const chosen = new Map<string, { fromSide: Side; toSide: Side }>();
  // Short arrows first: they have the fewest good options, so they choose before the long ones.
  const order = edges
    .filter((e) => cards.has(e.from) && cards.has(e.to))
    .map((e) => {
      const a = cards.get(e.from)!;
      const b = cards.get(e.to)!;
      return { e, a, b, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    })
    .sort((p, q) => p.dist - q.dist);
  for (const { e, a, b } of order) {
    if (e.from === e.to) {
      chosen.set(e.id, { fromSide: 'right', toSide: 'top' });
      continue;
    }
    if (between(a, b, all.filter(([id]) => id !== e.from && id !== e.to).map(([, r]) => r)).length) {
      chosen.set(e.id, { fromSide: 'right', toSide: 'left' });
      continue;
    }
    const others = all.filter(([id]) => id !== e.from && id !== e.to).map(([, r]) => r).filter((r) => overlaps(r, { x: Math.min(a.x, b.x) - 200, y: Math.min(a.y, b.y) - 200, w: Math.abs(a.x - b.x) + a.w + 400, h: Math.abs(a.y - b.y) + a.h + 400 }));
    const bc: P = [b.x + b.w / 2, b.y + b.h / 2];
    const ac: P = [a.x + a.w / 2, a.y + a.h / 2];
    let best: { cost: number; sa: Side; sb: Side; poly: Poly } | null = null;
    for (const sa of SIDES)
      for (const sb of SIDES) {
        const c = curve(port(a, sa), sa, port(b, sb), sb);
        const pts = sample(c);
        const pl = poly(pts);
        let cost = length(pts) + throughCards(pts, others) * 400 + (facing(a, sa, bc) + facing(b, sb, ac)) * 260;
        for (const r of routed) cost += crossings(pl, r) * 120;
        if (!best || cost < best.cost) best = { cost, sa, sb, poly: pl };
      }
    routed.push(best!.poly);
    chosen.set(e.id, { fromSide: best!.sa, toSide: best!.sb });
  }

  // Spread arrows that share a side of a card, ordered by where their other end is, so they don't cross.
  const slots = new Map<string, { id: string; end: 'from' | 'to'; key: number }[]>();
  for (const { e, a, b } of order) {
    const c = chosen.get(e.id)!;
    for (const [end, card, side, other] of [
      ['from', a, c.fromSide, b],
      ['to', b, c.toSide, a],
    ] as const) {
      if (e.from === e.to) continue;
      const k = `${end === 'from' ? e.from : e.to}:${side}`;
      const horizontal = side === 'top' || side === 'bottom';
      const key = horizontal ? other.x + other.w / 2 : other.y + other.h / 2;
      void card;
      (slots.get(k) ?? slots.set(k, []).get(k)!).push({ id: e.id, end, key });
    }
  }
  const offsets = new Map<string, number>();
  for (const [k, list] of slots) {
    const side = k.slice(k.lastIndexOf(':') + 1) as Side;
    const card = cards.get(k.slice(0, k.lastIndexOf(':')))!;
    const room = (side === 'top' || side === 'bottom' ? card.w : card.h) * 0.7;
    list.sort((p, q) => p.key - q.key);
    const step = list.length > 1 ? Math.min(side === 'top' || side === 'bottom' ? 22 : 10, room / (list.length - 1)) : 0;
    list.forEach((s, i) => offsets.set(`${s.id}:${s.end}`, (i - (list.length - 1) / 2) * step));
  }

  const used = new Map<string, number>();
  const rects = [...cards.values()];
  for (const { e, a, b } of order) {
    const c = chosen.get(e.id)!;
    const columns = e.from === e.to ? [] : between(a, b, rects.filter((r) => r !== a && r !== b));
    if (columns.length) {
      const start = port(a, 'right', offsets.get(`${e.id}:from`) ?? 0);
      const endPort = port(b, 'left', offsets.get(`${e.id}:to`) ?? 0);
      const pts = threadPoints(start, [endPort[0] - 2, endPort[1]], columns, used);
      const m = pts[Math.floor(pts.length / 2)];
      out.set(e.id, { d: smooth(pts), mid: [fmt(m[0]), fmt(m[1])], fromSide: 'right', toSide: 'left' });
      continue;
    }
    let cv: [P, P, P, P];
    if (e.from === e.to) {
      // A passage that leads back to itself: a small loop over its top-right corner.
      const s = port(a, 'right', -a.h / 4);
      const t = port(a, 'top', a.w / 4);
      cv = [s, [s[0] + 60, s[1] - 10], [t[0] + 10, t[1] - 60], [t[0], t[1] - 2]];
    } else cv = curve(port(a, c.fromSide, offsets.get(`${e.id}:from`) ?? 0), c.fromSide, port(b, c.toSide, offsets.get(`${e.id}:to`) ?? 0), c.toSide);
    out.set(e.id, { d: pathOf(cv), mid: at(cv, 0.5).map(fmt) as [number, number], fromSide: c.fromSide, toSide: c.toSide });
  }
  return out;
}

/** For tests: whether a route's curve passes through a card. */
export function routeHits(route: Route, card: Rect): boolean {
  const n = route.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // "M x,y" then cubic segments of three points each, each starting where the last ended.
  for (let i = 2; i + 5 < n.length; i += 6) {
    const c: [P, P, P, P] = [
      [n[i - 2], n[i - 1]],
      [n[i], n[i + 1]],
      [n[i + 2], n[i + 3]],
      [n[i + 4], n[i + 5]],
    ];
    if (throughCards(sample(c), [card]) > 0) return true;
  }
  return false;
}
