import type { UnityTheme } from '../isr';

// Unity story UI themes. UNITY_THEME_FIELDS describes every setting once (label, group, range,
// default): it checks saved themes, and the Export page's Story UI card draws its controls from it.
// The generated NarrativeTheme (C#, unityUi.ts) has a field for each, read from Theme.json.

type Key = Exclude<keyof UnityTheme, 'preset'>;
interface FieldBase {
  key: Key;
  label: string;
  group: ThemeGroup;
  hint?: string;
  /** Shown only when this holds (e.g. portrait options only with portraits on). */
  when?: (t: UnityTheme) => boolean;
}
export type ThemeField = FieldBase &
  (
    | { kind: 'colour' }
    | { kind: 'number'; min: number; max: number; step: number; unit?: '%' | 'px' | 's' | '×' | ''; integer?: boolean }
    | { kind: 'bool' }
    | { kind: 'text'; max: number }
    | { kind: 'choice'; choices: [string, string][] }
  );

export const THEME_GROUPS = ['Colours', 'Panel', 'Text', 'Speakers and scenes', 'Typing and pacing', 'Choices and buttons', 'Toolbar', 'Scene pictures', 'Character portraits', 'Screen and sound'] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];

const custom = (t: UnityTheme) => t.layout === 'custom';
const portraits = (t: UnityTheme) => t.showPortraits;
const toolbar = (t: UnityTheme) => t.showToolbar;

export const UNITY_THEME_FIELDS: ThemeField[] = [
  { key: 'background', label: 'Panel', group: 'Colours', kind: 'colour' },
  { key: 'text', label: 'Story text', group: 'Colours', kind: 'colour' },
  { key: 'speakerColour', label: 'Speaker names', group: 'Colours', kind: 'colour' },
  { key: 'sceneColour', label: 'Scene headings', group: 'Colours', kind: 'colour' },
  { key: 'muted', label: 'Notes (directions, choices made, status)', group: 'Colours', kind: 'colour' },
  { key: 'accent', label: 'Ending and highlights', group: 'Colours', kind: 'colour' },
  { key: 'buttonColour', label: 'Buttons', group: 'Colours', kind: 'colour' },
  { key: 'choiceTextColour', label: 'Button text', group: 'Colours', kind: 'colour' },
  { key: 'borderColour', label: 'Panel border', group: 'Colours', kind: 'colour' },

  { key: 'layout', label: 'Where it sits', group: 'Panel', kind: 'choice', choices: [['bottom', 'Bottom'], ['center', 'Centre'], ['left', 'Left'], ['right', 'Right'], ['full', 'Full screen'], ['custom', 'Custom']] },
  { key: 'panelXMin', label: 'Left edge', group: 'Panel', kind: 'number', min: 0, max: 0.95, step: 0.01, unit: '%', when: custom },
  { key: 'panelXMax', label: 'Right edge', group: 'Panel', kind: 'number', min: 0.05, max: 1, step: 0.01, unit: '%', when: custom },
  { key: 'panelYMin', label: 'Bottom edge', group: 'Panel', kind: 'number', min: 0, max: 0.95, step: 0.01, unit: '%', when: custom },
  { key: 'panelYMax', label: 'Top edge', group: 'Panel', kind: 'number', min: 0.05, max: 1, step: 0.01, unit: '%', when: custom },
  { key: 'panelOpacity', label: 'Panel opacity', group: 'Panel', kind: 'number', min: 0, max: 1, step: 0.01, unit: '%' },
  { key: 'padding', label: 'Padding', group: 'Panel', kind: 'number', min: 0, max: 120, step: 2, unit: 'px', integer: true },
  { key: 'borderWidth', label: 'Border', group: 'Panel', kind: 'number', min: 0, max: 12, step: 1, unit: 'px', integer: true, hint: '0 for none' },

  { key: 'fontSize', label: 'Text size', group: 'Text', kind: 'number', min: 12, max: 72, step: 1, unit: 'px', integer: true },
  { key: 'lineSpacing', label: 'Line spacing', group: 'Text', kind: 'number', min: 0.7, max: 2.5, step: 0.05, unit: '×' },
  { key: 'paragraphSpacing', label: 'Space between lines', group: 'Text', kind: 'number', min: 0, max: 2, step: 0.05, unit: '×' },
  { key: 'textAlign', label: 'Alignment', group: 'Text', kind: 'choice', choices: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
  { key: 'transcript', label: 'What stays on screen', group: 'Text', kind: 'choice', choices: [['history', 'Everything (scrolls)'], ['scene', 'The current scene'], ['line', 'Only the latest line']] },
  { key: 'showChoiceHistory', label: 'Show the choices the player made', group: 'Text', kind: 'bool' },

  { key: 'showSpeakers', label: 'Speaker names', group: 'Speakers and scenes', kind: 'bool' },
  { key: 'speakerStyle', label: 'Name placement', group: 'Speakers and scenes', kind: 'choice', choices: [['above', 'Above the line'], ['inline', 'Before the line (NAME: …)']], when: (t) => t.showSpeakers },
  { key: 'speakerScale', label: 'Name size', group: 'Speakers and scenes', kind: 'number', min: 0.4, max: 1.6, step: 0.05, unit: '×', when: (t) => t.showSpeakers && t.speakerStyle === 'above' },
  { key: 'speakerUppercase', label: 'Names in capitals', group: 'Speakers and scenes', kind: 'bool', when: (t) => t.showSpeakers },
  { key: 'showParentheticals', label: 'Stage directions, e.g. (quietly)', group: 'Speakers and scenes', kind: 'bool' },
  { key: 'showSceneHeadings', label: 'Scene headings', group: 'Speakers and scenes', kind: 'bool' },
  { key: 'sceneScale', label: 'Heading size', group: 'Speakers and scenes', kind: 'number', min: 0.4, max: 2, step: 0.05, unit: '×', when: (t) => t.showSceneHeadings },
  { key: 'sceneUppercase', label: 'Headings in capitals', group: 'Speakers and scenes', kind: 'bool', when: (t) => t.showSceneHeadings },

  { key: 'charactersPerSecond', label: 'Typewriter', group: 'Typing and pacing', kind: 'number', min: 0, max: 200, step: 5, unit: '', integer: true, hint: 'Letters a second; 0 shows each line at once' },
  { key: 'punctuationPause', label: 'Pause after a sentence', group: 'Typing and pacing', kind: 'number', min: 0, max: 1.5, step: 0.05, unit: 's', when: (t) => t.charactersPerSecond > 0 },
  { key: 'clickToSkip', label: 'Click or press to finish the line', group: 'Typing and pacing', kind: 'bool', when: (t) => t.charactersPerSecond > 0 },
  { key: 'lineFade', label: 'Lines fade in', group: 'Typing and pacing', kind: 'number', min: 0, max: 2, step: 0.05, unit: 's', hint: '0 for no fade' },
  { key: 'autoAdvance', label: 'Go on past Continue breaks by itself', group: 'Typing and pacing', kind: 'bool' },
  { key: 'autoAdvanceDelay', label: 'After', group: 'Typing and pacing', kind: 'number', min: 0.2, max: 15, step: 0.1, unit: 's', when: (t) => t.autoAdvance },

  { key: 'showChoiceNumbers', label: 'Number the choices (1–9 keys)', group: 'Choices and buttons', kind: 'bool' },
  { key: 'choiceAlign', label: 'Button text', group: 'Choices and buttons', kind: 'choice', choices: [['left', 'Left'], ['center', 'Centred']] },
  { key: 'choiceScale', label: 'Button text size', group: 'Choices and buttons', kind: 'number', min: 0.5, max: 1.6, step: 0.05, unit: '×' },
  { key: 'choiceHeight', label: 'Button height', group: 'Choices and buttons', kind: 'number', min: 1, max: 4, step: 0.1, unit: '×' },
  { key: 'choiceSpacing', label: 'Space between buttons', group: 'Choices and buttons', kind: 'number', min: 0, max: 1.5, step: 0.05, unit: '×' },
  { key: 'buttonOpacity', label: 'Button fill', group: 'Choices and buttons', kind: 'number', min: 0, max: 1, step: 0.01, unit: '%' },
  { key: 'buttonHoverOpacity', label: 'Button fill when pointed at', group: 'Choices and buttons', kind: 'number', min: 0, max: 1, step: 0.01, unit: '%' },
  { key: 'continueLabel', label: 'Continue button', group: 'Choices and buttons', kind: 'text', max: 40 },
  { key: 'continueArrow', label: 'Arrow on the Continue button ›', group: 'Choices and buttons', kind: 'bool' },
  { key: 'endLabel', label: 'At the ending', group: 'Choices and buttons', kind: 'text', max: 40 },

  { key: 'showToolbar', label: 'Toolbar under the story', group: 'Toolbar', kind: 'bool' },
  { key: 'showRestart', label: 'Restart button', group: 'Toolbar', kind: 'bool', when: toolbar },
  { key: 'restartLabel', label: 'Its label', group: 'Toolbar', kind: 'text', max: 24, when: (t) => t.showToolbar && t.showRestart },
  { key: 'showSave', label: 'Save button', group: 'Toolbar', kind: 'bool', when: toolbar },
  { key: 'saveLabel', label: 'Its label', group: 'Toolbar', kind: 'text', max: 24, when: (t) => t.showToolbar && t.showSave },
  { key: 'showLoad', label: 'Load button', group: 'Toolbar', kind: 'bool', when: toolbar },
  { key: 'loadLabel', label: 'Its label', group: 'Toolbar', kind: 'text', max: 24, when: (t) => t.showToolbar && t.showLoad },
  { key: 'showStatus', label: 'Status messages (Saved., Loaded.)', group: 'Toolbar', kind: 'bool', when: toolbar },

  { key: 'showPictures', label: 'Scene pictures, full screen behind the panel', group: 'Scene pictures', kind: 'bool' },
  { key: 'pictureFit', label: 'Fit', group: 'Scene pictures', kind: 'choice', choices: [['cover', 'Fill the screen'], ['contain', 'Show all of it']], when: (t) => t.showPictures },
  { key: 'pictureDim', label: 'Darken', group: 'Scene pictures', kind: 'number', min: 0, max: 0.9, step: 0.01, unit: '%', when: (t) => t.showPictures },
  { key: 'pictureFade', label: 'Fade in', group: 'Scene pictures', kind: 'number', min: 0, max: 3, step: 0.05, unit: 's', when: (t) => t.showPictures },

  { key: 'showPortraits', label: 'Show the speaking character’s portrait', group: 'Character portraits', kind: 'bool', hint: 'Add portraits in Review → Story settings → Characters.' },
  { key: 'portraitPlacement', label: 'Placement', group: 'Character portraits', kind: 'choice', choices: [['above', 'Standing on the panel'], ['inside', 'In the panel, beside the text']], when: portraits },
  { key: 'portraitSide', label: 'Side', group: 'Character portraits', kind: 'choice', choices: [['left', 'Left'], ['right', 'Right'], ['alternate', 'Take turns']], when: portraits },
  { key: 'portraitHeight', label: 'Height', group: 'Character portraits', kind: 'number', min: 80, max: 1000, step: 10, unit: 'px', integer: true, when: portraits },
  { key: 'portraitMirrorRight', label: 'Mirror portraits on the right (to face inwards)', group: 'Character portraits', kind: 'bool', when: portraits },
  { key: 'portraitFade', label: 'Fade in', group: 'Character portraits', kind: 'number', min: 0, max: 2, step: 0.05, unit: 's', when: portraits },
  { key: 'keepPortraitForNarration', label: 'Keep the last portrait during narration', group: 'Character portraits', kind: 'bool', when: portraits },

  { key: 'referenceWidth', label: 'Designed for width', group: 'Screen and sound', kind: 'number', min: 640, max: 3840, step: 10, unit: 'px', integer: true },
  { key: 'referenceHeight', label: 'Designed for height', group: 'Screen and sound', kind: 'number', min: 360, max: 2160, step: 10, unit: 'px', integer: true },
  { key: 'matchWidthOrHeight', label: 'Scale with', group: 'Screen and sound', kind: 'number', min: 0, max: 1, step: 0.05, unit: '', hint: '0 follows the screen’s width, 1 its height' },
  { key: 'voiceVolume', label: 'Voice clip volume', group: 'Screen and sound', kind: 'number', min: 0, max: 1, step: 0.01, unit: '%' },
];

const BASE: Omit<UnityTheme, 'preset' | 'background' | 'text' | 'accent' | 'muted' | 'speakerColour' | 'sceneColour' | 'buttonColour' | 'choiceTextColour' | 'borderColour'> = {
  layout: 'bottom',
  panelXMin: 0.1,
  panelYMin: 0.03,
  panelXMax: 0.9,
  panelYMax: 0.45,
  panelOpacity: 0.96,
  padding: 32,
  borderWidth: 0,
  fontSize: 30,
  lineSpacing: 1,
  paragraphSpacing: 0.45,
  textAlign: 'left',
  transcript: 'history',
  showChoiceHistory: true,
  showSpeakers: true,
  speakerStyle: 'above',
  speakerScale: 0.7,
  speakerUppercase: true,
  showParentheticals: true,
  showSceneHeadings: true,
  sceneScale: 0.65,
  sceneUppercase: true,
  charactersPerSecond: 45,
  punctuationPause: 0,
  lineFade: 0,
  clickToSkip: true,
  autoAdvance: false,
  autoAdvanceDelay: 2,
  showChoiceNumbers: true,
  choiceAlign: 'left',
  choiceScale: 0.9,
  choiceHeight: 1.9,
  choiceSpacing: 0.25,
  buttonOpacity: 0.14,
  buttonHoverOpacity: 0.3,
  continueLabel: 'Continue',
  continueArrow: true,
  endLabel: 'The End',
  showToolbar: true,
  showRestart: true,
  showSave: true,
  showLoad: true,
  showStatus: true,
  restartLabel: 'Restart',
  saveLabel: 'Save',
  loadLabel: 'Load',
  showPictures: true,
  pictureFit: 'cover',
  pictureDim: 0,
  pictureFade: 0.3,
  showPortraits: true,
  portraitPlacement: 'above',
  portraitSide: 'left',
  portraitHeight: 380,
  portraitMirrorRight: false,
  portraitFade: 0.2,
  keepPortraitForNarration: false,
  referenceWidth: 1920,
  referenceHeight: 1080,
  matchWidthOrHeight: 0.5,
  voiceVolume: 1,
};

/** A preset's colours; speaker names, headings, buttons and the border follow from them. */
function look(preset: UnityTheme['preset'], c: { background: string; text: string; accent: string; muted: string }, extra: Partial<UnityTheme> = {}): UnityTheme {
  return { ...BASE, preset, ...c, speakerColour: c.accent, sceneColour: c.muted, buttonColour: c.accent, choiceTextColour: c.text, borderColour: c.accent, ...extra };
}

export const UNITY_THEME_PRESETS: Record<Exclude<UnityTheme['preset'], 'custom'>, UnityTheme> = {
  book: look('book', { background: '#fefae0', text: '#283618', accent: '#bc6c25', muted: '#606c38' }),
  night: look('night', { background: '#1f2913', text: '#fefae0', accent: '#dda15e', muted: '#b9b48e' }),
  minimal: look('minimal', { background: '#000000', text: '#ffffff', accent: '#ffd166', muted: '#bbbbbb' }, { panelOpacity: 0.72, charactersPerSecond: 0 }),
};

export const DEFAULT_UNITY_THEME: UnityTheme = UNITY_THEME_PRESETS.book;

const HEX = /^#[0-9a-f]{6}$/i;

/** A complete, valid theme from whatever was saved (older projects, hand-edited files). */
export function normaliseUnityTheme(t: Partial<UnityTheme> | undefined): UnityTheme {
  // Missing fields come from the theme's own preset, so { preset: 'night' } is the whole night theme.
  const d = (t?.preset && t.preset !== 'custom' && UNITY_THEME_PRESETS[t.preset]) || DEFAULT_UNITY_THEME;
  const raw = (t ?? {}) as Record<string, unknown>;
  const out = { ...d, preset: t?.preset && ['book', 'night', 'minimal', 'custom'].includes(t.preset) ? t.preset : d.preset } as UnityTheme;
  const o = out as unknown as Record<string, unknown>;
  // Themes saved before the colours were split: speaker names were the accent colour, headings muted.
  const legacy: Partial<Record<Key, string>> = { speakerColour: 'accent', sceneColour: 'muted', buttonColour: 'accent', choiceTextColour: 'text', borderColour: 'accent' };
  for (const f of UNITY_THEME_FIELDS) {
    const v = raw[f.key];
    const fallback = d[f.key] as never;
    switch (f.kind) {
      case 'colour': {
        const from = v === undefined && legacy[f.key] ? raw[legacy[f.key]!] : v;
        o[f.key] = typeof from === 'string' && HEX.test(from) ? from.toLowerCase() : fallback;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, v)) : fallback;
        o[f.key] = f.integer ? Math.round(n) : n;
        break;
      }
      case 'bool':
        o[f.key] = typeof v === 'boolean' ? v : fallback;
        break;
      case 'text':
        o[f.key] = typeof v === 'string' && v.trim() ? v.trim().slice(0, f.max) : fallback;
        break;
      case 'choice':
        o[f.key] = typeof v === 'string' && f.choices.some(([c]) => c === v) ? v : fallback;
        break;
    }
  }
  // A preset layout decides the panel's corners; a custom one keeps them, the right way round.
  if (out.layout !== 'custom') Object.assign(out, panelFields(out.layout));
  else {
    if (out.panelXMax - out.panelXMin < 0.05) out.panelXMax = Math.min(1, out.panelXMin + 0.05);
    if (out.panelYMax - out.panelYMin < 0.05) out.panelYMax = Math.min(1, out.panelYMin + 0.05);
  }
  return out;
}

/** Where the story panel sits, as fractions of the screen (Unity anchors, origin bottom-left). */
export function panelRect(layout: UnityTheme['layout'], t?: Pick<UnityTheme, 'panelXMin' | 'panelYMin' | 'panelXMax' | 'panelYMax'>): { xMin: number; yMin: number; xMax: number; yMax: number } {
  switch (layout) {
    case 'center':
      return { xMin: 0.2, yMin: 0.15, xMax: 0.8, yMax: 0.85 };
    case 'left':
      return { xMin: 0.03, yMin: 0.05, xMax: 0.43, yMax: 0.95 };
    case 'right':
      return { xMin: 0.57, yMin: 0.05, xMax: 0.97, yMax: 0.95 };
    case 'full':
      return { xMin: 0.04, yMin: 0.04, xMax: 0.96, yMax: 0.96 };
    case 'custom':
      return t ? { xMin: t.panelXMin, yMin: t.panelYMin, xMax: t.panelXMax, yMax: t.panelYMax } : { xMin: 0.1, yMin: 0.03, xMax: 0.9, yMax: 0.45 };
    default:
      return { xMin: 0.1, yMin: 0.03, xMax: 0.9, yMax: 0.45 };
  }
}

function panelFields(layout: UnityTheme['layout']) {
  const r = panelRect(layout);
  return { panelXMin: r.xMin, panelYMin: r.yMin, panelXMax: r.xMax, panelYMax: r.yMax };
}

/** The JSON NarrativeTheme reads (Resources/…/Theme.json): JsonUtility field names, plain values. */
export function unityThemeJson(t: UnityTheme): Record<string, unknown> {
  return { ...t };
}
