// The design variables the admin design editor lists, by group. Their values live in styles.css
// (:root, and the night-edition blocks for colours that differ by theme); the editor reads the
// current value from the page, so nothing here repeats them.

export type TokenKind = 'color' | 'length' | 'number' | 'time' | 'font' | 'shadow' | 'image' | 'text';

export interface Token {
  name: string;
  label: string;
  group: string;
  kind: TokenKind;
  /** Colours that differ between light pages and the night edition are edited per theme. */
  perTheme?: boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

const t = (group: string, kind: TokenKind, perTheme: boolean, list: [string, string, Partial<Token>?][]): Token[] =>
  list.map(([name, label, extra]) => ({ name, label, group, kind, perTheme, ...extra }));

export const TOKENS: Token[] = [
  ...t('Paper and ink', 'color', true, [
    ['--desk', 'Desk (behind the pages)'],
    ['--desk-2', 'Desk highlight'],
    ['--paper', 'Page'],
    ['--paper-2', 'Page, shaded (contents, panels)'],
    ['--paper-3', 'Page, darker (tabs)'],
    ['--paper-hi', 'Cards and inputs'],
    ['--paper-glow', 'Button hover'],
    ['--ink', 'Text'],
    ['--ink-2', 'Text, softer'],
    ['--faded', 'Faded text (hints, labels)'],
    ['--rule', 'Ruled lines'],
    ['--rule-2', 'Ruled lines, stronger (borders)'],
    ['--tab-edge', 'Tab edges'],
    ['--shadow', 'Shadow colour'],
  ]),
  ...t('Accents', 'color', true, [
    ['--rubric', 'Rubric (headings, ornaments)'],
    ['--pen', 'Pen (links, focus)'],
    ['--pen-bg', 'Pen wash (focus glow, drop zones)'],
    ['--mark', 'Highlighter (source lines)'],
    ['--copper', 'Copper'],
    ['--earth', 'Earth'],
    ['--olive', 'Olive'],
    ['--teal', 'Teal (effects, transformed)'],
    ['--review', 'Review (proposed changes)'],
  ]),
  ...t('Status', 'color', true, [
    ['--ok', 'Good'],
    ['--warn', 'Warning'],
    ['--err', 'Error'],
    ['--note-bg', 'Note background'],
    ['--error-bg', 'Error background'],
    ['--slip', 'Slips and sheets'],
  ]),
  ...t('Graph and code', 'color', true, [
    ['--node-selected', 'Selected passage'],
    ['--node-unreachable', 'Unreachable passage'],
    ['--line-num', 'Line numbers'],
    ['--tk-comment', 'Ink comments'],
    ['--tk-tag', 'Ink tags'],
    ['--edge-a', 'Page edge 1'],
    ['--edge-b', 'Page edge 2'],
    ['--edge-c', 'Page edge 3'],
  ]),
  ...t('Cover band (top bar)', 'color', false, [
    ['--cover-top', 'Band, top'],
    ['--cover-bottom', 'Band, bottom'],
    ['--cover-edge', 'Band edge'],
    ['--cover-gold', 'Gold (logo, current stage)'],
    ['--cover-text', 'Text'],
    ['--cover-soft', 'Text, softer'],
    ['--cover-dim', 'Text, dim (stages)'],
    ['--cover-good', 'Good'],
    ['--cover-bad', 'Problem'],
  ]),
  ...t('Type', 'font', false, [
    ['--serif', 'Body font', { hint: 'A CSS font list, e.g. Georgia, serif' }],
    ['--display', 'Display font (titles)'],
    ['--mono', 'Code font'],
  ]),
  ...t('Type', 'length', false, [
    ['--text-size', 'Text size', { min: 12, max: 24, step: 0.5 }],
    ['--heading-size', 'Heading size', { min: 12, max: 40, step: 0.5 }],
    ['--card-heading-size', 'Card heading size', { min: 11, max: 32, step: 0.5 }],
    ['--label-size', 'Small-caps label size', { min: 9, max: 20, step: 0.5 }],
    ['--hero-size', 'Title page heading', { min: 20, max: 96, step: 1 }],
    ['--title-size', 'Passage title', { min: 16, max: 64, step: 1 }],
  ]),
  ...t('Type', 'number', false, [['--line-height', 'Line height', { min: 1, max: 2.4, step: 0.05 }]]),
  ...t('Shape and space', 'length', false, [
    ['--radius', 'Button corners', { min: 0, max: 24, step: 1 }],
    ['--radius-card', 'Card corners', { min: 0, max: 24, step: 1 }],
    ['--radius-tab', 'Tab corners', { min: 0, max: 24, step: 1 }],
    ['--page-margin', 'Page margin (sides)', { min: 0, max: 80, step: 1 }],
    ['--page-pad-y', 'Page padding, top', { min: 0, max: 120, step: 1 }],
    ['--page-pad-x', 'Page padding, sides', { min: 0, max: 160, step: 1 }],
    ['--card-pad-y', 'Card padding, top', { min: 0, max: 64, step: 1 }],
    ['--card-pad-x', 'Card padding, sides', { min: 0, max: 64, step: 1 }],
    ['--contents-width', 'Contents column (Review)', { min: 160, max: 480, step: 2 }],
    ['--notes-width', 'Notes panel', { min: 220, max: 560, step: 2 }],
    ['--graph-grid', 'Graph dot spacing', { min: 8, max: 64, step: 1 }],
  ]),
  ...t('Motion and texture', 'time', false, [
    ['--page-turn-time', 'Page turn', { min: 0, max: 1.5, step: 0.05, hint: '0 turns it off' }],
    ['--ui-time', 'Tabs and hovers', { min: 0, max: 0.6, step: 0.01 }],
  ]),
  ...t('Motion and texture', 'shadow', false, [['--desk-shadow', 'Shadow under the pages', { hint: 'A CSS box-shadow, or none' }]]),
  ...t('Motion and texture', 'image', true, [
    ['--grain', 'Paper grain', { hint: 'A CSS image; none for smooth paper' }],
    ['--gilt', 'Gilt (title lettering)'],
  ]),
];

export const TOKEN_GROUPS = [...new Set(TOKENS.map((x) => x.group))];

export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: 'EB Garamond (built in)', value: "'EB Garamond', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  { label: 'IM Fell English SC (built in)', value: "'IM Fell English SC', 'EB Garamond', 'Palatino Linotype', Georgia, serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Palatino', value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: 'Iowan Old Style', value: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  { label: 'System sans-serif', value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { label: 'Helvetica / Arial', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Courier', value: "'Courier Prime', 'Courier New', Courier, monospace" },
  { label: 'System monospace', value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

/** Words in the app the design can change: key → [label, the built-in text]. */
export const WORDS: Record<string, [string, string]> = {
  brand: ['Name on the cover band', 'Narrative Bridge'],
  pageTitle: ['Browser tab title', 'Narrative Bridge'],
  edition: ['Edition line (title page)', 'The Workshop Edition'],
  heroTitle: ['Title (title page)', 'Narrative Bridge'],
  subtitle: ['Subtitle (title page)', 'Turn a script into a playable story'],
  lede: [
    'Introduction (title page)',
    'Import a screenplay or structured prose, review what was understood, then export a validated Ink story packaged for Unity or Unreal Engine. Everything runs locally in your browser — nothing is uploaded.',
  ],
};

export interface SettingDef {
  key: string;
  label: string;
  hint: string;
  type: 'boolean' | 'choice';
  choices?: string[];
  default: boolean | string;
}

/** Defaults for people who haven't chosen for themselves (their own choice always wins). */
export const SETTINGS: SettingDef[] = [
  { key: 'theme', label: 'Theme for new visitors', hint: 'auto follows their system setting.', type: 'choice', choices: ['auto', 'light', 'dark'], default: 'auto' },
  { key: 'showLocked', label: 'Show locked choices', hint: 'Playtest and Graph show choices that need an item or value.', type: 'boolean', default: true },
  { key: 'sound', label: 'Sound effects', hint: 'The quiet page and stamp sounds.', type: 'boolean', default: true },
];
