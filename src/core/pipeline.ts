import { analyze, type Analysis } from './analyzer';
import { buildStory, type BuildOptions, type SourceInput } from './builder';
import { blocksExport, diag, type Diagnostic } from './diagnostics';
import { generateInk, type GeneratedInk } from './inkgen';
import type { StoryProject } from './isr';
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

/** Adds automated-playthrough results to a story processed with `skipSmoke`. */
export function attachSmoke(p: ProcessedStory, r: SmokeResult): ProcessedStory {
  return withState({ ...p, smoke: r.report, smokePending: false, diagnostics: [...p.diagnostics, ...r.diagnostics] });
}

/**
 * Analyse → generate → compile → smoke test. Pure and synchronous. With `skipSmoke` it returns the
 * fast part only (the UI then runs playthroughs separately, see attachSmoke).
 */
export function processProject(project: StoryProject, parseDiagnostics: Diagnostic[] = [], opts: { smokeRuns?: number; skipSmoke?: boolean } = {}): ProcessedStory {
  const schemaDiagnostics = validateSchema(project);
  const analysis = analyze(project);
  const generated = generateInk(project);
  const compile = compileInk(generated.ink, generated.sourceMap);
  let smoke: SmokeTestReport | undefined;
  const runtime: Diagnostic[] = [];
  if (compile.ok && compile.json) {
    if (!opts.skipSmoke) {
      const r = smokeTest(compile.json, project, { runs: opts.smokeRuns ?? 120 });
      smoke = r.report;
      runtime.push(...r.diagnostics);
    }
  } else if (!compile.diagnostics.length) {
    runtime.push(diag('INK_COMPILE_ERROR', 'error', 'ink_compilation', 'The Ink compiler failed without a message.'));
  }
  const diagnostics = [...parseDiagnostics, ...schemaDiagnostics, ...analysis.diagnostics, ...compile.diagnostics, ...runtime];
  return withState({ project, analysis, generated, compile, smoke, diagnostics, smokePending: !!opts.skipSmoke && compile.ok });
}

export async function convert(inputs: SourceInput[], options: BuildOptions): Promise<ProcessedStory> {
  const { project, diagnostics } = await buildStory(inputs, options);
  return processProject(project, diagnostics);
}
