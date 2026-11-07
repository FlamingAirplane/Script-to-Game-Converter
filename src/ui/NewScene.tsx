import { useMemo, useState } from 'react';
import type { StoryProject } from '../core/isr';
import { addScene, goesStraightOn, type SceneLink, type Update } from './projectOps';

// The Graph chapter's "New scene" form: a scene added to a story already converted from a script, joined to it
// after a passage (the story goes on into it), as a new choice in a passage, or on its own to connect later.

export function NewSceneSheet({
  project,
  update,
  from: initialFrom,
  link: initialLink,
  at,
  onCreated,
  onClose,
}: {
  project: StoryProject;
  update: Update;
  /** The passage it comes after, when it was started from one. */
  from?: string;
  link?: SceneLink;
  /** Where on the map it goes (when started by double-clicking the map). */
  at?: { x: number; y: number };
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [heading, setHeading] = useState('');
  const [firstLine, setFirstLine] = useState('');
  const [from, setFrom] = useState(initialFrom ?? '');
  const fromPassage = project.passages.find((p) => p.id === from);
  const straight = !fromPassage || goesStraightOn(fromPassage);
  const [link, setLink] = useState<SceneLink>(initialLink ?? (initialFrom ? 'continue' : 'none'));
  const effectiveLink: SceneLink = link === 'continue' && !straight ? 'choice' : link;
  const [choiceText, setChoiceText] = useState('');
  const [keepPathText, setKeepPathText] = useState('');
  const [then, setThen] = useState<string>('');
  const [error, setError] = useState('');
  const title_ = (id: string) => (id === 'END' ? 'the end' : (project.passages.find((p) => p.id === id)?.title ?? id));

  // Where `from` goes now, when it goes straight on.
  const fromNext = fromPassage && straight ? (fromPassage.divert ?? (fromPassage.isEnding ? 'END' : undefined)) : undefined;
  const keepsPath = effectiveLink === 'choice' && !!fromPassage && straight && !!fromPassage.divert && fromPassage.divert !== 'END';
  const defaultThen = effectiveLink === 'continue' ? (fromNext ?? 'END') : 'END';
  const thenValue = then || defaultThen;
  const others = useMemo(() => project.passages.map((p) => ({ id: p.id, title: p.title })), [project.passages]);

  const create = () => {
    const scene = {
      title,
      heading,
      firstLine,
      from: effectiveLink === 'none' ? undefined : from,
      link: effectiveLink,
      choiceText,
      keepPathText,
      then: thenValue,
      at,
    };
    // Tried on a copy first: a problem changes nothing and is shown here. (Adding is deterministic, so the id is the same.)
    const r = addScene(structuredClone(project), scene);
    if (typeof r === 'string') return setError(r);
    update((d) => void addScene(d, scene));
    onCreated(r.id);
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet card new-scene"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-scene-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="row">
          <h2 id="new-scene-title">New scene</h2>
          <span className="spacer" />
          <button type="button" className="btn small ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <label className="field">
          <span className="muted small">Title</span>
          <input className="input" value={title} autoFocus placeholder="e.g. The Boathouse" onChange={(e) => (setTitle(e.target.value), setError(''))} />
        </label>
        <label className="field">
          <span className="muted small">Scene heading (optional)</span>
          <input className="input mono" value={heading} placeholder="e.g. EXT. BOATHOUSE - NIGHT" onChange={(e) => setHeading(e.target.value)} />
        </label>
        <label className="field">
          <span className="muted small">First line (optional: you can write the rest in Review)</span>
          <textarea className="input" rows={2} value={firstLine} placeholder="e.g. Rain hammers the tin roof." onChange={(e) => setFirstLine(e.target.value)} />
        </label>

        <fieldset className="modes new-scene-link">
          <legend className="muted small">Where it goes in the story</legend>
          {initialFrom === undefined && (
            <label className="field">
              <span className="muted small">After</span>
              <select className="input" value={from} onChange={(e) => (setFrom(e.target.value), setError(''), link === 'none' && e.target.value && setLink('continue'))}>
                <option value="">(choose a passage)</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={`mode ${effectiveLink === 'continue' ? 'selected' : ''}`}>
            <input type="radio" name="scene-link" checked={effectiveLink === 'continue'} disabled={!fromPassage || !straight} onChange={() => setLink('continue')} />
            <span>
              <strong>{fromPassage ? `Straight after “${fromPassage.title}”` : 'Straight after a passage'}</strong>
              <span className="muted small">
                {fromPassage && !straight
                  ? 'That passage ends with choices, so add it as a new choice.'
                  : fromNext && fromNext !== 'END'
                    ? `The story goes on into it, then on to “${title_(fromNext)}” as before.`
                    : 'The story goes on into it.'}
              </span>
            </span>
          </label>
          <label className={`mode ${effectiveLink === 'choice' ? 'selected' : ''}`}>
            <input type="radio" name="scene-link" checked={effectiveLink === 'choice'} disabled={!fromPassage} onChange={() => setLink('choice')} />
            <span>
              <strong>{fromPassage ? `As a new choice in “${fromPassage.title}”` : 'As a new choice'}</strong>
              <span className="muted small">The reader can pick it, as well as the ways the story already goes.</span>
            </span>
          </label>
          <label className={`mode ${effectiveLink === 'none' ? 'selected' : ''}`}>
            <input type="radio" name="scene-link" checked={effectiveLink === 'none'} onChange={() => setLink('none')} />
            <span>
              <strong>On its own for now</strong>
              <span className="muted small">Nothing leads to it yet; connect it later with a choice in Review.</span>
            </span>
          </label>
        </fieldset>

        {effectiveLink === 'choice' && (
          <label className="field">
            <span className="muted small">The choice’s wording</span>
            <input className="input" value={choiceText} placeholder={title.trim() || 'e.g. Go down to the boathouse'} onChange={(e) => setChoiceText(e.target.value)} />
          </label>
        )}
        {keepsPath && (
          <label className="field">
            <span className="muted small">“{fromPassage!.title}” went straight on to “{title_(fromPassage!.divert!)}”. That way becomes a choice too, worded:</span>
            <input className="input" value={keepPathText} placeholder={`Go on to ${title_(fromPassage!.divert!)}`} onChange={(e) => setKeepPathText(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="muted small">Afterwards</span>
          <select className="input" value={thenValue} onChange={(e) => setThen(e.target.value)}>
            <option value="END">the story ends</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                it goes on to “{p.title}”
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error-text small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Add the scene
          </button>
        </div>
      </form>
    </div>
  );
}
