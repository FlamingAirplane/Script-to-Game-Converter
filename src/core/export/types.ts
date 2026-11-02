import type { AudioAssets } from '../audio';
import type { Diagnostic } from '../diagnostics';
import type { ProcessedStory } from '../pipeline';

// Engine adapter contract (TypeScript rendering of the IEngineAdapter interface in the design doc).
// These are Narrative Bridge interfaces, not APIs of Ink Unity Integration or Inkpot.

export type EngineTarget = 'unity' | 'unreal';

export interface ExportOptions {
  engine: EngineTarget;
  projectName: string;
  engineVersion: string;
  /** Git ref (tag or commit) of the integration. Branch names are allowed but recorded as unpinned. */
  integrationRef: string;
  includeDemo: boolean;
  /** Recorded dialogue clips referenced by #audio tags; shipped with the export. */
  audio?: AudioAssets;
}

export interface ExportFile {
  path: string;
  content: string | Uint8Array;
}

export interface EnvironmentRequirement {
  id: string;
  label: string;
  detail: string;
  /** A command or path the CLI's `doctor` can probe; the browser UI only shows these as a checklist. */
  probe?: { command?: string; paths?: string[] };
}

export interface ExportResult {
  engine: EngineTarget;
  rootName: string;
  files: ExportFile[];
  manifest: ExportManifest;
  report: ExportReport;
}

export interface ExportManifest {
  manifestVersion: string;
  projectId: string;
  storyVersion: string;
  sourceHash: string;
  sources: { fileName: string; format: string; sha256: string }[];
  storySchemaVersion: string;
  generatorVersion: string;
  generatedAt: string;
  targetEngine: 'Unity' | 'Unreal';
  engineVersion: string;
  integration: { name: string; repository: string; ref: string; pinned: boolean };
  inkCompiler: { name: string; version: string };
  validation: {
    schemaValidation: 'passed' | 'failed';
    graphValidation: 'passed' | 'passed_with_warnings' | 'failed';
    inkCompilation: 'passed' | 'failed';
    storySmokeTest: 'passed' | 'failed' | 'skipped';
    exportVerification: 'passed' | 'failed' | 'pending';
    engineImport: 'pending';
    engineSmokeTest: 'pending';
  };
}

export interface ExportReport {
  exportPath: string;
  engine: string;
  engineVersion: string;
  integration: string;
  filesCreated: string[];
  warnings: string[];
  errors: string[];
  setupInstructions: string[];
  diagnostics: Diagnostic[];
}

export interface EngineAdapter {
  id: EngineTarget;
  label: string;
  defaultEngineVersion: string;
  integration: { name: string; repository: string; defaultRef: string };
  requirements(options: ExportOptions): EnvironmentRequirement[];
  export(story: ProcessedStory, options: ExportOptions): Promise<ExportResult>;
}
