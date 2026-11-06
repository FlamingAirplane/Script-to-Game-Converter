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
 * The translation sheet: key, kind, passage, source, then a column per language (e.g. "fr", "de"): the story's
 * translations so far, and any other languages asked for, empty. Translators fill the columns in.
 */
export function translationSheet(project: StoryProject, theme?: UnityTheme, languages: string[] = []): string {
  const t = project.translations;
  const langs = [...new Set([...(t?.languages ?? []), ...languages])];
  const rows = [['key', 'kind', 'passage', 'source', ...langs]];
  for (const e of translationEntries(project, theme)) rows.push([e.key, e.kind, e.passage, e.source, ...langs.map((l) => t?.strings[e.key]?.[l] ?? '')]);
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Reads CSV: "quoted" fields may hold separators, doubled quotes and line breaks. The separator is a comma, or a
 * semicolon or tab when the first row uses one (spreadsheets in some languages save that way). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].find((c) => first.split(c).length >= 4) ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface TranslationImport {
  /** The languages in the sheet, with how many texts each translates now (of `total`). */
  languages: { code: string; translated: number }[];
  total: number;
  /** Rows whose key isn't in the story any more (its text changed or went), so they were left out. */
  stale: number;
}

/**
 * Brings a filled-in translation sheet into the story: every language column, every non-empty cell for a key the
 * story still has. Cells left empty keep the translation the story already had. Returns what it found.
 */
export function importTranslations(project: StoryProject, csv: string): TranslationImport {
  const rows = parseCsv(csv);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const keyCol = header.indexOf('key');
  const sourceCol = header.indexOf('source');
  if (keyCol < 0 || sourceCol < 0) throw new Error('This isn’t a translation sheet: its first row needs “key” and “source” columns.');
  const langCols = header.map((h, i) => ({ code: h, i })).filter((c) => c.i > sourceCol && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(c.code));
  if (!langCols.length) throw new Error('The sheet has no language columns after “source” (for example “fr” or “de”).');
  const known = new Set(translationEntries(project, project.presentation?.unity).map((e) => e.key));
  const t = (project.translations ??= { languages: [], strings: {} });
  for (const c of langCols) if (!t.languages.includes(c.code)) t.languages.push(c.code);
  let stale = 0;
  for (const row of rows.slice(1)) {
    const key = (row[keyCol] ?? '').trim();
    if (!key) continue;
    if (!known.has(key)) {
      if (langCols.some((c) => (row[c.i] ?? '').trim())) stale++;
      continue;
    }
    for (const c of langCols) {
      const v = (row[c.i] ?? '').trim();
      if (v) (t.strings[key] ??= {})[c.code] = v;
    }
  }
  return { ...translationCoverage(project), stale };
}

/** How much of the story each language translates. */
export function translationCoverage(project: StoryProject): { languages: { code: string; translated: number }[]; total: number } {
  const keys = translationEntries(project, project.presentation?.unity).map((e) => e.key);
  const t = project.translations;
  return { total: keys.length, languages: (t?.languages ?? []).map((code) => ({ code, translated: keys.filter((k) => t!.strings[k]?.[code]).length })) };
}

/** A text in a language from the story's translations, or the text itself. */
export function translate(project: Pick<StoryProject, 'translations'>, language: string, text: string): string {
  if (!language || !text) return text;
  return project.translations?.strings[translationKey(text)]?.[language] ?? text;
}

/** Takes a language out of the story's translations. */
export function removeLanguage(project: StoryProject, code: string): void {
  const t = project.translations;
  if (!t) return;
  t.languages = t.languages.filter((l) => l !== code);
  for (const k of Object.keys(t.strings)) {
    delete t.strings[k][code];
    if (!Object.keys(t.strings[k]).length) delete t.strings[k];
  }
  if (!t.languages.length) delete project.translations;
}
