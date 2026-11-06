import { describeCondition } from '../gating';
import { isActive, type StoryProject, type UnityTheme } from '../isr';

// Translations for the Unity package: every piece of text a player can see (lines, choices, speaker names,
// scene headings, stage directions, what a locked choice needs, and the story panel's own words), each with
// a key made from its text. The package ships the sheet (Translations.csv); translators fill in a column per
// language, and NarrativeLocalization (or Unity's Localization package) shows the story in that language.
// The key is computed the same way in C# (see NarrativeLocalization.Key), so a line finds its translation
// by its text alone, with no ids in the Ink.

export type TranslationKind = 'line' | 'choice' | 'speaker' | 'scene' | 'direction' | 'needs' | 'interface';

export interface TranslationEntry {
  key: string;
  kind: TranslationKind;
  /** Where it's first used (a passage id), or "" for the interface. */
  passage: string;
  source: string;
}

/** Whitespace runs become one space, and the ends are trimmed: how ink prints text. */
export function normaliseText(text: string): string {
  let out = '';
  let space = false;
  for (const ch of text) {
    if (/\s/.test(ch)) space = out.length > 0;
    else {
      if (space) out += ' ';
      space = false;
      out += ch;
    }
  }
  return out;
}

/** A short key from the text: FNV-1a over its UTF-16 code units, e.g. "nb_1c3f9a2e". */
export function translationKey(text: string): string {
  const t = normaliseText(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `nb_${h.toString(16).padStart(8, '0')}`;
}

/** The story panel's own words (NarrativeView's labels and Settings menu), so they're translated too. */
export function interfaceWords(theme?: UnityTheme): string[] {
  const t = theme;
  return [
    ...(t ? [t.continueLabel, t.endLabel, t.restartLabel, t.saveLabel, t.loadLabel, t.settingsLabel, t.lockedLabel] : []),
    // NarrativeView.SettingsWords (keep in step with unityUi.ts).
    'Settings', 'Text size', 'Typing speed', 'Go on by itself', 'High contrast', 'Voice volume', 'Language',
    'Slow', 'Normal', 'Fast', 'Instant', 'As designed', 'On', 'Off', 'Reset', 'Close',
    'Save to a slot', 'Load a save', 'Slot', 'Autosave', 'empty', 'earlier version',
  ];
}

/** Every piece of text a player can see, once each, in story order. */
export function translationEntries(project: StoryProject, theme?: UnityTheme): TranslationEntry[] {
  const out: TranslationEntry[] = [];
  const seen = new Set<string>();
  const add = (kind: TranslationKind, passage: string, text: string | undefined) => {
    const source = normaliseText(text ?? '');
    if (!source) return;
    const key = translationKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, kind, passage, source });
  };
  const names = new Map(project.characters.map((c) => [c.id, c.displayName]));
  for (const p of project.passages) {
    add('scene', p.id, p.sceneHeading);
    for (const b of p.content) {
      if (b.type === 'action') for (const para of b.text.split('\n')) add('line', p.id, para);
      else if (b.type === 'dialogue') {
        // Ink prints dialogue as "NAME: text"; the controller splits off the name.
        add('speaker', p.id, (names.get(b.speakerId) ?? b.speakerId).toUpperCase());
        add('direction', p.id, b.parenthetical);
        add('line', p.id, b.text);
      } else if (b.type === 'transition') add('line', p.id, b.text);
    }
    for (const c of p.choices) {
      if (!isActive(c.review)) continue;
      add('choice', p.id, c.text);
      for (const x of c.conditions) add('needs', p.id, describeCondition(x, project));
    }
  }
  for (const w of interfaceWords(theme)) add('interface', '', w);
  return out;
}

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The translation sheet: key, kind, passage, source, then one empty column per language (e.g. "fr", "de").
 * Translators fill the columns in; the first row names them.
 */
export function translationSheet(project: StoryProject, theme?: UnityTheme, languages: string[] = []): string {
  const rows = [['key', 'kind', 'passage', 'source', ...languages]];
  for (const e of translationEntries(project, theme)) rows.push([e.key, e.kind, e.passage, e.source, ...languages.map(() => '')]);
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
