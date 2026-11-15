import { useEffect, useRef, useState } from 'react';
import { cueName, type ContentBlock, type Passage, type StoryProject } from '../../core/isr';
import { ProvenanceBadge } from '../common';
import { CueSound, VoiceClip } from '../VoiceControls';
import type { AudioRef } from '../../core/audio';
import { type ChoiceDestination, choiceTextFor } from '../projectOps';
import { EffectEditor } from './ChoiceEditor';

/** Cues the game is likely to know, with what their value means (see NarrativeCuePlayer in the Unity package). */
const CUE_SUGGESTIONS: [string, string][] = [
  ['music', 'Which track (e.g. calm); empty stops the music'],
  ['sound', 'Which sound (e.g. door_creak)'],
  ['ambience', 'Which background sound (e.g. rain); empty stops it'],
  ['shake', 'How strong, 0–1 (e.g. 0.5)'],
  ['stop_music', 'Nothing needed'],
  ['stop_ambience', 'Nothing needed'],
];

export function BlockRow({
  block,
  project,
  onChange,
  onDelete,
  onMove,
  onFocusLine,
  onCueSound,
  onToChoice,
}: {
  block: ContentBlock;
  project: StoryProject;
  onChange: (b: ContentBlock) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onFocusLine: (line: number) => void;
  /** Attaches a sound to every cue with this tag (or takes it away). */
  onCueSound: (tag: string, audio: AudioRef | undefined) => void;
  /** Opens the form that turns this line into a choice (only for lines of narration or dialogue). */
  onToChoice?: () => void;
}) {
  const touched = (b: ContentBlock): ContentBlock => ({ ...b, origin: b.origin === 'generated' ? 'generated' : 'user_authored' }) as ContentBlock;
  return (
    <div className={`block block-${block.type}`}>
      <div className="block-gutter">
        <span className="block-type">{block.type === 'pause' ? 'break' : block.type === 'exit' ? 'to game' : block.type}</span>
        {block.source && (
          <button className="link mono small" onClick={() => onFocusLine(block.source!.line)} title="Show in source">
            L{block.source.line}
          </button>
        )}
      </div>
      <div className="block-body">
        {block.type === 'dialogue' && (
          <div className="row">
            <select className="input small speaker" value={block.speakerId} onChange={(e) => onChange(touched({ ...block, speakerId: e.target.value }))}>
              {project.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
            <select
              className="input small voice-ext"
              value={block.extension ?? ''}
              aria-label="How the voice is heard"
              title="How the voice is heard: on screen, voice-over (V.O.), off screen (O.S.) or off camera (O.C.)"
              onChange={(e) => onChange(touched({ ...block, extension: e.target.value || undefined }))}
            >
              <option value="">on screen</option>
              <option value="V.O.">V.O.</option>
              <option value="O.S.">O.S.</option>
              <option value="O.C.">O.C.</option>
            </select>
            <input
              className="input small paren"
              placeholder="(parenthetical)"
              value={block.parenthetical ?? ''}
              onChange={(e) => onChange(touched({ ...block, parenthetical: e.target.value || undefined }))}
            />
            <VoiceClip block={block} voice={project.characters.find((c) => c.id === block.speakerId)?.voice} onChange={(audio) => onChange({ ...block, audio })} />
          </div>
        )}
        {'text' in block && block.type !== 'unsupported' && (
          <AutoText value={block.text} onChange={(text) => onChange(touched({ ...block, text } as ContentBlock))} serif={block.type !== 'note'} label={`${block.type === 'dialogue' ? 'Dialogue' : block.type === 'note' ? 'Note' : block.type === 'transition' ? 'Transition' : 'Narration'} text`} />
        )}
        {block.type === 'pause' && (
          <p className="pause-rule">
            <span>Continue</span> the reader clicks Continue here before reading on
          </p>
        )}
        {block.type === 'exit' && (
          <div className="exit-block">
            <p className="pause-rule exit-rule">
              <span>⇥ Back to the game</span> the dialogue stops; the game plays until it resumes the story
            </p>
            <div className="row wrap">
              <label className="field exit-name">
                <span className="muted small">Exit name (the game sees this)</span>
                <input className="input small mono" value={block.name} onChange={(e) => onChange(touched({ ...block, name: e.target.value.replace(/[^A-Za-z0-9_]+/g, '_').toLowerCase() }))} aria-label="Exit name" />
              </label>
              <label className="field exit-note">
                <span className="muted small">What happens in the game (a note for the developer)</span>
                <input className="input small" value={block.note ?? ''} placeholder="e.g. The player fights the wolves" onChange={(e) => onChange(touched({ ...block, note: e.target.value || undefined }))} aria-label="What happens in the game" />
              </label>
            </div>
          </div>
        )}
        {block.type === 'cue' && (
          <div className="exit-block">
            <p className="pause-rule exit-rule">
              <span>♪ Cue</span> the game reacts here (music, a sound, a shake); readers don’t see it
            </p>
            <div className="row wrap">
              <label className="field exit-name">
                <span className="muted small">Cue</span>
                <input
                  className="input small mono"
                  list="cue-names"
                  value={block.name}
                  onChange={(e) => onChange(touched({ ...block, name: e.target.value.replace(/[^A-Za-z0-9_]+/g, '_').toLowerCase() }))}
                  onBlur={() => onChange({ ...block, name: cueName(block.name) })}
                  aria-label="Cue name"
                />
                <datalist id="cue-names">
                  {CUE_SUGGESTIONS.map(([n]) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
              <label className="field exit-note">
                <span className="muted small">{CUE_SUGGESTIONS.find(([n]) => n === block.name)?.[1] ?? 'Value (optional), e.g. which track or how strong'}</span>
                <input className="input small" value={block.value ?? ''} placeholder="e.g. calm" onChange={(e) => onChange(touched({ ...block, value: e.target.value || undefined }))} aria-label="Cue value" />
              </label>
            </div>
            <CueSound block={block} project={project} onSet={onCueSound} />
          </div>
        )}
        {block.type === 'unsupported' && (
          <div>
            <p className="muted small">Kept as an Ink comment — {block.reason}.</p>
            <pre className="mono small">{block.text}</pre>
          </div>
        )}
        {block.type === 'effect' && (
          <div className="row wrap">
            <EffectEditor effect={block.effect} project={project} onChange={(effect) => onChange({ ...block, effect })} />
            {block.review === 'pending' && (
              <>
                <button className="btn tiny ok" onClick={() => onChange({ ...block, review: 'approved' })}>
                  Approve
                </button>
                <button className="btn tiny" onClick={() => onChange({ ...block, review: 'rejected' })}>
                  Reject
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="block-actions">
        <ProvenanceBadge origin={block.origin} />
        {onToChoice && (
          <button className="icon" title="Turn this line into a choice the player clicks" aria-label="Turn this line into a choice" onClick={onToChoice}>
            ⑂
          </button>
        )}
        <button className="icon" title="Move up" onClick={() => onMove(-1)}>
          ↑
        </button>
        <button className="icon" title="Move down" onClick={() => onMove(1)}>
          ↓
        </button>
        <button className="icon" title="Delete" onClick={onDelete}>
          ×
        </button>
      </div>
    </div>
  );
}

/** The guided way to branch: turn a line into a choice, then say where it leads. */
export function LineToChoice({
  passage,
  project,
  index,
  text,
  onCancel,
  onMake,
}: {
  passage: Passage;
  project: StoryProject;
  index: number;
  text: string;
  onCancel: () => void;
  /** Makes the choice; returns an error to show, or null. */
  onMake: (text: string, to: ChoiceDestination) => string | null;
}) {
  const after = passage.content.length - index - 1;
  const [label, setLabel] = useState(() => choiceTextFor(text));
  const [dest, setDest] = useState(after > 0 ? '__rest' : '__new');
  const [error, setError] = useState('');
  const to: ChoiceDestination = dest === '__rest' ? { kind: 'rest' } : dest === '__new' ? { kind: 'new' } : { kind: 'existing', target: dest };
  return (
    <form
      className="line-to-choice"
      onSubmit={(e) => {
        e.preventDefault();
        setError(onMake(label, to) ?? '');
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      aria-label="Turn this line into a choice"
    >
      <p className="small">
        <strong>⑂ Turn this line into a choice.</strong> <span className="muted">The line leaves the text and becomes a button the player clicks.</span>
      </p>
      <label className="field">
        <span className="muted small">What the button says</span>
        <input className="input" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} aria-label="Choice text" />
      </label>
      <label className="field">
        <span className="muted small">Where it leads</span>
        <select className="input small" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Where the choice leads">
          {after > 0 && (
            <option value="__rest">
              A new scene with the {after} line{after === 1 ? '' : 's'} after this one
            </option>
          )}
          <option value="__new">A new, empty scene</option>
          {project.passages
            .filter((p) => p.id !== passage.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          <option value="END">The end of the story</option>
        </select>
      </label>
      {dest === '__rest' && (
        <p className="muted small">This passage will stop at the choice. What follows{passage.choices.length ? ', and its choices,' : ''} moves into the new scene.</p>
      )}
      {dest !== '__rest' && after > 0 && <p className="muted small">The lines after this one stay here; the player reads them before choosing.</p>}
      {error && <p className="error-text small">{error}</p>}
      <div className="row">
        <button type="submit" className="btn tiny ok">
          Make the choice
        </button>
        <button type="button" className="btn tiny" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AutoText({ value, onChange, serif, label }: { value: string; onChange: (v: string) => void; serif?: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [value]);
  // Re-measure when the column width changes (panels opening/closing, window resize).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      // Resize on the next frame so changing the height doesn't re-trigger this observer in the same frame.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  return <textarea ref={ref} rows={1} aria-label={label} className={`autotext ${serif ? 'serif' : 'mono small'}`} value={value} onChange={(e) => onChange(e.target.value)} />;
}
