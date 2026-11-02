import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewAll } from '../core/adapt';
import { conditionToInk, effectToInk } from '../core/inkgen';
import { uniqueId, type Choice, type CompareOp, type Condition, type ContentBlock, type Effect, type Passage, type StoryProject } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { Badge, ProvenanceBadge, SeverityIcon } from './common';
import { addChoice, addPassage, deletePassage, renamePassage } from './projectOps';

type Update = (fn: (draft: StoryProject) => void) => void;

export const STORY_SETTINGS = '__story__';

export function ReviewView({ processed, selected, onSelect, update }: { processed: ProcessedStory; selected: string; onSelect: (id: string) => void; update: Update }) {
  const project = processed.project;
  const [filter, setFilter] = useState('');
  const [showSource, setShowSource] = useState(true);
  const [focusLine, setFocusLine] = useState<number | undefined>();
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
      <aside className="passage-list">
        <button className={`story-entry ${selected === STORY_SETTINGS ? 'active' : ''}`} onClick={() => onSelect(STORY_SETTINGS)}>
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
        <input className="input small" placeholder="Filter passages…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ol className="passages">
          {visible.map((p) => {
            const issues = issuesByPassage.get(p.id);
            const pending = p.choices.filter((c) => c.review === 'pending').length;
            const node = processed.analysis.graph.nodes.find((n) => n.id === p.id);
            return (
              <li key={p.id}>
                <button className={`passage-item ${selected === p.id ? 'active' : ''}`} onClick={() => onSelect(p.id)}>
                  <span className="passage-title">{p.title}</span>
                  <span className="passage-meta">
                    <span className="mono muted small">{p.id}</span>
                    {project.project.startPassage === p.id && <Badge tone="accent">start</Badge>}
                    {node?.isEnding && <Badge tone="ok">ending</Badge>}
                    {node && !node.reachable && <Badge tone="warning">unreachable</Badge>}
                    {pending > 0 && <Badge tone="review">{pending} to review</Badge>}
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
            setTimeout(() => onSelect(id));
          }}
        >
          + Add passage
        </button>
      </aside>

      <main className="passage-editor">
        {selected === STORY_SETTINGS ? (
          <StorySettings project={project} update={update} />
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
}: {
  passage: Passage;
  processed: ProcessedStory;
  update: Update;
  onSelect: (id: string) => void;
  onFocusLine: (line: number) => void;
  showSource: boolean;
  toggleSource: () => void;
}) {
  const project = processed.project;
  const [idDraft, setIdDraft] = useState(passage.id);
  const [idError, setIdError] = useState('');
  const pid = passage.id;
  const edit = (fn: (p: Passage, d: StoryProject) => void) =>
    update((d) => {
      const p = d.passages.find((x) => x.id === pid);
      if (p) fn(p, d);
    });
  const diags = processed.diagnostics.filter(
    (d) => d.entityId === pid || d.details?.passageId === pid || passage.choices.some((c) => c.id === d.entityId),
  );
  const isStart = project.project.startPassage === pid;
  const activeChoices = passage.choices.filter((c) => c.review === 'approved');

  return (
    <div className="editor">
      <header className="editor-head">
        <input className="title-input" value={passage.title} onChange={(e) => edit((p) => ((p.title = e.target.value), (p.origin = p.origin === 'source' ? 'user_authored' : p.origin)))} aria-label="Passage title" />
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
          {passage.source && (
            <button className="btn tiny" onClick={toggleSource}>
              {showSource ? 'Hide source' : 'Show source'}
            </button>
          )}
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
              <SeverityIcon severity={d.severity} /> <span className="mono small">{d.code}</span> {d.message}
            </li>
          ))}
        </ul>
      )}

      <section className="blocks">
        <h3>Content</h3>
        {passage.content.length === 0 && <p className="muted small">No narrative content.</p>}
        {passage.content.map((b, i) => (
          <BlockRow
            key={i}
            block={b}
            project={project}
            onFocusLine={onFocusLine}
            onChange={(nb) => edit((p) => (p.content[i] = nb))}
            onDelete={() => edit((p) => p.content.splice(i, 1))}
            onMove={(dir) =>
              edit((p) => {
                const j = i + dir;
                if (j < 0 || j >= p.content.length) return;
                [p.content[i], p.content[j]] = [p.content[j], p.content[i]];
              })
            }
          />
        ))}
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
              })
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
}: {
  block: ContentBlock;
  project: StoryProject;
  onChange: (b: ContentBlock) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onFocusLine: (line: number) => void;
}) {
  const touched = (b: ContentBlock): ContentBlock => ({ ...b, origin: b.origin === 'generated' ? 'generated' : 'user_authored' }) as ContentBlock;
  return (
    <div className={`block block-${block.type}`}>
      <div className="block-gutter">
        <span className="block-type">{block.type}</span>
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
          </div>
        )}
        {'text' in block && block.type !== 'unsupported' && (
          <AutoText value={block.text} onChange={(text) => onChange(touched({ ...block, text } as ContentBlock))} serif={block.type !== 'note'} />
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

function AutoText({ value, onChange, serif }: { value: string; onChange: (v: string) => void; serif?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={`autotext ${serif ? 'serif' : 'mono small'}`} value={value} onChange={(e) => onChange(e.target.value)} />;
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
        {choice.review !== 'approved' && <Badge tone={choice.review === 'pending' ? 'review' : 'muted'}>{choice.review}</Badge>}
        {choice.conditions.map((cond, i) => (
          <span key={`c${i}`} className="chip cond" title="Condition">
            if <code>{conditionToInk(cond)}</code>
            <button className="chip-x" onClick={() => onChange((c) => c.conditions.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        {choice.effects.map((e, i) => (
          <span key={`e${i}`} className="chip effect" title="Effect">
            <code>{effectToInk(e).replace(/^~ /, '')}</code>
            <button className="chip-x" onClick={() => onChange((c) => c.effects.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        <AddCondition project={project} onAdd={(cond) => onChange((c) => c.conditions.push(cond))} />
        <AddEffect project={project} onAdd={(e) => onChange((c) => c.effects.push(e))} />
        <label className="check small">
          <input type="checkbox" checked={choice.once} onChange={(e) => onChange((c) => (c.once = e.target.checked))} /> once only
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

function StorySettings({ project, update }: { project: StoryProject; update: Update }) {
  return (
    <div className="editor settings">
      <h2>Story settings</h2>
      <div className="settings-grid">
        <label className="field">
          <span className="muted small">Title</span>
          <input className="input" value={project.project.title} onChange={(e) => update((d) => (d.project.title = e.target.value))} />
        </label>
        <label className="field">
          <span className="muted small">Author</span>
          <input className="input" value={project.project.author ?? ''} onChange={(e) => update((d) => (d.project.author = e.target.value || undefined))} />
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

      <h3>Characters</h3>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Display name</th>
            <th>Aliases seen in source</th>
          </tr>
        </thead>
        <tbody>
          {project.characters.map((c, i) => (
            <tr key={c.id}>
              <td className="mono small">{c.id}</td>
              <td>
                <input className="input small" value={c.displayName} onChange={(e) => update((d) => (d.characters[i].displayName = e.target.value))} />
              </td>
              <td className="muted small">{c.aliases.join(', ') || '—'}</td>
            </tr>
          ))}
          {!project.characters.length && (
            <tr>
              <td colSpan={3} className="muted small">
                No characters detected.
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
                <input className="input small" value={it.displayName} onChange={(e) => update((d) => (d.items[i].displayName = e.target.value))} />
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
