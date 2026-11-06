import { useEffect, useRef } from 'react';
import { effectToInk } from '../core/inkgen';
import type { ContentBlock, StoryProject } from '../core/isr';
import { addBreak, removeBreak, type Update } from './projectOps';

// The Graph chapter's passage panel: the selected passage's lines, with a place between each pair to
// add a Continue break (the reader clicks Continue before reading on) or to remove one.

function preview(b: ContentBlock, project: StoryProject): { kind: string; text: string; muted?: boolean } {
  const cut = (s: string) => (s.length > 160 ? `${s.slice(0, 159)}…` : s);
  switch (b.type) {
    case 'dialogue': {
      const who = project.characters.find((c) => c.id === b.speakerId)?.displayName ?? b.speakerId;
      return { kind: who.toUpperCase(), text: cut(`${b.parenthetical ? `(${b.parenthetical}) ` : ''}${b.text}`) };
    }
    case 'action':
      return { kind: 'narration', text: cut(b.text) };
    case 'transition':
      return { kind: 'transition', text: cut(b.text) };
    case 'note':
      return { kind: 'note', text: cut(b.text), muted: true };
    case 'effect':
      return { kind: 'effect', text: effectToInk(b.effect).replace(/^~\s*/, ''), muted: true };
    case 'unsupported':
      return { kind: 'kept as a note', text: cut(b.text), muted: true };
    case 'pause':
      return { kind: 'break', text: '' };
    case 'exit':
      return { kind: 'to the game', text: cut(`⇥ ${b.name}${b.note ? ` — ${b.note}` : ''}`), muted: true };
    case 'cue':
      return { kind: 'cue', text: cut(`♪ ${b.name}${b.value ? `: ${b.value}` : ''}`), muted: true };
  }
}

export function PassageInspector({
  project,
  passageId,
  update,
  onOpen,
  onClose,
}: {
  project: StoryProject;
  passageId: string;
  update: Update;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const passage = project.passages.find((p) => p.id === passageId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [passageId]);
  if (!passage) return null;
  const content = passage.content;
  // Lines are numbered as the writer sees them: breaks aren't lines.
  let line = 0;
  const numbers = content.map((b) => (b.type === 'pause' ? line : ++line));

  return (
    <aside className="map-inspector" aria-labelledby="inspector-title" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <div className="map-inspector-head">
        <h3 id="inspector-title" tabIndex={-1} ref={heading}>
          {passage.title}
        </h3>
        <button className="btn tiny ghost" aria-label="Close the passage panel" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted small">Add a Continue break where the reader should click Continue before reading on.</p>
      {content.length === 0 ? (
        <p className="muted small">This passage has no lines yet.</p>
      ) : (
        <ol className="inspector-lines">
          {content.map((b, i) => {
            const p = preview(b, project);
            const next = content[i + 1];
            return (
              <li key={i}>
                {b.type === 'pause' ? (
                  <div className="inspector-break">
                    <span className="pause-rule">
                      <span>Continue</span>
                    </span>
                    <button className="btn tiny ghost" aria-label={`Remove the Continue break after line ${numbers[i]}`} onClick={() => update((d) => removeBreak(d, passageId, i))}>
                      remove
                    </button>
                  </div>
                ) : (
                  <p className={`inspector-line${p.muted ? ' muted' : ''}`}>
                    <span className="inspector-kind">{p.kind}</span> {p.text}
                  </p>
                )}
                {b.type !== 'pause' && next && next.type !== 'pause' && (
                  <button className="inspector-gap" aria-label={`Add a Continue break after line ${numbers[i]}`} onClick={() => update((d) => addBreak(d, passageId, i + 1))}>
                    + Continue break
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted small">
        {passage.choices.length ? `Then ${passage.choices.length} choice${passage.choices.length === 1 ? '' : 's'}.` : passage.isEnding ? 'Then the story ends.' : 'Then the story continues on its own.'}
      </p>
      <button className="btn tiny" onClick={() => onOpen(passageId)}>
        Edit in Review
      </button>
    </aside>
  );
}
