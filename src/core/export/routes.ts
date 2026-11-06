import { Story } from 'inkjs/full';
import type { StoryProject } from '../isr';

// Playthrough routes for engine tests: a handful of choice sequences that, between them, reach every
// ending the automated playthroughs can reach and as many passages as they can. Each records what the
// story must do when the route is replayed (the choices offered along the way, the ending, the last line),
// so a game can check its integration still plays the story the writer wrote.

export interface StoryRoute {
  /** A readable name, e.g. "Ending: Lamp Room". */
  name: string;
  /** The text of every choice taken, in order (Continue breaks and exits to the game included). */
  choices: string[];
  /** The passage the route ends in (an ink knot), or null if it stopped without reaching one. */
  ending: string | null;
  /** The last line of text read, as Ink prints it ("MIRA: Hello." for dialogue). */
  lastLine: string;
  /** Every passage the route goes through. */
  passages: string[];
}

export interface RouteOptions {
  runs?: number;
  maxSteps?: number;
  maxRoutes?: number;
  seed?: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Routes that cover the story's endings first, then its passages; deterministic for a given story. */
export function storyRoutes(json: string, project: StoryProject, opts: RouteOptions = {}): StoryRoute[] {
  const runs = opts.runs ?? 300;
  const maxSteps = opts.maxSteps ?? 400;
  const maxRoutes = opts.maxRoutes ?? 16;
  const rand = mulberry32(opts.seed ?? 4321);
  const ids = project.passages.map((p) => p.id);
  const known = new Set(ids);
  const title = new Map(project.passages.map((p) => [p.id, p.title || p.id]));
  // Which ending a run reached: the ending passage visited in its last step (as the automated playthroughs decide).
  const endingIds = project.passages.filter((p) => p.isEnding || p.divert === 'END' || p.choices.some((c) => c.target === 'END')).map((p) => p.id);
  const visits = (s: Story) =>
    endingIds.map((id) => {
      try {
        return s.state.VisitCountAtPathString(id) ?? 0;
      } catch {
        return 0;
      }
    });
  const story = new Story(json);
  const taken = new Map<string, number>();
  const endings = new Set<string>();
  const covered = new Set<string>();
  const seen = new Set<string>();
  const found: { route: StoryRoute; newEnding: boolean; newPassages: number }[] = [];

  for (let r = 0; r < runs; r++) {
    if (r > 0) story.ResetState();
    const choices: string[] = [];
    let lastLine = '';
    let lastKnot = '';
    let endedIn = '';
    let finished = false;
    let realChoices = 0;
    try {
      for (let steps = 0; steps < maxSteps; steps++) {
        const before = visits(story);
        while (story.canContinue) {
          const knot = (story.state.currentPathString ?? '').split('.')[0];
          if (known.has(knot)) lastKnot = knot;
          const text = (story.Continue() ?? '').trim();
          if (text) lastLine = text;
        }
        const offered = story.currentChoices;
        if (offered.length === 0) {
          const after = visits(story);
          const reached = endingIds.filter((_, i) => after[i] > before[i]);
          endedIn = reached[reached.length - 1] ?? '';
          finished = true;
          break;
        }
        const knot = (offered[0].sourcePath ?? '').split('.')[0];
        if (known.has(knot)) lastKnot = knot;
        if (offered.length > 1) realChoices++;
        let idx: number;
        if (r % 2 === 0) idx = Math.floor(rand() * offered.length);
        else {
          const scored = offered.map((c, i) => ({ i, n: taken.get(`${lastKnot}:${c.text}`) ?? 0, tie: rand() }));
          scored.sort((a, b) => a.n - b.n || a.tie - b.tie);
          idx = scored[0].i;
        }
        const key = `${lastKnot}:${offered[idx].text}`;
        taken.set(key, (taken.get(key) ?? 0) + 1);
        choices.push(offered[idx].text);
        story.ChooseChoiceIndex(idx);
      }
    } catch {
      continue; // a runtime error: the smoke test reports it; a route must replay cleanly
    }
    if (!finished) continue;
    const passages = ids.filter((id) => {
      try {
        return (story.state.VisitCountAtPathString(id) ?? 0) > 0;
      } catch {
        return false;
      }
    });
    const signature = choices.join('\u0001');
    if (seen.has(signature)) {
      if (realChoices === 0) break; // no choices at all: every run is this one
      continue;
    }
    seen.add(signature);
    const ending = endedIn || lastKnot || null;
    const newEnding = !!ending && !endings.has(ending);
    const newPassages = passages.filter((p) => !covered.has(p)).length;
    if (newEnding || newPassages > 0) {
      if (ending) endings.add(ending);
      passages.forEach((p) => covered.add(p));
      found.push({ route: { name: '', choices, ending, lastLine, passages }, newEnding, newPassages });
    }
    if (realChoices === 0) break;
  }

  // Every route that found an ending, then the ones that found the most new passages, up to the limit.
  const keep = [...found.filter((f) => f.newEnding), ...found.filter((f) => !f.newEnding).sort((a, b) => b.newPassages - a.newPassages)].slice(0, maxRoutes);
  const order = new Map(found.map((f, i) => [f, i]));
  keep.sort((a, b) => order.get(a)! - order.get(b)!);
  const counts = new Map<string, number>();
  return keep.map(({ route }) => {
    const base = route.ending ? `Ending: ${title.get(route.ending) ?? route.ending}` : 'Route';
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return { ...route, name: n > 1 ? `${base} (${n})` : base };
  });
}
