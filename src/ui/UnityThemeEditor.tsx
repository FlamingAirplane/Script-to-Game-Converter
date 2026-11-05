import { useState, type CSSProperties } from 'react';
import { DEFAULT_UNITY_THEME, normaliseUnityTheme, panelRect, THEME_GROUPS, UNITY_THEME_FIELDS, UNITY_THEME_PRESETS, type ThemeField, type ThemeGroup } from '../core/export/unityTheme';
import type { StoryProject, UnityTheme } from '../core/isr';
import { usePicture } from './pictures';
import type { Update } from './projectOps';

// The Export page's "Story UI" card: how the generated Unity panel looks and behaves, with a preview
// drawn to scale. Its controls come from UNITY_THEME_FIELDS, so every setting the export knows about is
// here. The theme is saved with the project (presentation.unity), so it travels with the story file.

const PRESET_NAMES: Record<Exclude<UnityTheme['preset'], 'custom'>, string> = { book: 'Book', night: 'Night', minimal: 'Minimal' };
const COLOUR_KEYS = UNITY_THEME_FIELDS.filter((f) => f.kind === 'colour').map((f) => f.key);
const OPEN_AT_FIRST: ThemeGroup[] = ['Colours', 'Panel', 'Character portraits'];

const alpha = (hex: string, a: number) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

function shown(f: ThemeField, v: number): string {
  if (f.kind !== 'number') return '';
  switch (f.unit) {
    case '%':
      return `${Math.round(v * 100)}%`;
    case '×':
      return `${v.toFixed(2)}×`;
    case 's':
      return v ? `${v.toFixed(2)} s` : 'off';
    case 'px':
      return `${v} px`;
    default:
      return String(v);
  }
}

export function UnityThemeEditor({ project, update }: { project: StoryProject; update: Update }) {
  const saved = project.presentation?.unity;
  const theme = normaliseUnityTheme(saved);
  const [open, setOpen] = useState<Set<ThemeGroup>>(() => new Set(OPEN_AT_FIRST));
  const save = (next: UnityTheme, group?: string) => update((d) => void (d.presentation = { ...d.presentation, unity: next }), group);
  const set = (f: ThemeField, value: unknown) =>
    save(
      // A colour of your own makes the look Custom. (Text is kept as typed, so a label can be cleared and
      // retyped; the export fills in anything left empty.)
      { ...theme, ...(f.kind === 'colour' ? { preset: 'custom' as const } : {}), ...(f.kind === 'text' ? { ...saved } : {}), [f.key]: value } as UnityTheme,
      f.kind === 'number' || f.kind === 'text' || f.kind === 'colour' ? `unity-theme:${f.key}` : undefined,
    );
  // A look changes the colours and panel opacity only; every other choice stays.
  const pick = (preset: UnityTheme['preset']) => {
    if (preset === 'custom') return save({ ...theme, preset });
    const p = UNITY_THEME_PRESETS[preset];
    save({ ...theme, preset, panelOpacity: p.panelOpacity, ...Object.fromEntries(COLOUR_KEYS.map((k) => [k, p[k]])) });
  };
  const reset = () => {
    const p = theme.preset === 'custom' ? DEFAULT_UNITY_THEME : UNITY_THEME_PRESETS[theme.preset];
    if (confirm('Put every Story UI setting back to its default?')) save({ ...p });
  };
  const portraitCount = project.characters.filter((c) => c.portrait).length;

  return (
    <section className="card unity-theme">
      <div className="row wrap">
        <h2>Story UI</h2>
        <span className="spacer" />
        <button className="btn tiny ghost" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <p className="muted small">
        The panel your Unity game shows the story in: {UNITY_THEME_FIELDS.length} settings for how it looks and behaves. Your developer can change any of them later in Unity
        too, in the NarrativeTheme asset.
      </p>
      <div className="unity-theme-grid">
        <div className="unity-theme-controls">
          <fieldset className="field">
            <legend className="muted small">Look</legend>
            <div className="seg" role="group" aria-label="Look">
              {(Object.keys(PRESET_NAMES) as (keyof typeof PRESET_NAMES)[]).map((p) => (
                <button key={p} aria-pressed={theme.preset === p} className={`btn tiny${theme.preset === p ? ' ok' : ''}`} onClick={() => pick(p)}>
                  {PRESET_NAMES[p]}
                </button>
              ))}
              <button aria-pressed={theme.preset === 'custom'} className={`btn tiny${theme.preset === 'custom' ? ' ok' : ''}`} onClick={() => pick('custom')}>
                Custom
              </button>
            </div>
          </fieldset>
          {THEME_GROUPS.map((g) => {
            const fields = UNITY_THEME_FIELDS.filter((f) => f.group === g && (!f.when || f.when(theme)));
            return (
              <details
                key={g}
                className="theme-group"
                open={open.has(g)}
                onToggle={(e) => {
                  const isOpen = (e.target as HTMLDetailsElement).open;
                  setOpen((s) => {
                    const n = new Set(s);
                    if (isOpen) n.add(g);
                    else n.delete(g);
                    return n;
                  });
                }}
              >
                <summary>
                  {g}
                  {g === 'Character portraits' && <span className="muted small"> · {portraitCount ? `${portraitCount} character${portraitCount === 1 ? '' : 's'} with a portrait` : 'none added yet'}</span>}
                </summary>
                <div className={g === 'Colours' ? 'unity-colours' : 'theme-fields'}>
                  {fields.map((f) => (
                    <FieldControl key={f.key} field={f} theme={theme} raw={saved?.[f.key]} onChange={(v) => set(f, v)} />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
        <ThemePreview theme={theme} project={project} />
      </div>
    </section>
  );
}

function FieldControl({ field: f, theme, raw, onChange }: { field: ThemeField; theme: UnityTheme; raw: unknown; onChange: (v: unknown) => void }) {
  const v = theme[f.key] as never;
  switch (f.kind) {
    case 'colour':
      return (
        <label className="colour-field">
          <input type="color" value={v} onChange={(e) => onChange(e.target.value)} />
          <span className="small">{f.label}</span>
        </label>
      );
    case 'number':
      return (
        <label className="field">
          <span className="muted small">
            {f.label}: {shown(f, v)}
          </span>
          <input type="range" min={f.min} max={f.max} step={f.step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
          {f.hint && <span className="muted small">{f.hint}</span>}
        </label>
      );
    case 'bool':
      return (
        <label className="check" title={f.hint}>
          <input type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} />
          <span>
            {f.label}
            {f.hint && <span className="muted small"> · {f.hint}</span>}
          </span>
        </label>
      );
    case 'text':
      return (
        <label className="field">
          <span className="muted small">{f.label}</span>
          <input className="input" maxLength={f.max} value={typeof raw === 'string' ? raw : v} placeholder={String(DEFAULT_UNITY_THEME[f.key])} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case 'choice':
      return (
        <fieldset className="field">
          <legend className="muted small">{f.label}</legend>
          <div className="seg" role="group" aria-label={f.label}>
            {f.choices.map(([value, label]) => (
              <button key={value} aria-pressed={v === value} className={`btn tiny${v === value ? ' ok' : ''}`} onClick={() => onChange(value)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      );
  }
}

const SILHOUETTE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80"><circle cx="30" cy="24" r="14" fill="#c9b97f"/><path d="M4 80c0-18 12-30 26-30s26 12 26 30z" fill="#c9b97f"/></svg>')}`;

/** A picture of the game screen with the panel where Unity will put it, scaled from the reference resolution. */
function ThemePreview({ theme: t, project }: { theme: UnityTheme; project: StoryProject }) {
  const speaker = project.characters.find((c) => c.portrait) ?? project.characters[0];
  const portraitUrl = usePicture(speaker?.portrait);
  const sceneUrl = usePicture(project.passages.find((p) => p.image)?.image);
  const r = panelRect(t.layout, t);
  const u = (px: number) => `calc(${px} * 100cqw / ${t.referenceWidth})`;
  const name = (speaker?.displayName ?? 'Mara').trim() || 'Mara';
  const speakerName = t.speakerUppercase ? name.toUpperCase() : name;
  const portraitOn = t.showPortraits;
  const right = t.portraitSide === 'right';
  const inside = t.portraitPlacement === 'inside';
  const portraitSize: CSSProperties = { height: u(t.portraitHeight), transform: right && t.portraitMirrorRight ? 'scaleX(-1)' : undefined };
  const panel: CSSProperties = {
    left: `${r.xMin * 100}%`,
    right: `${(1 - r.xMax) * 100}%`,
    top: `${(1 - r.yMax) * 100}%`,
    bottom: `${r.yMin * 100}%`,
    background: alpha(t.background, t.panelOpacity),
    color: t.text,
    fontSize: u(t.fontSize),
    lineHeight: 1.25 * t.lineSpacing,
    paddingTop: u(t.padding),
    paddingBottom: u(t.padding),
    paddingLeft: u(t.padding),
    paddingRight: u(t.padding),
    textAlign: t.textAlign,
    outline: t.borderWidth ? `${u(t.borderWidth)} solid ${t.borderColour}` : undefined,
    gap: `${t.choiceSpacing + 0.25}em`,
  };
  if (portraitOn && inside) panel[right ? 'paddingRight' : 'paddingLeft'] = `calc(${u(t.padding)} * 1.75 + ${u(t.portraitHeight)} * 0.75)`;
  const button: CSSProperties = {
    background: alpha(t.buttonColour, t.buttonOpacity),
    color: t.choiceTextColour,
    fontSize: `${t.choiceScale}em`,
    minHeight: `${t.choiceHeight / t.choiceScale}em`,
    textAlign: t.choiceAlign,
    justifyContent: t.choiceAlign === 'center' ? 'center' : 'flex-start',
  };
  const paren = t.showParentheticals ? '(quietly)' : '';
  const line = { marginBottom: `${t.paragraphSpacing}em` };
  const heading = t.showSceneHeadings && t.transcript !== 'line' && (
    <p className="unity-scene" style={{ color: t.sceneColour, fontSize: `${t.sceneScale}em`, textAlign: 'center', ...line }}>
      {t.sceneUppercase ? 'INT. LIGHTHOUSE – NIGHT' : 'Int. Lighthouse – night'}
    </p>
  );
  const spoken =
    t.speakerStyle === 'inline' ? (
      <p style={line}>
        {(t.showSpeakers || paren) && (
          <b style={{ color: t.speakerColour }}>
            {t.showSpeakers ? speakerName : ''}
            {paren && (t.showSpeakers ? ' ' : '') + paren}:{' '}
          </b>
        )}
        Someone has been here.
      </p>
    ) : (
      <>
        {(t.showSpeakers || paren) && (
          <p style={{ color: t.speakerColour, fontSize: `${t.speakerScale}em`, fontWeight: 'bold', margin: 0 }}>
            {t.showSpeakers ? speakerName : ''}
            {paren && (t.showSpeakers ? '  ' : '') + paren}
          </p>
        )}
        <p style={line}>Someone has been here.</p>
      </>
    );
  return (
    <figure className="unity-preview" aria-label="Preview of the story panel">
      <div className="unity-screen" style={{ aspectRatio: `${t.referenceWidth} / ${t.referenceHeight}` }}>
        {t.showPictures && sceneUrl && <img className="unity-picture" src={sceneUrl} alt="" style={{ objectFit: t.pictureFit }} />}
        {t.showPictures && t.pictureDim > 0 && <div className="unity-shade" style={{ background: `rgba(0,0,0,${t.pictureDim})` }} />}
        {portraitOn && !inside && (
          <img
            className="unity-portrait"
            src={portraitUrl ?? SILHOUETTE}
            alt=""
            style={{ ...portraitSize, bottom: `${r.yMax * 100}%`, ...(right ? { right: `${(1 - r.xMax) * 100}%` } : { left: `${r.xMin * 100}%` }) }}
          />
        )}
        <div className="unity-panel" style={panel}>
          {portraitOn && inside && <img className="unity-portrait inside" src={portraitUrl ?? SILHOUETTE} alt="" style={{ ...portraitSize, bottom: u(t.padding), [right ? 'right' : 'left']: u(t.padding) }} />}
          <div className="unity-lines">
            {heading}
            {t.transcript !== 'line' && <p style={line}>The lamp turns slowly overhead.</p>}
            {spoken}
          </div>
          <div className="unity-choices" style={{ gap: `${t.choiceSpacing}em` }}>
            <span className="unity-btn" style={button}>
              {t.continueLabel}
              {t.continueArrow ? '  ›' : ''}
            </span>
            <span className="unity-btn" style={button}>
              {t.showChoiceNumbers ? '1.  ' : ''}Climb the stairs
            </span>
          </div>
          {t.showToolbar && (t.showRestart || t.showSave || t.showLoad || t.showStatus) && (
            <div className="unity-toolbar" style={{ color: t.choiceTextColour }}>
              {t.showRestart && <span style={{ background: alpha(t.buttonColour, Math.max(0.12, t.buttonOpacity)) }}>{t.restartLabel}</span>}
              {t.showSave && <span style={{ background: alpha(t.buttonColour, Math.max(0.12, t.buttonOpacity)) }}>{t.saveLabel}</span>}
              {t.showLoad && <span style={{ background: alpha(t.buttonColour, Math.max(0.12, t.buttonOpacity)) }}>{t.loadLabel}</span>}
              {t.showStatus && <em style={{ color: t.muted }}>Saved.</em>}
            </div>
          )}
        </div>
      </div>
      <figcaption className="muted small">
        A sketch, not a render: both buttons are shown together here; in the game the Continue button appears on its own at each break.
        {portraitOn && !portraitUrl && ' The figure stands in for a portrait: add one in Review → Story settings → Characters.'}
      </figcaption>
    </figure>
  );
}
