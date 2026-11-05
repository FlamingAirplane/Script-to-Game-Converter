import type { CSSProperties } from 'react';
import { DEFAULT_UNITY_THEME, normaliseUnityTheme, panelRect, UNITY_THEME_PRESETS } from '../core/export/unityTheme';
import type { StoryProject, UnityTheme } from '../core/isr';
import type { Update } from './projectOps';

// The Export page's "Story UI" card: how the generated Unity panel looks, with a preview drawn to scale.
// The theme is saved with the project (presentation.unity), so it travels with the story file.

const PRESET_NAMES: Record<Exclude<UnityTheme['preset'], 'custom'>, string> = { book: 'Book', night: 'Night', minimal: 'Minimal' };
const LAYOUTS: { id: UnityTheme['layout']; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'center', label: 'Centre' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'full', label: 'Full screen' },
];
const COLOURS: { key: 'background' | 'text' | 'accent' | 'muted'; label: string }[] = [
  { key: 'background', label: 'Panel' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Buttons' },
  { key: 'muted', label: 'Speakers & notes' },
];
const TOGGLES: { key: 'showSpeakers' | 'showSceneHeadings' | 'showChoiceNumbers' | 'showToolbar' | 'showPictures'; label: string }[] = [
  { key: 'showSpeakers', label: 'Speaker names' },
  { key: 'showSceneHeadings', label: 'Scene headings' },
  { key: 'showChoiceNumbers', label: 'Number the choices (1–9 keys)' },
  { key: 'showToolbar', label: 'Restart, Save and Load buttons' },
  { key: 'showPictures', label: 'Scene pictures, full screen behind the panel' },
];

const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

export function UnityThemeEditor({ project, update }: { project: StoryProject; update: Update }) {
  const saved = project.presentation?.unity;
  const theme = normaliseUnityTheme(saved);
  const set = (patch: Partial<UnityTheme>, group = 'unity-theme') =>
    update((d) => {
      // Changing anything but the preset makes the theme your own. (Kept as typed, so a label can be
      // cleared and retyped; the export fills in anything left empty.)
      d.presentation = { ...d.presentation, unity: { ...theme, preset: 'custom', ...patch } };
    }, group);
  const pick = (preset: UnityTheme['preset']) =>
    update((d) => {
      d.presentation = { ...d.presentation, unity: preset === 'custom' ? { ...theme, preset } : { ...UNITY_THEME_PRESETS[preset], layout: theme.layout, continueLabel: theme.continueLabel, endLabel: theme.endLabel } };
    });

  return (
    <section className="card unity-theme">
      <h2>Story UI</h2>
      <p className="muted small">The panel your Unity scene shows the story in. You can change all of it later in Unity too: select NarrativeTheme in Assets/NarrativeBridge/Settings.</p>
      <div className="unity-theme-grid">
        <div className="unity-theme-controls">
          <fieldset className="field">
            <legend className="muted small">Look</legend>
            <div className="seg" role="group" aria-label="Look">
              {(Object.keys(PRESET_NAMES) as (keyof typeof PRESET_NAMES)[]).map((p) => (
                <button key={p} aria-pressed={theme.preset === p} className={`btn tiny${theme.preset === p ? " ok" : ""}`} onClick={() => pick(p)}>
                  {PRESET_NAMES[p]}
                </button>
              ))}
              <button aria-pressed={theme.preset === 'custom'} className={`btn tiny${theme.preset === 'custom' ? " ok" : ""}`} onClick={() => pick('custom')}>
                Custom
              </button>
            </div>
          </fieldset>
          <fieldset className="field">
            <legend className="muted small">Where it sits</legend>
            <div className="seg" role="group" aria-label="Where it sits">
              {LAYOUTS.map((l) => (
                <button key={l.id} aria-pressed={theme.layout === l.id} className={`btn tiny${theme.layout === l.id ? " ok" : ""}`} onClick={() => update((d) => void (d.presentation = { ...d.presentation, unity: { ...theme, layout: l.id } }))}>
                  {l.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="unity-colours">
            {COLOURS.map((c) => (
              <label key={c.key} className="colour-field">
                <input type="color" value={theme[c.key]} onChange={(e) => set({ [c.key]: e.target.value })} />
                <span className="small">{c.label}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="muted small">Panel opacity: {Math.round(theme.panelOpacity * 100)}%</span>
            <input type="range" min={20} max={100} value={Math.round(theme.panelOpacity * 100)} onChange={(e) => set({ panelOpacity: Number(e.target.value) / 100 })} />
          </label>
          <label className="field">
            <span className="muted small">Text size: {theme.fontSize}</span>
            <input type="range" min={16} max={56} value={theme.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span className="muted small">Typewriter: {theme.charactersPerSecond ? `${theme.charactersPerSecond} letters a second` : 'off, lines appear at once'}</span>
            <input type="range" min={0} max={200} step={5} value={theme.charactersPerSecond} onChange={(e) => set({ charactersPerSecond: Number(e.target.value) })} />
          </label>
          {TOGGLES.map((t) => (
            <label key={t.key} className="check">
              <input type="checkbox" checked={theme[t.key]} onChange={(e) => set({ [t.key]: e.target.checked }, undefined)} />
              {t.label}
            </label>
          ))}
          <div className="unity-labels">
            <label className="field">
              <span className="muted small">Continue button</span>
              <input className="input" maxLength={40} value={saved?.continueLabel ?? theme.continueLabel} placeholder={DEFAULT_UNITY_THEME.continueLabel} onChange={(e) => set({ continueLabel: e.target.value })} />
            </label>
            <label className="field">
              <span className="muted small">At the ending</span>
              <input className="input" maxLength={40} value={saved?.endLabel ?? theme.endLabel} placeholder={DEFAULT_UNITY_THEME.endLabel} onChange={(e) => set({ endLabel: e.target.value })} />
            </label>
          </div>
        </div>
        <ThemePreview theme={theme} />
      </div>
    </section>
  );
}

/** A 16:9 picture of the game screen with the panel where Unity will put it. */
function ThemePreview({ theme }: { theme: UnityTheme }) {
  const r = panelRect(theme.layout);
  // Unity's canvas is 1920 wide; the preview scales its sizes the same way.
  const scale = 'calc(100cqw / 1920)';
  const panel: CSSProperties = {
    left: `${r.xMin * 100}%`,
    right: `${(1 - r.xMax) * 100}%`,
    top: `${(1 - r.yMax) * 100}%`,
    bottom: `${r.yMin * 100}%`,
    background: alpha(theme.background, theme.panelOpacity),
    color: theme.text,
    fontSize: `calc(${theme.fontSize} * ${scale})`,
  };
  const button: CSSProperties = { background: theme.accent, color: theme.background };
  return (
    <figure className="unity-preview" aria-label="Preview of the story panel">
      <div className="unity-screen">
        <div className="unity-panel" style={panel}>
          <div className="unity-lines">
            {theme.showSceneHeadings && <p className="unity-scene" style={{ color: theme.muted }}>INT. LIGHTHOUSE – NIGHT</p>}
            <p>The lamp turns slowly overhead.</p>
            <p>
              {theme.showSpeakers && <span style={{ color: theme.muted }}>MARA: </span>}
              Someone has been here.
            </p>
          </div>
          <div className="unity-choices">
            <span className="unity-btn" style={button}>
              {theme.continueLabel}
            </span>
            <span className="unity-btn" style={{ ...button, opacity: 0.85 }}>
              {theme.showChoiceNumbers ? '1. ' : ''}Climb the stairs
            </span>
          </div>
          {theme.showToolbar && (
            <div className="unity-toolbar" style={{ color: theme.muted }}>
              <span>Restart</span>
              <span>Save</span>
              <span>Load</span>
            </div>
          )}
        </div>
      </div>
      <figcaption className="muted small">A sketch, not a render: both buttons are shown together here; in the game the Continue button appears on its own at each break.</figcaption>
    </figure>
  );
}
