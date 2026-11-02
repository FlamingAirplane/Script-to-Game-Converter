import type { Diagnostic } from '../diagnostics';
import type { Condition, Effect, SourceFormat } from '../isr';

/** Explicit narrative markers recognised in every text format (see docs/StructuredMarkers.md). */
export type Marker =
  | { type: 'passage'; id: string; title?: string }
  | { type: 'start'; id: string }
  | { type: 'end' }
  | { type: 'divert'; target: string }
  | { type: 'item'; id: string; displayName?: string; consumable: boolean }
  | { type: 'var'; id: string; value: boolean | number | string }
  | { type: 'effect'; effect: Effect }
  | { type: 'choice'; text: string; target: string; conditions: Condition[]; effects: Effect[]; once: boolean };

export type ParsedBlock = { line: number; endLine?: number; ambiguity?: string; transformed?: boolean } & (
  | { kind: 'title'; key: string; value: string }
  | { kind: 'scene'; text: string; sceneNumber?: string }
  | { kind: 'section'; text: string; depth: number; anchor?: string }
  | { kind: 'action'; text: string }
  | { kind: 'dialogue'; character: string; extension?: string; parenthetical?: string; text: string; dual?: boolean }
  | { kind: 'transition'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'marker'; marker: Marker }
  | { kind: 'unsupported'; text: string; reason: string }
);

export interface ParsedDocument {
  format: SourceFormat;
  blocks: ParsedBlock[];
  diagnostics: Diagnostic[];
}

export interface Parser {
  format: SourceFormat;
  label: string;
  extensions: string[];
  /** 0..1 confidence that `text` is in this format (used when the extension is unknown). */
  sniff(text: string): number;
  parse(text: string, documentId: string): ParsedDocument;
}
