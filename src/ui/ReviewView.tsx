import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewAll } from '../core/adapt';
import { conditionToInk, effectToInk } from '../core/inkgen';
import { cueName, uniqueId, type Choice, type CompareOp, type Condition, type ContentBlock, type Effect, type Passage, type StoryProject } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { Badge, ProvenanceBadge, SeverityIcon } from './common';
import { friendly } from './friendly';
import { CueSound, VoiceClip, VoicePicker } from './VoiceControls';
import { setCueSound } from '../core/cues';
import type { AudioRef } from '../core/audio';
import { ScenePicture } from './ScenePicture';
import { CharacterPortrait } from './CharacterPortrait';
import { StoryFiles } from './StoryFiles';
import { RecordingsImport } from './RecordingsImport';
import { formatMinutes, storyStats } from '../core/stats';
import { DraftShelf } from './Drafts';
import { type Update, addChoice, addPassage, deletePassage, findText, mergeCharacter, movePassage, renamePassage, replaceText } from './projectOps';

/** Cues the game is likely to know, with what their value means (see NarrativeCuePlayer in the Unity package). */
const CUE_SUGGESTIONS: [string, string][] = [
  ['music', 'Which track (e.g. calm); empty stops the music'],
  ['sound', 'Which sound (e.g. door_creak)'],
  ['ambience', 'Which background sound (e.g. rain); empty stops it'],
  ['shake', 'How strong, 0–1 (e.g. 0.5)'],
  ['stop_music', 'Nothing needed'],
  ['stop_ambience', 'Nothing needed'],
];


export const STORY_SETTINGS = '__story__';

export function ReviewView({
  processed,
  selected,
  onSelect,
  update,
  dialogueOnly,
  onDialogueOnly,
  onKeepDraft,
  onRestoreDraft,
}: {
  processed: ProcessedStory;
  selected: string;
  onSelect: (id: string) => void;
  update: Update;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
  onKeepDraft: (label: string) => Promise<void>;
  onRestoreDraft: (id: number) => void;
}) {
  const project = processed.project;
  const [filter, setFilter] = useState('');
  const [showSource, setShowSource] = useState(true);
  const [focusLine, setFocusLine] = useState<number | undefined>();
  // On a phone the contents list is a drawer, so the editor starts at the top of the screen.
  const [contentsOpen, setContentsOpen] = useState(false);
  const select = (id: string) => {
    setContentsOpen(false);
    onSelect(id);
  };
  const passage = project.passages.find((p) => p.id === selected);
  const pendingTotal = project.passages.reduce((n, p) => n + p.choices.filter((c) => c.review === 'pending').length, 0);

  const issuesByPassage = useMemo(() => {
    const m = new Map<string, { error: number; warning: number }>();
    for (const d of processed.diagnostics) {
      const pid = (d.details?.passageId as string) ?? (project.passages.some((p) => p.id === d.entityId) ? d.entityId : project.passages.find((p) => p.choices.some((c) => c.id === d.entityId))?.id);
      if (!pid) continue;
      const e = m.get(pid) ?? { error: 0, warning: 0 };
      if (d.severity === 'error') e.error++;
      if (d.severity === 'warning') e.warning++;
      m.set(pid, e);
    }
    return m;
  }, [processed.diagnostics, project.passages]);

  const visible = project.passages.filter((p) => !filter || `${p.title} ${p.id}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={`view review-view ${showSource && passage?.source ? 'with-source' : ''}`}>
      {contentsOpen && <div className="contents-backdrop" onClick={() => setContentsOpen(false)} aria-hidden />}
      <aside className={`passage-list ${contentsOpen ? 'open' : ''}`} id="contents-drawer" onKeyDown={(e) => e.key === 'Escape' && setContentsOpen(false)}>
        <button className="btn tiny contents-close" onClick={() => setContentsOpen(false)}>
          ✕ Close contents
        </button>
        <button className={`story-entry ${selected === STORY_SETTINGS ? 'active' : ''}`} onClick={() => select(STORY_SETTINGS)}>
          <strong>Story settings</strong>
          <span className="muted small">
            {project.characters.length} characters · {project.items.length} items · {project.variables.length} variables
          </span>
        </button>
        {pendingTotal > 0 && (
          <div className="pending-bar">
            <span>
              <strong>{pendingTotal}</strong> proposed choice{pendingTotal > 1 ? 's' : ''} need review
            </span>
            <div className="row">
              <button className="btn tiny ok" onClick={() => update((d) => reviewAll(d, 'approved'))}>
                Approve all
              </button>
              <button className="btn tiny" onClick={() => update((d) => reviewAll(d, 'rejected'))}>
                Reject all
              </button>
            </div>
          </div>
        )}
        <input className="input small" placeholder="Filter passages…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter passages" />
        <FindReplace project={project} update={update} onSelect={onSelect} />
        <h3 className="contents-head">Contents</h3>
        <ol className="passages">
          {visible.map((p) => {
            const issues = issuesByPassage.get(p.id);
            const pending = p.choices.filter((c) => c.review === 'pending').length;
            const node = processed.analysis.graph.nodes.find((n) => n.id === p.id);
            return (
              <li key={p.id}>
                <button className={`passage-item ${selected === p.id ? 'active' : ''}`} aria-current={selected === p.id ? 'true' : undefined} onClick={() => select(p.id)}>
                  <span className="toc-line">
                    <span className="passage-title">{p.title}</span>
                    <span className="toc-num">{project.passages.indexOf(p) + 1}</span>
                  </span>
                  <span className="passage-meta">
                    <span className="mono muted small">{p.id}</span>
                    {project.project.startPassage === p.id && (
                      <Badge tone="accent" title="The story starts here">
                        start
                      </Badge>
                    )}
                    {node?.isEnding && (
                      <Badge tone="ok" title="The story can end here">
                        ending
                      </Badge>
                    )}
                    {node && !node.reachable && (
                      <Badge tone="warning" title="No choice or path leads here from the start yet">
                        unreachable
                      </Badge>
                    )}
                    {pending > 0 && (
                      <Badge tone="review" title="Suggested choices here are waiting for you to approve or reject them">
                        {pending} to review
                      </Badge>
                    )}
                    {issues?.error ? <Badge tone="error">{issues.error} error</Badge> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button
          className="btn small"
          onClick={() => {
            let id = '';
            update((d) => (id = addPassage(d, passage?.id).id));
            setTimeout(() => select(id));
          }}
        >
          + Add passage
        </button>
      </aside>

      <main className="passage-editor">
        <button className="btn small contents-open" aria-expanded={contentsOpen} aria-controls="contents-drawer" onClick={() => setContentsOpen(true)}>
          ☰ Contents · {selected === STORY_SETTINGS ? 'Story settings' : passage ? `${project.passages.indexOf(passage) + 1} of ${project.passages.length}: ${passage.title}` : `${project.passages.length} passages`}
        </button>
        <details className="review-key small">
          <summary>What do the labels mean?</summary>
          <dl>
            <dt>source</dt>
            <dd>Taken word for word from your script.</dd>
            <dt>transformed</dt>
            <dd>From your script, reshaped to fit a game (a scene became a passage, a line became a choice).</dd>
            <dt>generated</dt>
            <dd>Suggested by Narrative Bridge; not in your script.</dd>
            <dt>edited</dt>
            <dd>You added or changed it here.</dd>
            <dt>pending</dt>
            <dd>A suggestion waiting for your OK. It’s left out of Playtest and the export until you approve it.</dd>
            <dt>condition (if …)</dt>
            <dd>The choice only appears when this is true, e.g. the player has the key.</dd>
            <dt>effect</dt>
            <dd>What happens when the choice is picked, e.g. the player gets or loses an item.</dd>
            <dt>once only</dt>
            <dd>The choice disappears after it has been picked once.</dd>
          </dl>
        </details>
        {selected === STORY_SETTINGS ? (
          <StorySettings project={project} update={update} onKeepDraft={onKeepDraft} onRestoreDraft={onRestoreDraft} />
        ) : passage ? (
          <PassageEditor
            key={passage.id}
            passage={passage}
            processed={processed}
            update={update}
            onSelect={onSelect}
            onFocusLine={(l) => {
              setFocusLine(l);
              setShowSource(true);
            }}
            showSource={showSource}
            toggleSource={() => setShowSource(!showSource)}
            dialogueOnly={dialogueOnly}
            onDialogueOnly={onDialogueOnly}
          />
        ) : (
          <p className="muted">Select a passage.</p>
        )}
      </main>

      {showSource && passage?.source && <SourcePane project={project} passage={passage} focusLine={focusLine} />}
    </div>
  );
}

function SourcePane({ project, passage, focusLine }: { project: StoryProject; passage: Passage; focusLine?: number }) {
  const doc = project.sources.find((s) => s.id === passage.source?.documentId);
  const ref = useRef<HTMLDivElement>(null);
  const start = passage.source?.line ?? 0;
  const next = project.passages
    .filter((p) => p.source?.documentId === doc?.id && (p.source?.line ?? 0) > start)
    .map((p) => p.source!.line)
    .sort((a, b) => a - b)[0];
  const end = next ? next - 1 : Infinity;
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-line="${focusLine ?? start}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [start, focusLine]);
  if (!doc) return null;
  return (
    <aside className="source-pane">
      <div className="pane-head">
        <span className="mono small">{doc.fileName}</span>
        <span className="muted small">original, read-only</span>
      </div>
      <div className="source-lines mono" ref={ref}>
        {doc.text.split('\n').map((l, i) => {
          const n = i + 1;
          const inRange = n >= start && n <= end;
          return (
            <div key={i} data-line={n} className={`src-line ${inRange ? 'in' : ''} ${n === focusLine ? 'focus' : ''}`}>
              <span className="ln">{n}</span>
              <span className="lt">{l || ' '}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PassageEditor({
  passage,
  processed,
  update,
  onSelect,
  onFocusLine,
  showSource,
  toggleSource,
  dialogueOnly,
  onDialogueOnly,
}: {
  passage: Passage;
  processed: ProcessedStory;
  update: Update;
  onSelect: (id: string) => void;
  onFocusLine: (line: number) => void;
  showSource: boolean;
  toggleSource: () => void;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
}) {
  const project = processed.project;
  const [idDraft, setIdDraft] = useState(passage.id);
  const [idError, setIdError] = useState('');
  const pid = passage.id;
  const edit = (fn: (p: Passage, d: StoryProject) => void, group?: string) =>
    update((d) => {
      const p = d.passages.find((x) => x.id === pid);
      if (p) fn(p, d);
    }, group);
  const diags = processed.diagnostics.filter(
    (d) => d.entityId === pid || d.details?.passageId === pid || passage.choices.some((c) => c.id === d.entityId),
  );
  const isStart = project.project.startPassage === pid;
  const activeChoices = passage.choices.filter((c) => c.review === 'approved');

  return (
    <div className="editor">
      <header className="editor-head">
        <input className="title-input" value={passage.title} onChange={(e) => edit((p) => ((p.title = e.target.value), (p.origin = p.origin === 'source' ? 'user_authored' : p.origin)), `title:${pid}`)} aria-label="Passage title" />
        <div className="row wrap">
          <label className="id-field">
            <span className="muted small">id</span>
            <input
              className={`input mono small ${idError ? 'invalid' : ''}`}
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
              onBlur={() => {
                if (idDraft === pid) return setIdError('');
                let err: string | null = null;
                update((d) => {
                  err = renamePassage(d, pid, idDraft);
                });
                if (err) setIdError(err);
                else onSelect(idDraft);
              }}
            />
          </label>
          <ProvenanceBadge origin={passage.origin} />
          {passage.sceneHeading && <span className="mono muted small">{passage.sceneHeading}</span>}
          <span className="spacer" />
          <button className={`btn tiny ${dialogueOnly ? 'ok' : ''}`} aria-pressed={dialogueOnly} title="Show only dialogue (D)" onClick={() => onDialogueOnly(!dialogueOnly)}>
            {dialogueOnly ? 'dialogue only' : 'all content'}
          </button>
          {passage.source && (
            <button className="btn tiny" onClick={toggleSource}>
              {showSource ? 'Hide source' : 'Show source'}
            </button>
          )}
          <button className="icon" title="Move up in the contents" aria-label="Move passage up" disabled={project.passages[0]?.id === pid} onClick={() => update((d) => movePassage(d, pid, -1))}>
            ↑
          </button>
          <button className="icon" title="Move down in the contents" aria-label="Move passage down" disabled={project.passages[project.passages.length - 1]?.id === pid} onClick={() => update((d) => movePassage(d, pid, 1))}>
            ↓
          </button>
          <button className="btn tiny" disabled={isStart} onClick={() => update((d) => (d.project.startPassage = pid))}>
            {isStart ? 'Start passage' : 'Make start'}
          </button>
          <button
            className="btn tiny danger"
            onClick={() => {
              if (!confirm(`Delete passage "${passage.title}"? Choices that point here will be flagged.`)) return;
              update((d) => deletePassage(d, pid));
              onSelect(project.passages.find((p) => p.id !== pid)?.id ?? STORY_SETTINGS);
            }}
          >
            Delete
          </button>
        </div>
        {idError && <p className="error-text small">{idError}</p>}
      </header>

      {diags.length > 0 && (
        <ul className="inline-diags">
          {diags.map((d, i) => (
            <li key={i}>
              <SeverityIcon severity={d.severity} /> {friendly(d).title}
              {friendly(d).detail && <span className="muted small"> — {d.message}</span>}
            </li>
          ))}
        </ul>
      )}

      <ScenePicture passage={passage} update={update} />

      <section className="blocks">
        <h3>Content</h3>
        {passage.content.length === 0 && <p className="muted small">No narrative content.</p>}
        {dialogueOnly && passage.content.some((b) => b.type !== 'dialogue' && b.type !== 'pause') && (
          <p className="muted small dialogue-only-note">
            Showing dialogue only — {passage.content.filter((b) => b.type !== 'dialogue' && b.type !== 'pause').length} other block(s) hidden.{' '}
            <button className="link small" onClick={() => onDialogueOnly(false)}>
              Show everything
            </button>
          </p>
        )}
        {passage.content.map((b, i) => (dialogueOnly && b.type !== 'dialogue' && b.type !== 'pause' ? null : (
          <BlockRow
            key={i}
            block={b}
            project={project}
            onFocusLine={onFocusLine}
            onCueSound={(tag, audio) => update((d) => setCueSound(d, tag, audio))}
            onChange={(nb) => edit((p) => (p.content[i] = nb), `block:${pid}:${i}`)}
            onDelete={() => edit((p) => p.content.splice(i, 1))}
            onMove={(dir) =>
              edit((p) => {
                const j = i + dir;
                if (j < 0 || j >= p.content.length) return;
                [p.content[i], p.content[j]] = [p.content[j], p.content[i]];
              })
            }
          />
        )))}
        <div className="row">
          <button className="btn tiny" onClick={() => edit((p) => p.content.push({ type: 'action', text: 'New line of narration.', origin: 'user_authored' }))}>
            + Narration
          </button>
          <button
            className="btn tiny"
            onClick={() =>
              update((d) => {
                if (!d.characters.length) d.characters.push({ id: 'narrator', displayName: 'NARRATOR', aliases: [] });
                d.passages.find((x) => x.id === pid)!.content.push({ type: 'dialogue', speakerId: d.characters[0].id, text: '…', origin: 'user_authored' });
              })
            }
          >
            + Dialogue
          </button>
          <button
            className="btn tiny"
            disabled={!project.items.length && !project.variables.length}
            title={!project.items.length && !project.variables.length ? 'Declare an item or variable in Story settings first' : ''}
            onClick={() =>
              edit((p, d) =>
                p.content.push({
                  type: 'effect',
                  effect: d.items.length ? { type: 'give_item', itemId: d.items[0].id } : { type: 'set_var', variableId: d.variables[0].id, value: d.variables[0].initial },
                  origin: 'user_authored',
                  review: 'approved',
                }),
              )
            }
          >
            + Effect
          </button>
          <button
            className="btn tiny"
            title="The reader clicks Continue before reading what follows. Move it up between two lines, or add breaks from the Graph."
            onClick={() => edit((p) => p.content.push({ type: 'pause', origin: 'user_authored' }))}
          >
            + Continue break
          </button>
          <button
            className="btn tiny"
            title="The dialogue stops here and the game plays (a fight, exploring, a puzzle) until it resumes the story. Name it so the game knows which exit this is."
            onClick={() => edit((p) => p.content.push({ type: 'exit', name: `exit_${p.content.filter((b) => b.type === 'exit').length + 1}`, origin: 'user_authored' }))}
          >
            + Exit to game
          </button>
          <button
            className="btn tiny"
            title="A cue for the game here: music, a sound, a camera shake. Readers don’t see it; in Unity it plays without code."
            onClick={() => edit((p) => p.content.push({ type: 'cue', name: 'music', origin: 'user_authored' }))}
          >
            + Cue
          </button>
        </div>
      </section>

      <section className="flow">
        <h3>Choices</h3>
        {passage.choices.length === 0 && <p className="muted small">No choices — the story continues automatically.</p>}
        {passage.choices.map((c, i) => (
          <ChoiceEditor
            key={c.id}
            choice={c}
            project={project}
            onChange={(fn) =>
              edit((p) => {
                fn(p.choices[i]);
                if (p.choices[i].origin === 'source') p.choices[i].origin = 'user_authored';
              }, `choice:${c.id}`)
            }
            onReview={(status) => edit((p) => (p.choices[i].review = status))}
            onDelete={() => edit((p) => p.choices.splice(i, 1))}
            onGo={() => c.target !== 'END' && onSelect(c.target)}
          />
        ))}
        <button className="btn tiny" onClick={() => update((d) => addChoice(d, pid))}>
          + Add choice
        </button>

        <div className="then">
          <label>
            <span className="muted small">{activeChoices.length ? 'Fallback when no choice is available' : 'Then'}</span>
            <select
              className="input small"
              value={passage.divert ? passage.divert : passage.isEnding ? '__end' : '__none'}
              onChange={(e) =>
                edit((p) => {
                  const v = e.target.value;
                  p.isEnding = v === '__end';
                  p.divert = v.startsWith('__') ? undefined : v;
                })
              }
            >
              <option value="__end">End the story here</option>
              <option value="__none">— nothing (player may get stuck) —</option>
              {project.passages
                .filter((p) => p.id !== pid)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Continue to {p.title} ({p.id})
                  </option>
                ))}
            </select>
          </label>
          {passage.divert && passage.divert !== 'END' && (
            <button className="btn tiny" onClick={() => onSelect(passage.divert!)}>
              Go →
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function BlockRow({
  block,
  project,
  onChange,
  onDelete,
  onMove,
  onFocusLine,
  onCueSound,
}: {
  block: ContentBlock;
  project: StoryProject;
  onChange: (b: ContentBlock) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onFocusLine: (line: number) => void;
  /** Attaches a sound to every cue with this tag (or takes it away). */
  onCueSound: (tag: string, audio: AudioRef | undefined) => void;
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

function ChoiceEditor({
  choice,
  project,
  onChange,
  onReview,
  onDelete,
  onGo,
}: {
  choice: Choice;
  project: StoryProject;
  onChange: (fn: (c: Choice) => void) => void;
  onReview: (s: Choice['review']) => void;
  onDelete: () => void;
  onGo: () => void;
}) {
  return (
    <div className={`choice choice-${choice.review}`}>
      <div className="row">
        <span className="bullet mono">{choice.once ? '*' : '+'}</span>
        <input className="input choice-text" value={choice.text} onChange={(e) => onChange((c) => (c.text = e.target.value))} aria-label="Choice text" />
        <span className="muted">→</span>
        <select className="input small target" value={choice.target} onChange={(e) => onChange((c) => (c.target = e.target.value))}>
          {!project.passages.some((p) => p.id === choice.target) && choice.target !== 'END' && <option value={choice.target}>⚠ {choice.target || '(none)'}</option>}
          {project.passages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
          <option value="END">— End —</option>
        </select>
        <button className="icon" title="Open destination" onClick={onGo}>
          ↗
        </button>
      </div>
      <div className="row wrap choice-logic">
        <ProvenanceBadge origin={choice.origin} />
        {choice.review !== 'approved' && (
          <Badge
            tone={choice.review === 'pending' ? 'review' : 'muted'}
            title={choice.review === 'pending' ? 'Pending: a suggestion waiting for your OK. Until then it’s left out of Playtest and the export' : 'Rejected: left out of the story'}
          >
            {choice.review}
          </Badge>
        )}
        {choice.conditions.map((cond, i) => (
          <span key={`c${i}`} className="chip cond" title="Condition: the choice only appears when this is true (for example, the player has the key)">
            if <code>{conditionToInk(cond)}</code>
            <button className="chip-x" onClick={() => onChange((c) => c.conditions.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        {choice.effects.map((e, i) => (
          <span key={`e${i}`} className="chip effect" title="Effect: what happens when the player picks this choice (for example, they get an item)">
            <code>{effectToInk(e).replace(/^~ /, '')}</code>
            <button className="chip-x" onClick={() => onChange((c) => c.effects.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        <AddCondition project={project} onAdd={(cond) => onChange((c) => c.conditions.push(cond))} />
        <AddEffect project={project} onAdd={(e) => onChange((c) => c.effects.push(e))} />
        <label className="check small">
          <input type="checkbox" checked={choice.once} onChange={(e) => onChange((c) => (c.once = e.target.checked))} />{' '}
          <span title="Once only: after the player picks this choice, it disappears if they come back here">once only</span>
        </label>
        <span className="spacer" />
        {choice.review === 'pending' && (
          <>
            <button className="btn tiny ok" onClick={() => onReview('approved')}>
              Approve
            </button>
            <button className="btn tiny" onClick={() => onReview('rejected')}>
              Reject
            </button>
          </>
        )}
        {choice.review === 'rejected' && (
          <button className="btn tiny" onClick={() => onReview('pending')}>
            Restore
          </button>
        )}
        <button className="icon" title="Delete choice" onClick={onDelete}>
          ×
        </button>
      </div>
    </div>
  );
}

function AddCondition({ project, onAdd }: { project: StoryProject; onAdd: (c: Condition) => void }) {
  const options = [
    ...project.items.flatMap((i) => [
      { label: `has ${i.displayName}`, cond: { type: 'has_item', itemId: i.id } as Condition },
      { label: `lacks ${i.displayName}`, cond: { type: 'not', condition: { type: 'has_item', itemId: i.id } } as Condition },
    ]),
    ...project.variables.map((v) => ({
      label: `${v.id} ${v.type === 'int' ? '>= 1' : '== true'}`,
      cond: { type: 'compare', variableId: v.id, op: (v.type === 'int' ? '>=' : '==') as CompareOp, value: v.type === 'int' ? 1 : v.type === 'bool' ? true : '' } as Condition,
    })),
  ];
  if (!options.length) return null;
  return (
    <select className="input tiny-select" value="" onChange={(e) => e.target.value && onAdd(options[+e.target.value].cond)}>
      <option value="">+ condition</option>
      {options.map((o, i) => (
        <option key={i} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AddEffect({ project, onAdd }: { project: StoryProject; onAdd: (e: Effect) => void }) {
  const options: { label: string; e: Effect }[] = [
    ...project.items.flatMap((i) => [
      { label: `give ${i.displayName}`, e: { type: 'give_item', itemId: i.id } as Effect },
      { label: `take ${i.displayName}`, e: { type: 'take_item', itemId: i.id } as Effect },
    ]),
    ...project.variables.map((v) =>
      v.type === 'int' ? { label: `${v.id} += 1`, e: { type: 'add_var', variableId: v.id, amount: 1 } as Effect } : { label: `set ${v.id}`, e: { type: 'set_var', variableId: v.id, value: v.type === 'bool' ? true : '' } as Effect },
    ),
  ];
  if (!options.length) return null;
  return (
    <select className="input tiny-select" value="" onChange={(e) => e.target.value && onAdd(options[+e.target.value].e)}>
      <option value="">+ effect</option>
      {options.map((o, i) => (
        <option key={i} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function EffectEditor({ effect, project, onChange }: { effect: Effect; project: StoryProject; onChange: (e: Effect) => void }) {
  if (effect.type === 'give_item' || effect.type === 'take_item')
    return (
      <span className="row">
        <select className="input small" value={effect.type} onChange={(e) => onChange({ ...effect, type: e.target.value as 'give_item' | 'take_item' })}>
          <option value="give_item">Give</option>
          <option value="take_item">Take</option>
        </select>
        <select className="input small" value={effect.itemId} onChange={(e) => onChange({ ...effect, itemId: e.target.value })}>
          {project.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.displayName}
            </option>
          ))}
        </select>
      </span>
    );
  return <code className="small">{effectToInk(effect)}</code>;
}

function StorySettings({ project, update, onKeepDraft, onRestoreDraft }: { project: StoryProject; update: Update; onKeepDraft: (label: string) => Promise<void>; onRestoreDraft: (id: number) => void }) {
  return (
    <div className="editor settings">
      <h2>Story settings</h2>
      <div className="ex-libris" aria-label="Bookplate">
        <span className="ex-libris-label">Ex Libris</span>
        <span className="ex-libris-title">{project.project.title || 'Untitled'}</span>
        {project.project.author && <span className="ex-libris-by">by {project.project.author}</span>}
        <span className="ex-libris-meta">
          {project.passages.length} passages · {project.characters.length} characters · {project.project.mode} edition
        </span>
      </div>
      <div className="settings-grid">
        <label className="field">
          <span className="muted small">Title</span>
          <input className="input" value={project.project.title} onChange={(e) => update((d) => (d.project.title = e.target.value), `settings:project.title`)} />
        </label>
        <label className="field">
          <span className="muted small">Author</span>
          <input className="input" value={project.project.author ?? ''} onChange={(e) => update((d) => (d.project.author = e.target.value || undefined), `settings:project.author`)} />
        </label>
        <label className="field">
          <span className="muted small">Start passage</span>
          <select className="input" value={project.project.startPassage} onChange={(e) => update((d) => (d.project.startPassage = e.target.value))}>
            {project.passages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="muted small">Mode · schema</span>
          <span>
            {project.project.mode} · ISR {project.schemaVersion}
          </span>
        </div>
      </div>

      <AtAGlance project={project} />
      <DraftShelf projectId={project.project.id} current={project} onKeep={onKeepDraft} onRestore={onRestoreDraft} />

      <h3>Characters</h3>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Display name</th>
            <th>Aliases seen in source</th>
            <th>Same person as…</th>
            <th>Voice</th>
            <th>Portrait</th>
          </tr>
        </thead>
        <tbody>
          {project.characters.map((c, i) => (
            <tr key={c.id}>
              <td className="mono small">{c.id}</td>
              <td>
                <input className="input small" value={c.displayName} onChange={(e) => update((d) => (d.characters[i].displayName = e.target.value), `settings:characters.displayName:${i}`)} />
              </td>
              <td className="muted small">{c.aliases.join(', ') || '—'}</td>
              <td>
                {project.characters.length > 1 && (
                  <select
                    className="input tiny-select"
                    value=""
                    aria-label={`Merge ${c.displayName} into another character`}
                    onChange={(e) => {
                      const into = project.characters.find((x) => x.id === e.target.value);
                      if (!into || !confirm(`Merge ${c.displayName} into ${into.displayName}? All of ${c.displayName}’s lines will be spoken by ${into.displayName}.`)) return;
                      update((d) => mergeCharacter(d, c.id, into.id));
                    }}
                  >
                    <option value="">merge into…</option>
                    {project.characters
                      .filter((x) => x.id !== c.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.displayName}
                        </option>
                      ))}
                  </select>
                )}
              </td>
              <td>
                <VoicePicker voice={c.voice} name={c.displayName} onChange={(voice) => update((d) => (d.characters[i].voice = voice), `settings:voice:${i}`)} />
              </td>
              <td>
                <CharacterPortrait character={c} update={update} />
              </td>
            </tr>
          ))}
          {!project.characters.length && (
            <tr>
              <td colSpan={6} className="muted small">
                No characters detected.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Recordings</h3>
      <RecordingsImport project={project} update={update} />

      <StoryFiles project={project} />

      <h3>Items</h3>
      <p className="muted small">Each item becomes an Ink Boolean <code>has_&lt;id&gt;</code>. In a real game the host inventory should stay authoritative.</p>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Display name</th>
            <th>Consumable</th>
            <th>Origin</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {project.items.map((it, i) => (
            <tr key={it.id}>
              <td className="mono small">{it.id}</td>
              <td>
                <input className="input small" value={it.displayName} onChange={(e) => update((d) => (d.items[i].displayName = e.target.value), `settings:items.displayName:${i}`)} />
              </td>
              <td>
                <input type="checkbox" checked={it.consumable} onChange={(e) => update((d) => (d.items[i].consumable = e.target.checked))} />
              </td>
              <td>
                <ProvenanceBadge origin={it.origin} />
              </td>
              <td>
                <button className="icon" title="Remove (references will be flagged)" onClick={() => update((d) => d.items.splice(i, 1))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewEntry
        placeholder="new_item_id"
        label="+ Item"
        onAdd={(raw) =>
          update((d) => {
            const id = uniqueId(raw, new Set(d.items.map((x) => x.id)), 'item');
            d.items.push({ id, displayName: raw, consumable: false, origin: 'user_authored' });
          })
        }
      />

      <h3>Variables</h3>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Type</th>
            <th>Initial</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {project.variables.map((v, i) => (
            <tr key={v.id}>
              <td className="mono small">{v.id}</td>
              <td className="small">{v.type}</td>
              <td>
                {v.type === 'bool' ? (
                  <input type="checkbox" checked={v.initial === true} onChange={(e) => update((d) => (d.variables[i].initial = e.target.checked))} />
                ) : (
                  <input
                    className="input small"
                    value={String(v.initial)}
                    onChange={(e) => update((d) => (d.variables[i].initial = v.type === 'int' ? parseInt(e.target.value || '0', 10) || 0 : e.target.value))}
                  />
                )}
              </td>
              <td>
                <button className="icon" onClick={() => update((d) => d.variables.splice(i, 1))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewEntry
        placeholder="trust"
        label="+ Integer variable"
        onAdd={(raw) =>
          update((d) => {
            const id = uniqueId(raw, new Set([...d.variables.map((x) => x.id), ...d.items.map((x) => `has_${x.id}`)]), 'var');
            d.variables.push({ id, type: 'int', initial: 0, origin: 'user_authored' });
          })
        }
      />
    </div>
  );
}

/** Length, branching and who speaks how much, for planning reading time and voice sessions. */
function AtAGlance({ project }: { project: StoryProject }) {
  const st = useMemo(() => storyStats(project), [project]);
  const n = (v: number) => v.toLocaleString();
  return (
    <section className="glance" aria-labelledby="glance-head">
      <h3 id="glance-head">At a glance</h3>
      <dl className="glance-grid">
        <div>
          <dt>Words</dt>
          <dd>{n(st.words)}</dd>
        </div>
        <div>
          <dt>Reading time</dt>
          <dd>{formatMinutes(st.readingMinutes)}</dd>
        </div>
        <div>
          <dt>Choices</dt>
          <dd>
            {n(st.choices)}
            {st.conditionalChoices > 0 && <span className="muted small"> · {n(st.conditionalChoices)} conditional</span>}
          </dd>
        </div>
        <div>
          <dt>Endings</dt>
          <dd>{n(st.endings)}</dd>
        </div>
        <div>
          <dt>Spoken dialogue</dt>
          <dd>{formatMinutes(st.spokenMinutes)}</dd>
        </div>
      </dl>
      {st.characters.length > 0 && (
        <table className="table glance-cast">
          <caption className="muted small">Lines per character (rejected passages are not counted)</caption>
          <thead>
            <tr>
              <th scope="col">Character</th>
              <th scope="col">Lines</th>
              <th scope="col">Words</th>
              <th scope="col">Clips</th>
            </tr>
          </thead>
          <tbody>
            {st.characters.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{n(c.lines)}</td>
                <td>{n(c.words)}</td>
                <td>
                  {c.clips}/{c.lines}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewEntry({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV('');
      }}
    >
      <input className="input small mono" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn tiny" type="submit" disabled={!v.trim()}>
        {label}
      </button>
    </form>
  );
}

function FindReplace({ project, update, onSelect }: { project: StoryProject; update: Update; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [done, setDone] = useState('');
  const hits = useMemo(() => findText(project, query, matchCase), [project, query, matchCase]);
  const titles = new Map(project.passages.map((p) => [p.id, p.title]));
  return (
    <details className="find-panel" onToggle={() => setDone('')}>
      <summary>Find &amp; replace</summary>
      <input className="input small" placeholder="Find…" value={query} onChange={(e) => (setQuery(e.target.value), setDone(''))} aria-label="Find text" />
      <input className="input small" placeholder="Replace with…" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
      <div className="row">
        <label className="check small">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> match case
        </label>
        <span className="spacer" />
        <button
          className="btn tiny"
          disabled={!hits.length}
          onClick={() => {
            const n = hits.length;
            update((d) => replaceText(d, query, replacement, matchCase));
            setDone(`Replaced ${n} ${n === 1 ? 'match' : 'matches'}. Undo with ↶ if needed.`);
          }}
        >
          Replace all
        </button>
      </div>
      {query && <p className="muted small">{done || `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}</p>}
      {hits.length > 0 && (
        <ul className="find-hits">
          {hits.slice(0, 40).map((h, i) => (
            <li key={i}>
              <button className="link small" onClick={() => onSelect(h.passageId)}>
                <span className="find-where">{titles.get(h.passageId)}</span> {h.excerpt}
              </button>
            </li>
          ))}
          {hits.length > 40 && <li className="muted small">…and {hits.length - 40} more</li>}
        </ul>
      )}
    </details>
  );
}
