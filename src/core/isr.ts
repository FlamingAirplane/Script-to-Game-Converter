// Intermediate Story Representation (ISR) — the canonical, engine-independent story model.
// Versioned independently of the application (see SCHEMA_VERSION).

import type { AudioRef, VoiceSettings } from './audio';
import type { ImageRef } from './images';
import type { SessionRef } from './session';

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
  /**
   * The file this text was taken from, when it wasn't text (Word, PDF, Final Draft, Twine). Its bytes
   * live in the browser like other media (and in saved project files), under `id`.
   */
  original?: OriginalFile;
}

export interface OriginalFile {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
}

/** Every original file the project keeps (see SourceDocument.original). */
export function referencedOriginals(project: { sources: { original?: OriginalFile }[] }): OriginalFile[] {
  return project.sources.flatMap((s) => (s.original ? [s.original] : []));
}

export type SourceFormat = 'txt' | 'fountain' | 'md' | 'ink' | 'twee';

export interface Character {
  id: string;
  displayName: string;
  aliases: string[];
  /** Browser text-to-speech voice used in Playtest and the playable story. */
  voice?: VoiceSettings;
  /** A picture of the character, shown while they speak (Playtest, the playable story, Unity). */
  portrait?: ImageRef;
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
  /** A picture for the scene, shown when the passage begins. */
  image?: ImageRef;
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
  /** Long voice-session recordings that lines' clips were cut from (see src/core/session.ts). */
  sessions?: SessionRef[];
}

/**
 * The Unity story UI's look, chosen on the Export page and exported as NarrativeBridgeTheme.json
 * (the developer can change it further in Unity's Inspector). Colours are #rrggbb.
 */
/**
 * The Unity story UI's look and behaviour (presentation.unity). Every field is described, with its
 * range and default, in UNITY_THEME_FIELDS (src/core/export/unityTheme.ts), which also checks saved
 * values; the generated NarrativeTheme (C#) has the same fields.
 */
export interface UnityTheme {
  preset: 'book' | 'night' | 'minimal' | 'custom';
  // Colours
  background: string;
  text: string;
  /** Choice buttons and the Continue button. */
  accent: string;
  /** Stage directions, transitions, choices made and the status line. */
  muted: string;
  speakerColour: string;
  sceneColour: string;
  buttonColour: string;
  choiceTextColour: string;
  borderColour: string;
  // Panel
  layout: 'bottom' | 'center' | 'left' | 'right' | 'full' | 'custom';
  /** The panel's corners as fractions of the screen (origin bottom-left); used by the custom layout. */
  panelXMin: number;
  panelYMin: number;
  panelXMax: number;
  panelYMax: number;
  /** How opaque the story panel is, 0–1. */
  panelOpacity: number;
  padding: number;
  borderWidth: number;
  // Text
  /** Text size in pixels at the reference resolution (the UI scales with the screen). */
  fontSize: number;
  lineSpacing: number;
  /** Space between lines of the story, as a fraction of the text size. */
  paragraphSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  /** history: everything so far scrolls; scene: cleared at each new scene; line: only the latest line. */
  transcript: 'history' | 'scene' | 'line';
  showChoiceHistory: boolean;
  // Speakers and scenes
  showSpeakers: boolean;
  speakerStyle: 'above' | 'inline';
  speakerScale: number;
  speakerUppercase: boolean;
  showParentheticals: boolean;
  showSceneHeadings: boolean;
  sceneScale: number;
  sceneUppercase: boolean;
  // Typing and pacing
  /** Typewriter speed in characters per second; 0 shows each line at once. */
  charactersPerSecond: number;
  /** Extra pause, in seconds, after . ! ? and other sentence ends while typing. */
  punctuationPause: number;
  /** Each new line fades in over this many seconds. */
  lineFade: number;
  clickToSkip: boolean;
  /** Go on past Continue breaks by itself, after autoAdvanceDelay seconds. */
  autoAdvance: boolean;
  autoAdvanceDelay: number;
  // Choices and buttons
  showChoiceNumbers: boolean;
  choiceAlign: 'left' | 'center';
  choiceScale: number;
  /** Button height as a multiple of the text size. */
  choiceHeight: number;
  choiceSpacing: number;
  buttonOpacity: number;
  buttonHoverOpacity: number;
  continueLabel: string;
  continueArrow: boolean;
  endLabel: string;
  // Toolbar
  /** Restart, Save and Load buttons under the story. */
  showToolbar: boolean;
  showRestart: boolean;
  showSave: boolean;
  showLoad: boolean;
  showStatus: boolean;
  restartLabel: string;
  saveLabel: string;
  loadLabel: string;
  // Scene pictures
  /** Scene pictures fill the screen behind the panel. */
  showPictures: boolean;
  pictureFit: 'cover' | 'contain';
  /** Darkens the picture behind the panel, 0–0.9. */
  pictureDim: number;
  pictureFade: number;
  // Character portraits
  /** The speaking character's portrait (see Character.portrait). */
  showPortraits: boolean;
  /** above: standing on top of the panel; inside: within the panel, beside the text. */
  portraitPlacement: 'above' | 'inside';
  /** alternate: each new speaker takes the other side, as in a conversation. */
  portraitSide: 'left' | 'right' | 'alternate';
  /** Height in pixels at the reference resolution. */
  portraitHeight: number;
  portraitMirrorRight: boolean;
  portraitFade: number;
  /** Keep the last speaker's portrait during narration (otherwise it's hidden). */
  keepPortraitForNarration: boolean;
  // Screen and sound
  referenceWidth: number;
  referenceHeight: number;
  /** 0 scales the UI with the screen's width, 1 with its height. */
  matchWidthOrHeight: number;
  voiceVolume: number;
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
