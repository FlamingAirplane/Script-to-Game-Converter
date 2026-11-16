import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewAll } from '../core/adapt';
import { type Passage, type StoryProject } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { Badge, ProvenanceBadge, SeverityIcon } from './common';
import { friendly } from './friendly';
import { setCueSound } from '../core/cues';
import { ScenePicture } from './ScenePicture';
import type { SceneRequest } from './NewScene';
import { type Update, STORY_SETTINGS, addChoice, canBecomeChoice, choiceTextFor, deletePassage, lineToChoice, movePassage, renamePassage } from './projectOps';
import { BlockRow, LineToChoice } from './review/ContentBlocks';
import { ChoiceEditor } from './review/ChoiceEditor';
import { StorySettings } from './review/StorySettings';
import { FindReplace } from './review/FindReplace';
import { ActSetting } from './review/ActSetting';
import { actOf, passagesByAct } from '../core/acts';

/** Whether Passage settings is unfolded: remembered from passage to passage while the app is open. */
let passageSettingsOpen = false;

export function ReviewView({
  processed,
  selected,
  onSelect,
  update,
  dialogueOnly,
  onDialogueOnly,
  onKeepDraft,
  onRestoreDraft,
  onNewScene,
}: {
  processed: ProcessedStory;
  selected: string;
  onSelect: (id: string) => void;
  update: Update;
  dialogueOnly: boolean;
  onDialogueOnly: (on: boolean) => void;
  onKeepDraft: (label: string) => Promise<void>;
  onRestoreDraft: (id: number) => void;
  /** Opens the New scene form. */
  onNewScene: (r: SceneRequest) => void;
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
        {passagesByAct(project, visible).map((group) => (
        <div className="act-group" key={group.act?.id ?? ''}>
        {group.act && (
          <h4 className="act-head" title={`Act ${group.act.id}`}>
            {group.act.title}
          </h4>
        )}
        {!group.act && visible.some((p) => p.act) && <h4 className="act-head muted">Not in an act</h4>}
        <ol className="passages">
          {group.passages.map((p) => {
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
        </div>
        ))}
        <button
          className="btn small"
          title="Add a scene: after the selected passage, as a new choice in it, or on its own"
          onClick={() => {
            setContentsOpen(false);
            onNewScene(passage ? { from: passage.id } : {});
          }}
        >
          + New scene
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
            <dt>from your script</dt>
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
            <dt>forced</dt>
            <dd>Once its condition is true (e.g. the player has the key), it’s the only choice here: the player has to take it.</dd>
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
            onNewScene={onNewScene}
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
  onNewScene,
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
  onNewScene: (r: SceneRequest) => void;
}) {
  const project = processed.project;
  const [idDraft, setIdDraft] = useState(passage.id);
  const [idError, setIdError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(passageSettingsOpen);
  /** The line being turned into a choice, and what the last one became (for the note under Choices). */
  const [choiceFrom, setChoiceFrom] = useState<number | null>(null);
  const [madeChoice, setMadeChoice] = useState('');
  const pid = passage.id;
  useEffect(() => {
    setChoiceFrom(null);
    setMadeChoice('');
  }, [pid]);
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
        </div>
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

      {/* Everything about the passage that isn't its words: folded away, so the story text comes first. */}
      <details
        className="passage-settings"
        open={settingsOpen}
        onToggle={(e) => {
          passageSettingsOpen = (e.target as HTMLDetailsElement).open;
          setSettingsOpen(passageSettingsOpen);
        }}
      >
        <summary>
          <span className="passage-settings-title">Passage settings</span>
          <span className="muted small">
            {[passage.image ? '🖼 has a picture' : 'picture', actOf(project, passage) ? `🎭 ${actOf(project, passage)!.title}` : 'act', passage.cutscene ? '🎬 plays as a cutscene' : 'cutscene', isStart ? 'the story starts here' : 'start', 'order', 'id', 'delete'].join(' · ')}
          </span>
        </summary>
        <div className="row wrap passage-settings-row">
            <label className="id-field">
              <span className="muted small" title="The name choices and the game use for this passage. Changing it updates every choice that leads here.">id (for developers)</span>
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
        <ScenePicture passage={passage} update={update} />

        <ActSetting project={project} passage={passage} update={update} />

        <div className="cutscene-setting">
          <label>
            <input type="checkbox" checked={!!passage.cutscene} onChange={(e) => edit((p) => (e.target.checked ? (p.cutscene = true) : delete p.cutscene))} />{' '}
            <strong>🎬 Cutscene</strong>
          </label>
          <span className="muted small">
            {passage.cutscene
              ? `Players see only its dialogue${passage.content.some((b) => b.type === 'action' || b.type === 'transition') || passage.sceneHeading ? ' (narration, transitions and the scene heading are left out)' : ''}, one line at a time, going on by itself; they can skip it.${passage.choices.length ? ' Its choices come once it’s over.' : ''}`
              : 'Play this passage as a cutscene: only the dialogue, one line at a time, going on by itself.'}
          </span>
        </div>
      </details>

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
          <div key={i} className={choiceFrom === i ? 'block-turning' : undefined}>
          <BlockRow
            block={b}
            project={project}
            onFocusLine={onFocusLine}
            onCueSound={(tag, audio) => update((d) => setCueSound(d, tag, audio))}
            onChange={(nb) => edit((p) => (p.content[i] = nb), `block:${pid}:${i}`)}
            onDelete={() => (setChoiceFrom(null), edit((p) => p.content.splice(i, 1)))}
            onMove={(dir) =>
              edit((p) => {
                const j = i + dir;
                if (j < 0 || j >= p.content.length) return;
                [p.content[i], p.content[j]] = [p.content[j], p.content[i]];
              })
            }
            onToChoice={canBecomeChoice(b) ? () => (setChoiceFrom(choiceFrom === i ? null : i), setMadeChoice('')) : undefined}
          />
          {choiceFrom === i && 'text' in b && (
            <LineToChoice
              passage={passage}
              project={project}
              index={i}
              text={b.text}
              onCancel={() => setChoiceFrom(null)}
              onMake={(text, to) => {
                let error: string | null = null;
                update((d) => {
                  const result = lineToChoice(d, pid, i, text, to);
                  if ('error' in result) error = result.error;
                });
                if (error) return error;
                setChoiceFrom(null);
                setMadeChoice(text);
                return null;
              }}
            />
          )}
          </div>
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
        {passage.choices.length === 0 && <p className="muted small">No choices — the story continues automatically. To branch, press ⑂ beside a line above to turn it into a choice.</p>}
        {madeChoice && (
          <p className="made-choice small" role="status">
            ⑂ “{choiceTextFor(madeChoice)}” is now a choice.{' '}
            {activeChoices.length < 2 ? 'Add another choice (or turn another line into one) to give the player a real decision.' : 'Check where each one leads below.'}
          </p>
        )}
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
            onNewTarget={() =>
              onNewScene({
                title: c.text,
                purpose: `The choice “${c.text}” in “${passage.title}” will lead to it.`,
                retarget: { passageId: pid, choiceId: c.id },
                then: passage.choices.length === 1 && passage.divert ? passage.divert : undefined,
              })
            }
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
                e.target.value === '__new'
                  ? onNewScene({
                      purpose: activeChoices.length ? `“${passage.title}” will go on to it when none of its choices can be taken.` : `“${passage.title}” will go on into it.`,
                      retarget: { passageId: pid },
                      then: activeChoices.length ? undefined : (passage.divert ?? (passage.isEnding ? 'END' : undefined)),
                    })
                  : edit((p) => {
                  const v = e.target.value;
                  p.isEnding = v === '__end';
                  p.divert = v.startsWith('__') ? undefined : v;
                })
              }
            >
              <option value="__end">End the story here</option>
              <option value="__none">— nothing (player may get stuck) —</option>
              <option value="__new">+ A new scene…</option>
              {project.passages
                .filter((p) => p.id !== pid)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Continue to {p.title}{project.passages.some((x) => x !== p && x.title === p.title) ? ` (${p.id})` : ''}
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
