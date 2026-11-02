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
  } catch {
    // Errors were reported through the handler.
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
export function smokeTest(json: string, project: StoryProject, opts: { runs?: number; maxSteps?: number; seed?: number } = {}): { report: SmokeTestReport; diagnostics: Diagnostic[] } {
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
  let completed = 0;
  let stepLimit = 0;
  let sample: string[] = [];

  for (let r = 0; r < runs; r++) {
    const story = new Story(json);
    const errors: string[] = [];
    story.onError = (msg: string) => errors.push(msg);
    const transcript: string[] = [];
    let steps = 0;
    let lastKnot = '';
    let counts = visitCounts(story, passageIds);
    try {
      while (steps++ < maxSteps) {
        while (story.canContinue) {
          const text = story.Continue() ?? '';
          if (r === 0 && text.trim()) transcript.push(text.trim());
        }
        // Passages entered during this step, found by diffing Ink visit counts.
        const next = visitCounts(story, passageIds);
        const entered = passageIds.filter((id) => next[id] > counts[id]);
        counts = next;
        entered.forEach((id) => visited.add(id));
        if (entered.length) lastKnot = entered.find((id) => endingIds.has(id)) ?? entered[entered.length - 1];
        const choices = story.currentChoices;
        if (choices.length === 0) break;
        const knotNow = knotOf(choices[0].sourcePath) || lastKnot;
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
    errors.forEach((e) => runtimeErrors.add(e));
    if (steps > maxSteps) stepLimit++;
    else {
      completed++;
      if (lastKnot) endings[lastKnot] = (endings[lastKnot] ?? 0) + 1;
    }
    if (r === 0) sample = transcript.slice(0, 60);
  }

  const unvisited = passageIds.filter((id) => !visited.has(id));
  const diagnostics: Diagnostic[] = [];
  for (const e of runtimeErrors) diagnostics.push(diag('RUNTIME_ERROR', 'error', 'runtime_test', e, { remediation: 'Open the Playtest tab to reproduce.' }));
  if (stepLimit === runs)
    diagnostics.push(diag('RUNTIME_NO_ENDING', 'warning', 'runtime_test', `None of ${runs} automated playthroughs reached an ending within ${maxSteps} choices.`, { exportBlocked: false }));
  for (const id of unvisited)
    diagnostics.push(diag('RUNTIME_UNVISITED', 'info', 'runtime_test', `Automated playthroughs never reached "${id}" (it may require a rare or impossible state).`, { entityId: id, exportBlocked: false }));
  for (const g of gated)
    if (g.seenEnabled === 0)
      diagnostics.push(diag('RUNTIME_GATE_NEVER_OPEN', 'warning', 'runtime_test', `Conditional choice "${g.text}" was never available in ${runs} playthroughs.`, { entityId: g.id, details: { passageId: g.passageId }, exportBlocked: false }));

  return {
    report: { runs, completedRuns: completed, stepLimitRuns: stepLimit, endingsReached: endings, visited: [...visited], unvisited, gatedChoices: gated, runtimeErrors: [...runtimeErrors], sampleTranscript: sample },
    diagnostics,
  };
}
