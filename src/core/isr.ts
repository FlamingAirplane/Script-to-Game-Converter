// Intermediate Story Representation (ISR) — the canonical, engine-independent story model.
// Versioned independently of the application (see SCHEMA_VERSION).

import type { AudioRef, VoiceSettings } from './audio';

export const SCHEMA_VERSION = '1.0';

export type Provenance = 'source' | 'transformed' | 'generated' | 'user_authored';
export type ReviewStatus = 'approved' | 'pending' | 'rejected';
export type ConversionMode = 'faithful' | 'adaptation' | 'structured';

export interface SourceRef {
  documentId: string;
  line: number; // 1-based
  endLine?: number;
}

export interface SourceDocument {
  id: string;
  fileName: string;
  format: SourceFormat;
  sha256: string;
  byteLength: number;
  text: string; // original source is preserved verbatim
}

export type SourceFormat = 'txt' | 'fountain' | 'md' | 'ink' | 'twee';

export interface Character {
  id: string;
  displayName: string;
  aliases: string[];
  /** Browser text-to-speech voice used in Playtest and the playable story. */
  voice?: VoiceSettings;
}

export interface Item {
  id: string;
  displayName: string;
  consumable: boolean;
  origin: Provenance;
}

export type VariableType = 'bool' | 'int' | 'string';
export interface Variable {
  id: string;
  type: VariableType;
  initial: boolean | number | string;
  origin: Provenance;
}

// Condition expression tree — never arbitrary strings that could be executed.
export type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<=';
export type Condition =
  | { type: 'has_item'; itemId: string }
  | { type: 'not'; condition: Condition }
  | { type: 'compare'; variableId: string; op: CompareOp; value: boolean | number | string }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] };

export type Effect =
  | { type: 'give_item'; itemId: string }
  | { type: 'take_item'; itemId: string }
  | { type: 'set_var'; variableId: string; value: boolean | number | string }
  | { type: 'add_var'; variableId: string; amount: number };

export type ContentBlock =
  | { type: 'dialogue'; speakerId: string; text: string; parenthetical?: string; audio?: AudioRef; origin: Provenance; source?: SourceRef }
  | { type: 'action'; text: string; origin: Provenance; source?: SourceRef }
  | { type: 'transition'; text: string; origin: Provenance; source?: SourceRef }
  | { type: 'note'; text: string; origin: Provenance; source?: SourceRef } // preserved, emitted as Ink comment
  | { type: 'effect'; effect: Effect; origin: Provenance; review?: ReviewStatus; source?: SourceRef }
  | { type: 'unsupported'; text: string; reason: string; origin: Provenance; source?: SourceRef }
  /** A Continue break: what follows appears only once the reader chooses Continue. */
  | { type: 'pause'; origin: Provenance; source?: SourceRef };

/** The choice text of a Continue break, in Ink and every reader. */
export const CONTINUE_TEXT = 'Continue';

export interface Choice {
  id: string;
  text: string;
  target: string; // passage id, or the literal 'END'
  conditions: Condition[]; // implicitly AND-ed
  effects: Effect[];
  once: boolean; // '*' (once-only) vs '+' (sticky) in Ink
  origin: Provenance;
  review: ReviewStatus;
  source?: SourceRef;
}

export interface Passage {
  id: string;
  title: string;
  sourceId?: string; // e.g. scene_01
  sceneHeading?: string;
  content: ContentBlock[];
  choices: Choice[];
  divert?: string; // unconditional continuation when there are no choices
  isEnding: boolean;
  origin: Provenance;
  review: ReviewStatus;
  source?: SourceRef;
}

export interface StoryProject {
  schemaVersion: string;
  project: {
    id: string;
    title: string;
    author?: string;
    startPassage: string;
    mode: ConversionMode;
  };
  sources: SourceDocument[];
  characters: Character[];
  items: Item[];
  variables: Variable[];
  passages: Passage[];
  // When importing Ink, the original Ink is passed through instead of regenerated.
  inkPassthrough?: string;
  /** Passage positions dragged by hand on the story map (UI only; absent = automatic layout). */
  layout?: Record<string, { x: number; y: number }>;
  /** How the story looks when played in a game engine (absent = defaults). */
  presentation?: { unity?: UnityTheme };
}

/**
 * The Unity story UI's look, chosen on the Export page and exported as NarrativeBridgeTheme.json
 * (the developer can change it further in Unity's Inspector). Colours are #rrggbb.
 */
export interface UnityTheme {
  preset: 'book' | 'night' | 'minimal' | 'custom';
  background: string;
  text: string;
  /** Speaker names, choice buttons and the Continue button. */
  accent: string;
  /** Scene headings, stage directions and the status line. */
  muted: string;
  /** How opaque the story panel is, 0–1. */
  panelOpacity: number;
  layout: 'bottom' | 'center' | 'left' | 'right' | 'full';
  /** Text size in pixels at 1920×1080 (the UI scales with the screen). */
  fontSize: number;
  /** Typewriter speed in characters per second; 0 shows each line at once. */
  charactersPerSecond: number;
  showSpeakers: boolean;
  showSceneHeadings: boolean;
  showChoiceNumbers: boolean;
  /** Restart, Save and Load buttons under the story. */
  showToolbar: boolean;
  continueLabel: string;
  endLabel: string;
}

export function itemVar(itemId: string): string {
  return `has_${itemId}`;
}

/** Deterministic, Ink-safe identifier (letters, digits, underscore; cannot start with a digit). */
export function slugify(s: string): string {
  let out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/g, '');
  if (/^[0-9]/.test(out)) out = `s_${out}`;
  return out;
}

/** Returns an id unique within `taken`, appending _2, _3... and records it. */
export function uniqueId(base: string, taken: Set<string>, fallback = 'id'): string {
  const root = slugify(base) || fallback;
  let id = root;
  let n = 2;
  while (taken.has(id) || RESERVED.has(id)) id = `${root}_${n++}`;
  taken.add(id);
  return id;
}

// Ink keywords and identifiers we must never emit as knot/variable names.
const RESERVED = new Set([
  'end', 'done', 'end_', 'true', 'false', 'not', 'and', 'or', 'mod', 'var', 'const', 'list',
  'function', 'return', 'include', 'external', 'else', 'temp', 'stopping', 'cycle', 'shuffle', 'once',
]);

export function conditionItemIds(c: Condition, out = new Set<string>()): Set<string> {
  switch (c.type) {
    case 'has_item': out.add(c.itemId); break;
    case 'not': conditionItemIds(c.condition, out); break;
    case 'and': case 'or': c.conditions.forEach((x) => conditionItemIds(x, out)); break;
    case 'compare': break;
  }
  return out;
}

export function conditionVarIds(c: Condition, out = new Set<string>()): Set<string> {
  switch (c.type) {
    case 'compare': out.add(c.variableId); break;
    case 'not': conditionVarIds(c.condition, out); break;
    case 'and': case 'or': c.conditions.forEach((x) => conditionVarIds(x, out)); break;
    case 'has_item': break;
  }
  return out;
}

/** Choices and effects that are not rejected. Pending generated content is still emitted only when approved. */
export function isActive(r: ReviewStatus): boolean {
  return r === 'approved';
}
