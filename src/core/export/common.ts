import { audioFileName, referencedAudio, type AudioAssets } from '../audio';
import { blocksExport, diag, type Diagnostic } from '../diagnostics';
import { fnv1a, sha256Hex } from '../hash';
import { itemVar } from '../isr';
import type { ProcessedStory } from '../pipeline';
import { GENERATOR_VERSION, INK_COMPILER, MANIFEST_VERSION } from '../version';
import type { EngineAdapter, ExportFile, ExportManifest, ExportOptions, ExportResult } from './types';

export function pascalCase(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(out) ? out.slice(0, 40) : `Story${out}`.slice(0, 40);
}

/** Short stable id of the generated story; save data records it so incompatible saves are rejected. */
export function storyVersion(story: ProcessedStory): string {
  return fnv1a(story.generated.ink);
}

export function isPinnedRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref) || /^v?\d+\.\d+(\.\d+)?([-.][\w.]+)?$/.test(ref);
}

export async function buildManifest(
  story: ProcessedStory,
  options: ExportOptions,
  adapter: EngineAdapter,
): Promise<ExportManifest> {
  const ds = story.diagnostics;
  const has = (stage: string, sev: string[]) => ds.some((d) => d.stage === stage && sev.includes(d.severity));
  const combined = story.project.sources.map((s) => s.sha256).join(':');
  return {
    manifestVersion: MANIFEST_VERSION,
    projectId: story.project.project.id,
    storyVersion: storyVersion(story),
    sourceHash: `sha256:${story.project.sources.length === 1 ? story.project.sources[0].sha256 : await sha256Hex(combined)}`,
    sources: story.project.sources.map((s) => ({ fileName: s.fileName, format: s.format, sha256: s.sha256 })),
    storySchemaVersion: story.project.schemaVersion,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    targetEngine: options.engine === 'unity' ? 'Unity' : 'Unreal',
    engineVersion: options.engineVersion,
    integration: {
      name: adapter.integration.name,
      repository: adapter.integration.repository,
      ref: options.integrationRef,
      pinned: isPinnedRef(options.integrationRef),
    },
    inkCompiler: { name: INK_COMPILER.name, version: INK_COMPILER.version },
    validation: {
      schemaValidation: ds.some((d) => d.code === 'SCHEMA_INVALID') ? 'failed' : 'passed',
      graphValidation: has('graph_analysis', ['error']) || has('story_validation', ['error']) ? 'failed' : has('graph_analysis', ['warning']) ? 'passed_with_warnings' : 'passed',
      inkCompilation: story.compile.ok ? 'passed' : 'failed',
      storySmokeTest: !story.smoke ? 'skipped' : story.smoke.runtimeErrors.length ? 'failed' : 'passed',
      exportVerification: 'pending',
      engineImport: 'pending',
      engineSmokeTest: 'pending',
    },
  };
}

/** Shared files every export contains, regardless of engine. */
export function commonFiles(story: ProcessedStory, manifest: ExportManifest, prefix: string): ExportFile[] {
  return [
    { path: `${prefix}narrative-bridge.manifest.json`, content: json(manifest) },
    { path: `${prefix}story.isr.json`, content: json(stripSourceText(story)) },
    { path: `${prefix}validation-report.json`, content: json(validationReport(story)) },
    { path: `${prefix}source-map.json`, content: json(story.generated.sourceMap) },
  ];
}

function stripSourceText(story: ProcessedStory) {
  // The ISR keeps provenance; original source text is shipped separately under SourceDocuments/.
  return { ...story.project, sources: story.project.sources.map(({ text: _text, ...rest }) => rest) };
}

export function sourceFiles(story: ProcessedStory, prefix: string): ExportFile[] {
  return story.project.sources.map((s) => ({ path: `${prefix}SourceDocuments/${s.fileName.replace(/[^\w.\- ]/g, '_')}`, content: s.text }));
}

export function validationReport(story: ProcessedStory) {
  return {
    state: story.state,
    exportBlocked: story.exportBlocked,
    counts: countBySeverity(story.diagnostics),
    smokeTest: story.smoke
      ? {
          runs: story.smoke.runs,
          completedRuns: story.smoke.completedRuns,
          endingsReached: story.smoke.endingsReached,
          unvisitedPassages: story.smoke.unvisited,
          gatedChoices: story.smoke.gatedChoices,
          runtimeErrors: story.smoke.runtimeErrors,
        }
      : null,
    diagnostics: story.diagnostics,
  };
}

export function countBySeverity(ds: Diagnostic[]) {
  return {
    error: ds.filter((d) => d.severity === 'error').length,
    warning: ds.filter((d) => d.severity === 'warning').length,
    review: ds.filter((d) => d.severity === 'review').length,
    info: ds.filter((d) => d.severity === 'info').length,
  };
}

export function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n';
}

export function itemVarNames(story: ProcessedStory): string[] {
  return story.project.items.filter((i) => story.generated.ink.includes(`VAR ${itemVar(i.id)} `)).map((i) => itemVar(i.id));
}

/** Refuses to export a story with fatal errors — never "succeed" just because files were written. */
export function assertExportable(story: ProcessedStory): void {
  if (blocksExport(story.diagnostics) || !story.compile.ok) {
    const first = story.diagnostics.find((d) => d.exportBlocked);
    throw new ExportBlockedError(first ? `${first.code}: ${first.message}` : 'Ink compilation failed.');
  }
}

export class ExportBlockedError extends Error {}

/**
 * Export verifier: checks the package that was actually produced — required files exist, the
 * shipped .ink is byte-identical to the validated Ink, JSON files parse, and the manifest is
 * consistent. Engine import and engine smoke tests remain "pending" until run in the editor.
 */
export function verifyExport(result: ExportResult, story: ProcessedStory, required: string[]): Diagnostic[] {
  const ds: Diagnostic[] = [];
  const byPath = new Map(result.files.map((f) => [f.path, f.content]));
  for (const r of required)
    if (!byPath.has(r)) ds.push(diag('EXPORT_FILE_MISSING', 'error', 'export', `Expected file ${r} was not produced.`, { details: { path: r } }));
  for (const f of result.files) {
    if (f.path.endsWith('.ink') && f.path.includes('MainStory') && f.content !== story.generated.ink)
      ds.push(diag('EXPORT_INK_MISMATCH', 'error', 'export', `${f.path} differs from the validated Ink.`));
    if (/\.(json|uproject|asmdef)$/.test(f.path) && typeof f.content === 'string') {
      try {
        JSON.parse(f.content);
      } catch {
        ds.push(diag('EXPORT_JSON_INVALID', 'error', 'export', `${f.path} is not valid JSON.`));
      }
    }
    if (f.path.includes('..') || f.path.startsWith('/')) ds.push(diag('EXPORT_PATH_UNSAFE', 'error', 'export', `Unsafe path ${f.path}.`));
  }
  if (!result.manifest.integration.pinned)
    ds.push(
      diag('INTEGRATION_UNPINNED', 'warning', 'export', `${result.manifest.integration.name} ref "${result.manifest.integration.ref}" is a branch, not a tag or commit — builds may not be reproducible.`, {
        remediation: 'Set the integration ref to a tested release tag or commit SHA.',
        exportBlocked: false,
      }),
    );
  return ds;
}

/** Audio files for every clip the story's dialogue refers to, plus diagnostics for missing ones. */
export function audioFiles(story: ProcessedStory, assets: AudioAssets | undefined, dir: string): { files: ExportFile[]; missing: string[] } {
  const files: ExportFile[] = [];
  const missing: string[] = [];
  for (const ref of referencedAudio(story.project)) {
    const a = assets?.[ref.id];
    if (a) files.push({ path: `${dir}${audioFileName(ref)}`, content: a.bytes });
    else missing.push(ref.name);
  }
  return { files, missing };
}
