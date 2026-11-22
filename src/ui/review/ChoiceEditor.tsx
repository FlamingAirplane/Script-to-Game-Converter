import { conditionToInk, effectToInk } from '../../core/inkgen';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { type Choice, type CompareOp, type Condition, type Effect, type StoryProject } from '../../core/isr';
import { Badge, ProvenanceBadge } from '../common';
import { conditionInWords, describeCondition, effectInWords } from '../../core/gating';

export function ChoiceEditor({
  choice,
  project,
  onChange,
  onReview,
  onDelete,
  onGo,
  onNewTarget,
}: {
  choice: Choice;
  project: StoryProject;
  onChange: (fn: (c: Choice) => void) => void;
  onReview: (s: Choice['review']) => void;
  onDelete: () => void;
  onGo: () => void;
  /** Opens the New scene form for a scene this choice leads to. */
  onNewTarget: () => void;
}) {
  return (
    <div className={`choice choice-${choice.review}`}>
      <div className="row">
        <span className="bullet mono" aria-hidden title={choice.once ? 'Once only' : 'Can be picked every time'}>{choice.once ? '*' : '+'}</span>
        <input className="input choice-text" value={choice.text} onChange={(e) => onChange((c) => (c.text = e.target.value))} aria-label="Choice text" />
        <span className="muted">→</span>
        <select className="input small target" aria-label="Where this choice leads" value={choice.target} onChange={(e) => (e.target.value === '__new' ? onNewTarget() : onChange((c) => (c.target = e.target.value)))}>
          {!project.passages.some((p) => p.id === choice.target) && choice.target !== 'END' && <option value={choice.target}>⚠ {choice.target || '(none)'}</option>}
          {project.passages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
          <option value="END">— End —</option>
          <option value="__new">+ A new scene…</option>
        </select>
        <button className="icon" title="Open the scene this leads to" aria-label="Open the scene this leads to" disabled={choice.target === 'END'} onClick={onGo}>
          <ArrowUpRight size={15} aria-hidden />
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
          <span key={`c${i}`} className="chip cond" title={`Condition: the choice only appears when this is true. In Ink: ${conditionToInk(cond)}`}>
            if {conditionInWords(cond, project)}
            <button className="chip-x" aria-label="Remove this condition" title="Remove this condition" onClick={() => onChange((c) => c.conditions.splice(i, 1))}>
              ×
            </button>
          </span>
        ))}
        {choice.effects.map((e, i) => (
          <span key={`e${i}`} className="chip effect" title={`Effect: what happens when the player picks this choice. In Ink: ${effectToInk(e).replace(/^~ /, '')}`}>
            {effectInWords(e, project)}
            <button className="chip-x" aria-label="Remove this effect" title="Remove this effect" onClick={() => onChange((c) => c.effects.splice(i, 1))}>
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
        <label className="check small">
          <input type="checkbox" checked={!!choice.forced} onChange={(e) => onChange((c) => (e.target.checked ? (c.forced = true) : delete c.forced))} />{' '}
          <span title="Forced: once its condition is true, this is the only choice here, so the player has to take it">forced</span>
        </label>
        {choice.forced && (
          <p className={`small choice-forced-note ${choice.conditions.length ? 'muted' : 'sev-warning'}`}>
            {choice.conditions.length
              ? `While this is true (${choice.conditions.map((x) => describeCondition(x, project)).join(' and ')}), it’s the only choice here.`
              : 'Add a condition (+ condition) for this to do anything: the player is forced to take it once the condition is true.'}
          </p>
        )}
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
        <button className="icon icon-danger" title="Delete this choice" aria-label="Delete this choice" onClick={onDelete}>
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AddCondition({ project, onAdd }: { project: StoryProject; onAdd: (c: Condition) => void }) {
  const options = [
    ...project.items.flatMap((i) => [
      { label: `the player has ${i.displayName}`, cond: { type: 'has_item', itemId: i.id } as Condition },
      { label: `the player doesn’t have ${i.displayName}`, cond: { type: 'not', condition: { type: 'has_item', itemId: i.id } } as Condition },
    ]),
    ...project.variables.map((v) => ({
      label: v.type === 'int' ? `${v.id} is at least 1` : v.type === 'bool' ? `${v.id} is yes` : `${v.id} is set`,
      cond: { type: 'compare', variableId: v.id, op: (v.type === 'int' ? '>=' : '==') as CompareOp, value: v.type === 'int' ? 1 : v.type === 'bool' ? true : '' } as Condition,
    })),
  ];
  if (!options.length) return null;
  return (
    <select className="input tiny-select" aria-label="Add a condition: show this choice only when…" value="" onChange={(e) => e.target.value && onAdd(options[+e.target.value].cond)}>
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
      { label: `the player gets ${i.displayName}`, e: { type: 'give_item', itemId: i.id } as Effect },
      { label: `the player loses ${i.displayName}`, e: { type: 'take_item', itemId: i.id } as Effect },
    ]),
    ...project.variables.map((v) =>
      v.type === 'int' ? { label: `${v.id} goes up by 1`, e: { type: 'add_var', variableId: v.id, amount: 1 } as Effect } : { label: v.type === 'bool' ? `${v.id} becomes yes` : `set ${v.id}`, e: { type: 'set_var', variableId: v.id, value: v.type === 'bool' ? true : '' } as Effect },
    ),
  ];
  if (!options.length) return null;
  return (
    <select className="input tiny-select" aria-label="Add an effect: what happens when picked" value="" onChange={(e) => e.target.value && onAdd(options[+e.target.value].e)}>
      <option value="">+ effect</option>
      {options.map((o, i) => (
        <option key={i} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function EffectEditor({ effect, project, onChange }: { effect: Effect; project: StoryProject; onChange: (e: Effect) => void }) {
  if (effect.type === 'give_item' || effect.type === 'take_item')
    return (
      <span className="row">
        <select className="input small" value={effect.type} onChange={(e) => onChange({ ...effect, type: e.target.value as 'give_item' | 'take_item' })}>
          <option value="give_item">The player gets</option>
          <option value="take_item">The player loses</option>
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
  return (
    <span className="small" title={`In Ink: ${effectToInk(effect).replace(/^~ /, '')}`}>
      {effectInWords(effect, project)}
    </span>
  );
}
