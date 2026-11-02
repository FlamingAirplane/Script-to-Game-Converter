export type Severity = 'error' | 'warning' | 'info' | 'review';
export type Stage =
  | 'input_validation'
  | 'parsing'
  | 'story_validation'
  | 'graph_analysis'
  | 'ink_generation'
  | 'ink_compilation'
  | 'runtime_test'
  | 'export';

export interface Diagnostic {
  code: string;
  severity: Severity;
  stage: Stage;
  message: string;
  entityId?: string;
  source?: { documentId?: string; line: number };
  details?: Record<string, unknown>;
  remediation?: string;
  exportBlocked: boolean;
}

export function diag(
  code: string,
  severity: Severity,
  stage: Stage,
  message: string,
  extra: Partial<Omit<Diagnostic, 'code' | 'severity' | 'stage' | 'message'>> = {},
): Diagnostic {
  return { code, severity, stage, message, exportBlocked: severity === 'error', ...extra };
}

export function blocksExport(ds: Diagnostic[]): boolean {
  return ds.some((d) => d.exportBlocked);
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, review: 1, warning: 2, info: 3 };

export function sortDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  return [...ds].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
