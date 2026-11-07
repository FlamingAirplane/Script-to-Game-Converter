import type { StoryGraph } from './analyzer';
import { plainText } from './emphasis';
import type { Passage, StoryProject } from './isr';

const HEADING = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

/**
 * The scene heading a passage starts with: its own (from a screenplay), or a first line written like one
 * ("EXT. DELMAS ALLEY - LATE AFTERNOON"), as in Markdown and plain-text drafts.
 */
export function sceneHeadingOf(p: Pick<Passage, 'sceneHeading' | 'content'>): string | undefined {
  if (p.sceneHeading) return p.sceneHeading;
  const first = p.content.find((b) => b.type !== 'note' && b.type !== 'effect' && b.type !== 'cue');
  if (first?.type !== 'action') return undefined;
  const line = plainText(first.text).split('\n')[0].trim();
  return HEADING.test(line) && line === line.toUpperCase() ? line : undefined;
}

// Helpers that make a large story map readable: scenes (passages grouped under the scene heading that starts them,
// which the map can fold into one card) and tracing (every route from the start to one passage).

export interface SceneGroup {
  /** The id of the passage that starts the scene. */
  id: string;
  title: string;
  heading?: string;
  /** Its passages, in story order. */
  members: string[];
}

/**
 * The story's scenes: a new one starts at each passage with a scene heading (see sceneHeadingOf; and at the first passage), and holds
 * the passages after it until the next heading, in the order the passages are written.
 */
export function sceneGroups(project: Pick<StoryProject, 'passages'>): SceneGroup[] {
  const out: SceneGroup[] = [];
  for (const p of project.passages) {
    const heading = sceneHeadingOf(p);
    if (!out.length || heading) out.push({ id: p.id, title: p.title || p.id, heading, members: [] });
    out[out.length - 1].members.push(p.id);
  }
  return out;
}

/** The map's id for a folded scene's card. */
export const groupNodeId = (sceneId: string) => `scene:${sceneId}`;
export const isGroupNode = (id: string) => id.startsWith('scene:');

/**
 * The graph with these scenes folded: each becomes one card ("scene:<id>"), routes inside it are left out, and
 * routes in or out of it join at the card (one per pair of cards). `of` maps each passage to the card it's drawn on.
 */
export function foldGraph(graph: StoryGraph, groups: SceneGroup[], folded: Set<string>): { graph: StoryGraph; of: Map<string, string> } {
  const of = new Map<string, string>(graph.nodes.map((n) => [n.id, n.id]));
  const shut = groups.filter((g) => folded.has(g.id) && g.members.length > 1);
  if (!shut.length) return { graph, of };
  for (const g of shut) for (const m of g.members) of.set(m, groupNodeId(g.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes: StoryGraph['nodes'] = [];
  const done = new Set<string>();
  for (const n of graph.nodes) {
    const to = of.get(n.id)!;
    if (done.has(to)) continue;
    done.add(to);
    if (to === n.id) nodes.push(n);
    else {
      const g = shut.find((x) => groupNodeId(x.id) === to)!;
      const ms = g.members.map((m) => byId.get(m)).filter((m) => !!m);
      nodes.push({
        id: to,
        title: `${g.title} (${g.members.length} passages)`,
        isStart: ms.some((m) => m.isStart),
        isEnding: ms.some((m) => m.isEnding),
        reachable: ms.some((m) => m.reachable),
        origin: 'transformed',
      });
    }
  }
  const edges: StoryGraph['edges'] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const from = of.get(e.from) ?? e.from;
    const to = of.get(e.to) ?? e.to;
    if (from === to && from !== e.from) continue; // inside a folded scene
    const key = `${from}>${to}>${e.pending ? 'p' : ''}${e.conditional ? 'c' : ''}`;
    if ((from !== e.from || to !== e.to) && seen.has(key)) continue;
    seen.add(key);
    edges.push(from === e.from && to === e.to ? e : { ...e, id: `${e.id}@${from}>${to}`, from, to });
  }
  return { graph: { nodes, edges }, of };
}

/**
 * Every passage and route on some way from the start to `target` (using the routes given), so the map can show
 * just those. Empty when the start doesn't reach it.
 */
export function traceRoutes(edges: StoryGraph['edges'], start: string, target: string): { nodes: Set<string>; edges: Set<string> } {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)!).push(e.to);
    (rev.get(e.to) ?? rev.set(e.to, []).get(e.to)!).push(e.from);
  }
  const spread = (from: string, next: Map<string, string[]>) => {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) for (const n of next.get(q.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), q.push(n));
    return seen;
  };
  const ahead = spread(start, fwd);
  if (!ahead.has(target)) return { nodes: new Set(), edges: new Set() };
  const behind = spread(target, rev);
  const nodes = new Set([...ahead].filter((n) => behind.has(n)));
  return { nodes, edges: new Set(edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id)) };
}
