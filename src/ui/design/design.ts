import { useSyncExternalStore } from 'react';
import published from './published.json';
import { SETTINGS, TOKENS, WORDS } from './tokens';

// The design of the app itself: overrides of the design variables (shared, or per theme), of any
// CSS rule, extra CSS, some of the app's words, and defaults for new visitors.
//
// - The published design is the live one (a GitHub Gist the admin publishes to, read when the app
//   opens: no commit or rebuild, see live.ts), or else src/ui/design/published.json, built into the app.
// - The admin design editor (#admin) edits a draft, kept in that browser only, and shown there
//   live. Publishing is putting the draft's file in the repository (see the editor's Publish tab).

export const DESIGN_FORMAT = 'narrative-bridge-design';

export interface DesignDoc {
  format: typeof DESIGN_FORMAT;
  version: 1;
  name: string;
  /** Design variables that are the same in both themes. */
  tokens: Record<string, string>;
  /** Design variables for light pages and for the night edition. */
  light: Record<string, string>;
  dark: Record<string, string>;
  /** Overrides of the app's own CSS rules: rule key (see ruleKey) → property → value. */
  rules: Record<string, Record<string, string>>;
  css: string;
  words: Record<string, string>;
  settings: Record<string, boolean | string>;
}

export const DRAFT_KEY = 'narrative-bridge.design-draft';

export function emptyDesign(name = 'Narrative Bridge'): DesignDoc {
  return { format: DESIGN_FORMAT, version: 1, name, tokens: {}, light: {}, dark: {}, rules: {}, css: '', words: {}, settings: {} };
}

/** A CSS rule's key: its selector, after the @media condition it sits in (if any). */
export function ruleKey(selector: string, media = ''): string {
  return media ? `@media ${media}|${selector}` : selector;
}

export function splitRuleKey(key: string): { selector: string; media: string } {
  if (!key.startsWith('@media ')) return { selector: key, media: '' };
  const bar = key.indexOf('|');
  return { media: key.slice(7, bar), selector: key.slice(bar + 1) };
}

const CUSTOM_PROPERTY = /^--[\w-]+$/;
const PROPERTY = /^-?[a-z][a-z0-9-]*$|^--[\w-]+$/;

/** Values can't close the block they're in. */
function cleanValue(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[{}<]/g, '').trim();
  return s && s.length <= 4000 ? s : null;
}

function cleanMap(v: unknown, key: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const value = cleanValue(raw);
    if (key.test(k) && value != null) out[k] = value;
  }
  return out;
}

/** A complete, safe design from anything (a file, local storage, the published JSON). */
export function normaliseDesign(raw: unknown): DesignDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<DesignDoc>;
  const rules: DesignDoc['rules'] = {};
  if (d.rules && typeof d.rules === 'object')
    for (const [key, decls] of Object.entries(d.rules)) {
      if (/[{}]/.test(key) || !key.trim()) continue;
      const clean = cleanMap(decls, PROPERTY);
      if (Object.keys(clean).length) rules[key] = clean;
    }
  const words: Record<string, string> = {};
  if (d.words && typeof d.words === 'object')
    for (const [k, v] of Object.entries(d.words)) if (k in WORDS && typeof v === 'string') words[k] = v.slice(0, 400);
  const settings: DesignDoc['settings'] = {};
  if (d.settings && typeof d.settings === 'object')
    for (const s of SETTINGS) {
      const v = (d.settings as Record<string, unknown>)[s.key];
      if (s.type === 'boolean' && typeof v === 'boolean') settings[s.key] = v;
      if (s.type === 'choice' && typeof v === 'string' && s.choices!.includes(v)) settings[s.key] = v;
    }
  return {
    format: DESIGN_FORMAT,
    version: 1,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 80) : 'Narrative Bridge',
    tokens: cleanMap(d.tokens, CUSTOM_PROPERTY),
    light: cleanMap(d.light, CUSTOM_PROPERTY),
    dark: cleanMap(d.dark, CUSTOM_PROPERTY),
    rules,
    css: typeof d.css === 'string' ? d.css.slice(0, 200_000) : '',
    words,
    settings,
  };
}

export function isEmptyDesign(d: DesignDoc): boolean {
  return !Object.keys(d.tokens).length && !Object.keys(d.light).length && !Object.keys(d.dark).length && !Object.keys(d.rules).length && !d.css.trim() && !Object.keys(d.words).length && !Object.keys(d.settings).length;
}

export function sameDesign(a: DesignDoc, b: DesignDoc): boolean {
  return JSON.stringify({ ...a, name: '' }) === JSON.stringify({ ...b, name: '' });
}

/** How many things a design changes. */
export function designChanges(d: DesignDoc): number {
  return Object.keys(d.tokens).length + Object.keys(d.light).length + Object.keys(d.dark).length + Object.values(d.rules).reduce((n, r) => n + Object.keys(r).length, 0) + (d.css.trim() ? 1 : 0) + Object.keys(d.words).length + Object.keys(d.settings).length;
}

// Overrides must win over styles.css: three :root's outrank its `:root[data-theme='dark']` (0,2,0).
const R = ':root:root:root';
const decls = (m: Record<string, string>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

/** The CSS for a design, applied after the app's own. */
export function designCss(d: DesignDoc): string {
  const out: string[] = [];
  if (Object.keys(d.tokens).length) out.push(`${R} { ${decls(d.tokens)} }`);
  // Light pages: chosen, or following a light system setting. Night edition: chosen, or following a dark one.
  if (Object.keys(d.light).length) out.push(`${R}[data-theme='light'] { ${decls(d.light)} }`, `@media (prefers-color-scheme: light) { ${R}:not([data-theme='dark']) { ${decls(d.light)} } }`);
  if (Object.keys(d.dark).length) out.push(`${R}[data-theme='dark'] { ${decls(d.dark)} }`, `@media (prefers-color-scheme: dark) { ${R}:not([data-theme='light']) { ${decls(d.dark)} } }`);
  for (const [key, m] of Object.entries(d.rules)) {
    if (!Object.keys(m).length) continue;
    const { selector, media } = splitRuleKey(key);
    // The same selector, later in the page, wins over the app's rule. !important is kept where the app used it.
    const body = `${selector} { ${Object.entries(m)
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ')} }`;
    out.push(media ? `@media ${media} { ${body} }` : body);
  }
  if (d.css.trim()) out.push(d.css);
  return out.join('\n');
}

// ---- The design in effect -------------------------------------------------------------------

export const PUBLISHED: DesignDoc = normaliseDesign(published);

function readDraft(): DesignDoc | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? normaliseDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export const LIVE_KEY = 'narrative-bridge.design-live';

/** The live design last read from the Gist, kept so the next visit shows it at once. */
function readLive(): DesignDoc | null {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    return raw ? normaliseDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let draft: DesignDoc | null = readDraft();
let live: DesignDoc | null = readLive();
/** The admin can compare with what's published without losing the draft. */
let previewPublished = false;
const listeners = new Set<() => void>();
let snapshot = { design: effective(), draft, previewPublished, published: live ?? PUBLISHED };

function effective(): DesignDoc {
  return !previewPublished && draft ? draft : (live ?? PUBLISHED);
}

/** The live design, read from the Gist (or null to fall back to the built-in one). Remembered for the next visit. */
export function setLiveDesign(d: DesignDoc | null) {
  live = d ? normaliseDesign(d) : null;
  try {
    if (live) localStorage.setItem(LIVE_KEY, JSON.stringify(live));
    else localStorage.removeItem(LIVE_KEY);
  } catch {
    /* this visit only */
  }
  changed();
}

function changed() {
  snapshot = { design: effective(), draft, previewPublished, published: live ?? PUBLISHED };
  applyDesign(snapshot.design);
  for (const l of listeners) l();
}

export function subscribeDesign(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function designState() {
  return snapshot;
}

export function useDesign() {
  return useSyncExternalStore(subscribeDesign, designState);
}

/** Sets (or, with null, discards) this browser's draft. */
export function setDraft(d: DesignDoc | null) {
  draft = d ? normaliseDesign(d) : null;
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: the draft lasts for this visit */
  }
  changed();
}

export function setPreviewPublished(on: boolean) {
  previewPublished = on;
  changed();
}

const STYLE_ID = 'nb-design';

/** Puts the design's CSS on the page, after the app's own styles. */
export function applyDesign(d: DesignDoc) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
  }
  // Last in <head>, so it follows every stylesheet, including ones loaded later.
  if (el !== document.head.lastElementChild) document.head.appendChild(el);
  const css = designCss(d);
  if (el.textContent !== css) el.textContent = css;
  const title = d.words.pageTitle;
  document.title = title?.trim() ? title : WORDS.pageTitle[1];
}

/** The design's text for one of the app's words (see WORDS). */
export function designWord(d: DesignDoc, key: keyof typeof WORDS): string {
  const v = d.words[key];
  return v != null && v.trim() ? v : WORDS[key][1];
}

export function useWord(key: keyof typeof WORDS): string {
  return designWord(useDesign().design, key);
}

/** A default for people who haven't chosen for themselves. */
export function designSetting<T extends boolean | string>(key: string): T {
  const v = effective().settings[key];
  return (v ?? SETTINGS.find((s) => s.key === key)?.default) as T;
}

/** Every design variable's name, for checking a design file. */
export const TOKEN_NAMES = new Set(TOKENS.map((t) => t.name));
