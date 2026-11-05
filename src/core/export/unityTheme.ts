import type { UnityTheme } from '../isr';

// Unity story UI themes: the presets offered on the Export page, and how a theme is written for
// the generated NarrativeTheme (see unity.ts).

const BASE = {
  layout: 'bottom',
  panelOpacity: 0.96,
  fontSize: 30,
  charactersPerSecond: 45,
  showSpeakers: true,
  showSceneHeadings: true,
  showChoiceNumbers: true,
  showToolbar: true,
  showPictures: true,
  continueLabel: 'Continue',
  endLabel: 'The End',
} as const;

export const UNITY_THEME_PRESETS: Record<Exclude<UnityTheme['preset'], 'custom'>, UnityTheme> = {
  book: { ...BASE, preset: 'book', background: '#fefae0', text: '#283618', accent: '#bc6c25', muted: '#606c38' },
  night: { ...BASE, preset: 'night', background: '#1f2913', text: '#fefae0', accent: '#dda15e', muted: '#b9b48e' },
  minimal: { ...BASE, preset: 'minimal', background: '#000000', text: '#ffffff', accent: '#ffd166', muted: '#bbbbbb', panelOpacity: 0.72, charactersPerSecond: 0 },
};

export const DEFAULT_UNITY_THEME: UnityTheme = UNITY_THEME_PRESETS.book;

const HEX = /^#[0-9a-f]{6}$/i;
const LAYOUTS = ['bottom', 'center', 'left', 'right', 'full'];

/** A complete, valid theme from whatever was saved (older projects, hand-edited files). */
export function normaliseUnityTheme(t: Partial<UnityTheme> | undefined): UnityTheme {
  // Missing fields come from the theme's own preset, so { preset: 'night' } is the whole night theme.
  const d = (t?.preset && t.preset !== 'custom' && UNITY_THEME_PRESETS[t.preset]) || DEFAULT_UNITY_THEME;
  const colour = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : fallback);
  return {
    preset: t?.preset && ['book', 'night', 'minimal', 'custom'].includes(t.preset) ? t.preset : d.preset,
    background: colour(t?.background, d.background),
    text: colour(t?.text, d.text),
    accent: colour(t?.accent, d.accent),
    muted: colour(t?.muted, d.muted),
    panelOpacity: num(t?.panelOpacity, d.panelOpacity, 0.2, 1),
    layout: t?.layout && LAYOUTS.includes(t.layout) ? t.layout : d.layout,
    fontSize: Math.round(num(t?.fontSize, d.fontSize, 16, 56)),
    charactersPerSecond: Math.round(num(t?.charactersPerSecond, d.charactersPerSecond, 0, 200)),
    showSpeakers: bool(t?.showSpeakers, d.showSpeakers),
    showSceneHeadings: bool(t?.showSceneHeadings, d.showSceneHeadings),
    showChoiceNumbers: bool(t?.showChoiceNumbers, d.showChoiceNumbers),
    showToolbar: bool(t?.showToolbar, d.showToolbar),
    showPictures: bool(t?.showPictures, d.showPictures),
    continueLabel: text(t?.continueLabel, d.continueLabel),
    endLabel: text(t?.endLabel, d.endLabel),
  };
}

/** Where the story panel sits, as fractions of the screen (Unity anchors, origin bottom-left). */
export function panelRect(layout: UnityTheme['layout']): { xMin: number; yMin: number; xMax: number; yMax: number } {
  switch (layout) {
    case 'center':
      return { xMin: 0.2, yMin: 0.15, xMax: 0.8, yMax: 0.85 };
    case 'left':
      return { xMin: 0.03, yMin: 0.05, xMax: 0.43, yMax: 0.95 };
    case 'right':
      return { xMin: 0.57, yMin: 0.05, xMax: 0.97, yMax: 0.95 };
    case 'full':
      return { xMin: 0.04, yMin: 0.04, xMax: 0.96, yMax: 0.96 };
    default:
      return { xMin: 0.1, yMin: 0.03, xMax: 0.9, yMax: 0.45 };
  }
}

/** The JSON NarrativeTheme reads (Resources/NarrativeBridgeTheme.json): JsonUtility field names, plain values. */
export function unityThemeJson(t: UnityTheme): Record<string, unknown> {
  const r = panelRect(t.layout);
  return { ...t, panelXMin: r.xMin, panelYMin: r.yMin, panelXMax: r.xMax, panelYMax: r.yMax };
}
