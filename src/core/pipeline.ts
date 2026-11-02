import { analyze, type Analysis } from './analyzer';
import { buildStory, type BuildOptions, type SourceInput } from './builder';
import { blocksExport, diag, type Diagnostic } from './diagnostics';
import { generateInk, type GeneratedInk } from './inkgen';
import type { StoryProject } from './isr';
import { validateSchema } from './schema';
import { compileInk, smokeTest, type CompileResult, type SmokeTestReport } from './validate';

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
}

/** Analyse → generate → compile → smoke test. Pure and synchronous; safe to re-run on every edit. */
export function processProject(project: StoryProject, parseDiagnostics: Diagnostic[] = [], opts: { smokeRuns?: number } = {}): ProcessedStory {
  const schemaDiagnostics = validateSchema(project);
  const analysis = analyze(project);
  const generated = generateInk(project);
  const compile = compileInk(generated.ink, generated.sourceMap);
  let smoke: SmokeTestReport | undefined;
  const runtime: Diagnostic[] = [];
  if (compile.ok && compile.json) {
    const r = smokeTest(compile.json, project, { runs: opts.smokeRuns ?? 120 });
    smoke = r.report;
    runtime.push(...r.diagnostics);
  } else if (!compile.diagnostics.length) {
    runtime.push(diag('INK_COMPILE_ERROR', 'error', 'ink_compilation', 'The Ink compiler failed without a message.'));
  }
  const diagnostics = [...parseDiagnostics, ...schemaDiagnostics, ...analysis.diagnostics, ...compile.diagnostics, ...runtime];
  const exportBlocked = blocksExport(diagnostics);
  const needsReview = diagnostics.some((d) => d.severity === 'review');
  const state: ConversionState = exportBlocked ? 'Failed' : needsReview ? 'ReviewRequired' : 'Succeeded';
  return { project, analysis, generated, compile, smoke, diagnostics, state, exportBlocked };
}

export async function convert(inputs: SourceInput[], options: BuildOptions): Promise<ProcessedStory> {
  const { project, diagnostics } = await buildStory(inputs, options);
  return processProject(project, diagnostics);
}
