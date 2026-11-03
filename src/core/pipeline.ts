import { analyze, type Analysis } from './analyzer';
import { buildStory, type BuildOptions, type SourceInput } from './builder';
import { blocksExport, diag, type Diagnostic } from './diagnostics';
import { generateInk, type GeneratedInk } from './inkgen';
import type { StoryProject } from './isr';
import { log } from './log';
import { validateSchema } from './schema';
import { compileInk, smokeTest, type CompileResult, type SmokeResult, type SmokeTestReport } from './validate';

export type ConversionState =
  | 'Queued'
  | 'Parsing'
  | 'ReviewRequired'
  | 'Generating'
  | 'Validating'
  | 'Exporting'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled';

export interface ProcessedStory {
  project: StoryProject;
  analysis: Analysis;
  generated: GeneratedInk;
  compile: CompileResult;
  smoke?: SmokeTestReport;
  diagnostics: Diagnostic[];
  state: ConversionState;
  exportBlocked: boolean;
  /** True while the automated playthroughs for this version are still running (UI only). */
  smokePending?: boolean;
}

function withState<T extends Omit<ProcessedStory, 'state' | 'exportBlocked'>>(p: T): T & Pick<ProcessedStory, 'state' | 'exportBlocked'> {
  const exportBlocked = blocksExport(p.diagnostics);
  const needsReview = p.diagnostics.some((d) => d.severity === 'review');
  return { ...p, exportBlocked, state: exportBlocked ? 'Failed' : needsReview ? 'ReviewRequired' : 'Succeeded' };
}

const logger = log('pipeline');

/** Counts from a playthrough report, for log entries. */
export function smokeSummary(r: SmokeTestReport): Record<string, unknown> {
  return { runs: r.runs, completed: r.completedRuns, endings: Object.keys(r.endingsReached).length, unvisited: r.unvisited.length, runtimeErrors: r.runtimeErrors.length, stopReason: r.stopReason };
}

/** Adds automated-playthrough results to a story processed with `skipSmoke`. */
export function attachSmoke(p: ProcessedStory, r: SmokeResult): ProcessedStory {
  return withState({ ...p, smoke: r.report, smokePending: false, diagnostics: [...p.diagnostics, ...r.diagnostics] });
}

/**
 * Analyse → generate → compile → smoke test. Pure and synchronous. With `skipSmoke` it returns the
 * fast part only (the UI then runs playthroughs separately, see attachSmoke).
 */
export function processProject(project: StoryProject, parseDiagnostics: Diagnostic[] = [], opts: { smokeRuns?: number; skipSmoke?: boolean } = {}): ProcessedStory {
  const total = logger.time('Processed story');
  let t = logger.time('Validated schema');
  const schemaDiagnostics = validateSchema(project);
  t({ problems: schemaDiagnostics.length });
  t = logger.time('Analysed story graph');
  const analysis = analyze(project);
  t({ nodes: analysis.graph.nodes.length, edges: analysis.graph.edges.length, reachable: analysis.reachable.size, endings: analysis.endings.length, diagnostics: analysis.diagnostics.length });
  t = logger.time('Generated Ink');
  const generated = generateInk(project);
  t({ bytes: generated.ink.length, lines: generated.sourceMap.length, passthrough: project.inkPassthrough !== undefined });
  t = logger.time('Compiled Ink');
  const compile = compileInk(generated.ink, generated.sourceMap);
  t({ ok: compile.ok, errors: compile.diagnostics.filter((d) => d.severity === 'error').length, warnings: compile.diagnostics.filter((d) => d.severity === 'warning').length });
  if (!compile.ok) logger.warn('Ink did not compile', { errors: compile.diagnostics.slice(0, 5).map((d) => d.message) });
  let smoke: SmokeTestReport | undefined;
  const runtime: Diagnostic[] = [];
  if (compile.ok && compile.json) {
    if (!opts.skipSmoke) {
      const ts = logger.time('Ran automated playthroughs');
      const r = smokeTest(compile.json, project, { runs: opts.smokeRuns ?? 120 });
      ts(smokeSummary(r.report));
      smoke = r.report;
      runtime.push(...r.diagnostics);
    }
  } else if (!compile.diagnostics.length) {
    runtime.push(diag('INK_COMPILE_ERROR', 'error', 'ink_compilation', 'The Ink compiler failed without a message.'));
  }
  const diagnostics = [...parseDiagnostics, ...schemaDiagnostics, ...analysis.diagnostics, ...compile.diagnostics, ...runtime];
  const result = withState({ project, analysis, generated, compile, smoke, diagnostics, smokePending: !!opts.skipSmoke && compile.ok });
  total({ state: result.state, exportBlocked: result.exportBlocked, diagnostics: diagnostics.length, playthroughs: opts.skipSmoke ? 'deferred' : smoke?.runs ?? 0 });
  return result;
}

export async function convert(inputs: SourceInput[], options: BuildOptions): Promise<ProcessedStory> {
  const { project, diagnostics } = await buildStory(inputs, options);
  return processProject(project, diagnostics);
}
