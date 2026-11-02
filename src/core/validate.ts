import { Compiler, CompilerOptions, Story } from 'inkjs/full';
import { diag, type Diagnostic } from './diagnostics';
import type { SourceMapEntry } from './inkgen';
import { isActive, type StoryProject } from './isr';

export interface CompileResult {
  ok: boolean;
  json?: string;
  diagnostics: Diagnostic[];
}

/** Preflight compile with the pinned inkjs compiler; compiler messages are mapped back to ISR entities. */
export function compileInk(ink: string, sourceMap: SourceMapEntry[] = []): CompileResult {
  const messages: { text: string; type: number }[] = [];
  const options = new CompilerOptions(null, [], true, (text: string, type: number) => messages.push({ text, type }));
  const compiler = new Compiler(ink, options);
  let json: string | undefined;
  try {
    const story = compiler.Compile();
    json = story?.ToJson() ?? undefined;
  } catch (e) {
    // Ink errors arrive through the handler; anything else (e.g. running out of stack) is reported here.
    if (!messages.length) messages.push({ text: `ERROR: line 0: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`, type: 2 });
  }
  const diagnostics = messages.map(({ text, type }) => {
    const m = /^(ERROR|WARNING|TODO|AUTHOR):\s*(?:'[^']*'\s*)?line (\d+):\s*(.*)$/s.exec(text);
    const line = m ? parseInt(m[2], 10) : 0;
    const message = m ? m[3] : text;
    const entry = sourceMap.find((e) => e.line === line) ?? [...sourceMap].reverse().find((e) => e.line < line);
    const severity = type === 2 ? 'error' : type === 1 ? 'warning' : 'info';
    return diag(severity === 'error' ? 'INK_COMPILE_ERROR' : 'INK_COMPILE_WARNING', severity, 'ink_compilation', message, {
      entityId: entry?.entityId,
      details: { inkLine: line, passageId: entry?.passageId },
    });
  });
  const ok = !!json && !diagnostics.some((d) => d.severity === 'error');
  return { ok, json: ok ? json : undefined, diagnostics };
}

export interface SmokeTestReport {
  runs: number;
  completedRuns: number;
  stepLimitRuns: number;
  endingsReached: Record<string, number>;
  visited: string[];
  unvisited: string[];
  gatedChoices: { id: string; text: string; passageId: string; seenEnabled: number }[];
  runtimeErrors: string[];
  sampleTranscript: string[];
  /** Why fewer than the requested runs were played, if they were. */
  stopReason?: 'deterministic' | 'no-new-coverage';
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

function knotOf(path: string | null | undefined): string {
  return (path ?? '').split('.')[0];
}

function visitCounts(story: Story, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    try {
      out[id] = story.state.VisitCountAtPathString(id) ?? 0;
    } catch {
      out[id] = 0; // path may not exist in passthrough stories
    }
  }
  return out;
}

/**
 * Deterministic runtime smoke test: plays the compiled story many times with a seeded RNG. Half the
 * runs pick uniformly, half prefer choices not yet taken, to cover conditional and item-gated paths.
 * This is a state-dependent check, complementing the purely structural graph analysis.
 */
export interface SmokeOptions {
  runs?: number;
  maxSteps?: number;
  seed?: number;
}

export type SmokeResult = { report: SmokeTestReport; diagnostics: Diagnostic[] };

export function smokeTest(json: string, project: StoryProject, opts: SmokeOptions = {}): SmokeResult {
  const gen = smokeRuns(json, project, opts);
  for (let step = gen.next(); ; step = gen.next()) if (step.done) return step.value;
}

/**
 * Same as smokeTest, but yields to the event loop every `sliceMs` so the page (or worker) stays
 * responsive, and gives up (returns null) as soon as `shouldContinue()` is false, e.g. after a newer edit.
 */
export async function smokeTestAsync(json: string, project: StoryProject, opts: SmokeOptions & { shouldContinue: () => boolean; sliceMs?: number }): Promise<SmokeResult | null> {
  const gen = smokeRuns(json, project, opts);
  const slice = opts.sliceMs ?? 12;
  let start = performance.now();
  for (let step = gen.next(); ; step = gen.next()) {
    if (step.done) return step.value;
    if (performance.now() - start > slice) {
      await new Promise((r) => setTimeout(r, 0));
      if (!opts.shouldContinue()) return null;
      start = performance.now();
    }
  }
}

/** The playthrough loop; yields after each run. */
function* smokeRuns(json: string, project: StoryProject, opts: SmokeOptions): Generator<void, SmokeResult> {
  const runs = opts.runs ?? 120;
  const maxSteps = opts.maxSteps ?? 400;
  const rand = mulberry32(opts.seed ?? 1234);
  const passageIds = project.passages.map((p) => p.id);
  const visited = new Set<string>();
  const endings: Record<string, number> = {};
  const runtimeErrors = new Set<string>();
  const taken = new Map<string, number>();
  const gated = project.passages.flatMap((p) =>
    p.choices.filter((c) => isActive(c.review) && c.conditions.length).map((c) => ({ id: c.id, text: c.text, passageId: p.id, seenEnabled: 0 })),
  );
  const endingIds = new Set(project.passages.filter((p) => p.isEnding || p.divert === 'END' || p.choices.some((c) => c.target === 'END')).map((p) => p.id));
  const endingList = [...endingIds];
  let completed = 0;
  let stepLimit = 0;
  let sample: string[] = [];
  let played = 0;
  let stale = 0; // consecutive runs that discovered nothing new
  let stopReason: SmokeTestReport['stopReason'];
  const STALE_LIMIT = 24;

  // One Story, reset between runs: parsing the compiled JSON is the expensive part on long scripts.
  const story = new Story(json);
  let errors: string[] = [];
  story.onError = (msg: string) => errors.push(msg);
  for (let r = 0; r < runs; r++) {
    if (r > 0) story.ResetState();
    errors = [];
    played++;
    const before = { visited: visited.size, endings: Object.keys(endings).length, gates: gated.filter((g) => g.seenEnabled > 0).length, errors: runtimeErrors.size };
    let choicePoints = 0;
    const transcript: string[] = [];
    let steps = 0;
    let lastKnot = '';
    // Only ending passages are tracked per step (to know which ending was reached); every other
    // passage's visit is read once at the end of the run, which keeps long stories fast.
    let endCounts = visitCounts(story, endingList);
    try {
      while (steps++ < maxSteps) {
        while (story.canContinue) {
          const text = story.Continue() ?? '';
          if (r === 0 && text.trim()) transcript.push(text.trim());
        }
        const next = visitCounts(story, endingList);
        const endedIn = endingList.filter((id) => next[id] > endCounts[id]);
        endCounts = next;
        const choices = story.currentChoices;
        if (choices.length === 0) {
          lastKnot = endedIn[endedIn.length - 1] ?? lastKnot;
          break;
        }
        const knotNow = knotOf(choices[0].sourcePath) || lastKnot;
        lastKnot = knotNow;
        choicePoints++;
        for (const g of gated) if (g.passageId === knotNow && choices.some((c) => c.text === g.text)) g.seenEnabled++;
        let idx: number;
        if (r % 2 === 0) idx = Math.floor(rand() * choices.length);
        else {
          const scored = choices.map((c, i) => ({ i, n: taken.get(`${knotNow}:${c.text}`) ?? 0, tie: rand() }));
          scored.sort((a, b) => a.n - b.n || a.tie - b.tie);
          idx = scored[0].i;
        }
        const key = `${knotNow}:${choices[idx].text}`;
        taken.set(key, (taken.get(key) ?? 0) + 1);
        if (r === 0) transcript.push(`> ${choices[idx].text}`);
        story.ChooseChoiceIndex(idx);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    const finalCounts = visitCounts(story, passageIds);
    for (const id of passageIds) if (finalCounts[id] > 0) visited.add(id);
    errors.forEach((e) => runtimeErrors.add(e));
    if (steps > maxSteps) stepLimit++;
    else {
      completed++;
      if (lastKnot) endings[lastKnot] = (endings[lastKnot] ?? 0) + 1;
    }
    if (r === 0) sample = transcript.slice(0, 60);
    // Adaptive stopping: a run with no choices is fully deterministic, so every run would repeat it;
    // otherwise stop once many runs in a row find no new passage, ending, open gate or error.
    if (choicePoints === 0) {
      if (r + 1 < runs) stopReason = 'deterministic';
      break;
    }
    const found = visited.size > before.visited || Object.keys(endings).length > before.endings || gated.filter((g) => g.seenEnabled > 0).length > before.gates || runtimeErrors.size > before.errors;
    stale = found ? 0 : stale + 1;
    if (stale >= STALE_LIMIT && r + 1 < runs) {
      stopReason = 'no-new-coverage';
      break;
    }
    yield;
  }

  const unvisited = passageIds.filter((id) => !visited.has(id));
  const diagnostics: Diagnostic[] = [];
  for (const e of runtimeErrors) diagnostics.push(diag('RUNTIME_ERROR', 'error', 'runtime_test', e, { remediation: 'Open the Playtest tab to reproduce.' }));
  if (stepLimit === played)
    diagnostics.push(diag('RUNTIME_NO_ENDING', 'warning', 'runtime_test', `None of ${played} automated playthroughs reached an ending within ${maxSteps} choices.`, { exportBlocked: false }));
  for (const id of unvisited)
    diagnostics.push(diag('RUNTIME_UNVISITED', 'info', 'runtime_test', `Automated playthroughs never reached "${id}" (it may require a rare or impossible state).`, { entityId: id, exportBlocked: false }));
  for (const g of gated)
    if (g.seenEnabled === 0)
      diagnostics.push(diag('RUNTIME_GATE_NEVER_OPEN', 'warning', 'runtime_test', `Conditional choice "${g.text}" was never available in ${played} playthroughs.`, { entityId: g.id, details: { passageId: g.passageId }, exportBlocked: false }));

  return {
    report: { runs: played, completedRuns: completed, stepLimitRuns: stepLimit, endingsReached: endings, visited: [...visited], unvisited, gatedChoices: gated, runtimeErrors: [...runtimeErrors], sampleTranscript: sample, stopReason },
    diagnostics,
  };
}
