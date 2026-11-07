import { diag, type Diagnostic } from './diagnostics';
import { cueWantsSound } from './cues';
import {
  cueTag,
  conditionItemIds,
  isActive,
  type Condition,
  type Effect,
  type Passage,
  type StoryProject,
} from './isr';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: 'choice' | 'divert' | 'fallback';
  conditional: boolean;
  pending: boolean;
  /** A forced choice: while its condition holds, the only way on from its passage. */
  forced?: boolean;
}

export interface StoryGraph {
  nodes: { id: string; title: string; isEnding: boolean; isStart: boolean; reachable: boolean; origin: Passage['origin'] }[];
  edges: GraphEdge[];
}

export interface Analysis {
  graph: StoryGraph;
  diagnostics: Diagnostic[];
  reachable: Set<string>;
  endings: string[];
}

const STAGE = 'graph_analysis' as const;
const VSTAGE = 'story_validation' as const;

export function analyze(project: StoryProject): Analysis {
  const ds: Diagnostic[] = [];
  const passages = project.passages;
  const byId = new Map<string, Passage>();
  for (const p of passages) {
    if (byId.has(p.id)) ds.push(diag('DUPLICATE_PASSAGE_ID', 'error', VSTAGE, `Two passages use the identifier "${p.id}".`, { entityId: p.id, source: p.source, remediation: 'Rename one of the passages.' }));
    else byId.set(p.id, p);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.id))
      ds.push(diag('INVALID_PASSAGE_ID', 'error', VSTAGE, `"${p.id}" is not a valid Ink identifier.`, { entityId: p.id, remediation: 'Use letters, digits and underscores only.' }));
  }

  const start = project.project.startPassage;
  if (!byId.has(start))
    ds.push(diag('START_MISSING', 'error', VSTAGE, `The start passage "${start}" does not exist.`, { entityId: start, remediation: 'Pick a start passage in the Review tab.' }));

  const items = new Map(project.items.map((i) => [i.id, i]));
  const vars = new Map(project.variables.map((v) => [v.id, v]));
  const readVars = new Set<string>();
  const usedItems = new Set<string>();
  const givenItems = new Set<string>();
  // Items only a suggestion still awaiting approval would give: what to approve, and where.
  const pendingGivers = new Map<string, { label: string; entityId: string; passageId: string }>();

  const checkCondition = (c: Condition, entityId: string) => {
    for (const id of conditionItemIds(c)) {
      usedItems.add(id);
      if (!items.has(id))
        ds.push(diag('ITEM_UNDECLARED', 'error', VSTAGE, `Condition references undeclared item "${id}".`, { entityId, details: { itemId: id }, remediation: `Declare it with "@item ${id}" or add it in the Items panel.` }));
    }
    walkCompare(c, (cmp) => {
      readVars.add(cmp.variableId);
      const v = vars.get(cmp.variableId);
      if (!v) {
        ds.push(diag('VAR_UNDECLARED', 'error', VSTAGE, `Condition references undeclared variable "${cmp.variableId}".`, { entityId, details: { variableId: cmp.variableId } }));
        return;
      }
      const t = typeof cmp.value;
      const expected = v.type === 'bool' ? 'boolean' : v.type === 'int' ? 'number' : 'string';
      if (t !== expected)
        ds.push(diag('CONDITION_TYPE_MISMATCH', 'error', VSTAGE, `"${cmp.variableId}" is ${v.type} but is compared with ${JSON.stringify(cmp.value)}.`, { entityId }));
      if (v.type !== 'int' && !['==', '!='].includes(cmp.op))
        ds.push(diag('CONDITION_BAD_OPERATOR', 'error', VSTAGE, `Operator "${cmp.op}" is only supported for integer variables.`, { entityId }));
    });
  };
  const checkEffect = (e: Effect, entityId: string, active: boolean) => {
    if (e.type === 'give_item' || e.type === 'take_item') {
      if (!items.has(e.itemId)) ds.push(diag('ITEM_UNDECLARED', 'error', VSTAGE, `Effect references undeclared item "${e.itemId}".`, { entityId }));
      usedItems.add(e.itemId);
      if (e.type === 'give_item' && active) givenItems.add(e.itemId);
    } else {
      const v = vars.get(e.variableId);
      if (!v) ds.push(diag('VAR_UNDECLARED', 'error', VSTAGE, `Effect sets undeclared variable "${e.variableId}".`, { entityId }));
      else if (e.type === 'add_var' && v.type !== 'int') ds.push(diag('CONDITION_TYPE_MISMATCH', 'error', VSTAGE, `Cannot add to non-integer variable "${e.variableId}".`, { entityId }));
    }
  };

  const edges: GraphEdge[] = [];
  for (const p of passages) {
    for (const b of p.content) {
      if (b.type !== 'effect') continue;
      const active = !b.review || isActive(b.review);
      checkEffect(b.effect, p.id, active);
      if (b.review === 'pending' && b.effect.type === 'give_item' && !pendingGivers.has(b.effect.itemId))
        pendingGivers.set(b.effect.itemId, { label: `the suggested effect in "${p.title}"`, entityId: p.id, passageId: p.id });
      if (b.review === 'pending')
        ds.push(diag('UNAPPROVED_GENERATED', 'review', 'story_validation', `A generated effect in "${p.title}" needs approval.`, { entityId: p.id, exportBlocked: false }));
    }
    const activeChoices = p.choices.filter((c) => isActive(c.review));
    for (const c of p.choices) {
      const pending = c.review === 'pending';
      if (c.review === 'rejected') continue;
      if (pending)
        ds.push(diag('UNAPPROVED_GENERATED', 'review', 'story_validation', `Proposed choice "${c.text}" in "${p.title}" has not been approved.`, { entityId: c.id, details: { passageId: p.id }, remediation: 'Approve or reject it in the Review tab.', exportBlocked: false }));
      if (!c.text.trim()) ds.push(diag('CHOICE_TEXT_MISSING', 'error', VSTAGE, `A choice in "${p.title}" has no text.`, { entityId: c.id }));
      if (!c.target) ds.push(diag('CHOICE_NO_TARGET', 'error', VSTAGE, `Choice "${c.text}" has no destination.`, { entityId: c.id, details: { passageId: p.id }, source: c.source }));
      else if (c.target !== 'END' && !byId.has(c.target))
        ds.push(diag('INK_TARGET_MISSING', 'error', VSTAGE, `Choice destination "${c.target}" does not exist.`, { entityId: c.id, details: { target: c.target, passageId: p.id }, source: c.source, remediation: 'Point the choice at an existing passage or create the passage.' }));
      c.conditions.forEach((x) => checkCondition(x, c.id));
      c.effects.forEach((e) => checkEffect(e, c.id, !pending));
      if (pending)
        for (const e of c.effects)
          if (e.type === 'give_item' && !pendingGivers.has(e.itemId)) pendingGivers.set(e.itemId, { label: `the suggested choice "${c.text}" in "${p.title}"`, entityId: c.id, passageId: p.id });
      if (c.forced && !c.conditions.length)
        ds.push(
          diag('FORCED_WITHOUT_CONDITION', 'warning', STAGE, `Choice "${c.text}" in "${p.title}" is marked forced but has no condition, so it changes nothing.`, {
            entityId: c.id,
            details: { passageId: p.id },
            remediation: 'Give it a condition (for example, has the brass key), or untick “forced”.',
            exportBlocked: false,
          }),
        );
      if (c.target) edges.push({ id: c.id, from: p.id, to: c.target, label: c.text, kind: 'choice', conditional: c.conditions.length > 0, pending, ...(c.forced && c.conditions.length ? { forced: true } : {}) });
    }
    if (p.divert) {
      if (p.divert !== 'END' && !byId.has(p.divert))
        ds.push(diag('INK_TARGET_MISSING', 'error', VSTAGE, `Divert destination "${p.divert}" does not exist.`, { entityId: p.id, details: { target: p.divert } }));
      edges.push({ id: `${p.id}__divert`, from: p.id, to: p.divert, label: activeChoices.length ? 'fallback' : '', kind: activeChoices.length ? 'fallback' : 'divert', conditional: false, pending: false });
    }
    if (!p.isEnding && !p.divert && activeChoices.length === 0)
      ds.push(diag('NO_AVAILABLE_CHOICES', 'warning', STAGE, `"${p.title}" has no choices, divert or ending — the player will be stuck.`, { entityId: p.id, remediation: 'Add a choice, a divert, or mark it as an ending.', exportBlocked: false }));
    else if (!p.divert && activeChoices.length > 0 && activeChoices.every((c) => c.conditions.length > 0))
      ds.push(diag('ALL_CHOICES_CONDITIONAL', 'warning', STAGE, `Every choice in "${p.title}" is conditional; if none are available the player is stuck.`, { entityId: p.id, remediation: 'Add an unconditional choice or a fallback divert.', exportBlocked: false }));
    if (p.content.filter((b) => b.type !== 'pause').length === 0 && passages.length > 1)
      ds.push(diag('EMPTY_PASSAGE', 'info', STAGE, `"${p.title}" has no narrative content.`, { entityId: p.id, exportBlocked: false }));
    // A scene picture rides on the passage's first line of text (#image), so it needs one.
    if (p.image && !p.content.some((b) => b.type === 'action' || b.type === 'dialogue' || b.type === 'transition'))
      ds.push(diag('IMAGE_WITHOUT_TEXT', 'warning', STAGE, `The picture for "${p.title}" won't show: the passage has no text for it to open.`, { entityId: p.id, remediation: 'Add a line of narration or dialogue to the passage.', exportBlocked: false }));
    // A Continue break should have something to show on each side, or the reader clicks Continue for nothing.
    const shown = (b: (typeof p.content)[number]) => b.type === 'action' || b.type === 'dialogue' || b.type === 'transition';
    const visible = (b: (typeof p.content)[number]) => b.type === 'pause' || shown(b);
    p.content.forEach((b, i) => {
      if (b.type !== 'pause') return;
      // The nearest thing the reader sees on each side must be text, not the passage edge or another break.
      const prev = p.content.slice(0, i).reverse().find(visible);
      const next = p.content.slice(i + 1).find(visible);
      const before = !!prev && shown(prev);
      // (Of two breaks in a row, the second is the redundant one; it is flagged for having no text before.)
      const nextIsText = !!next && (shown(next) || next.type === 'pause');
      if (!before || !nextIsText)
        ds.push(
          diag('PAUSE_WITHOUT_TEXT', 'info', STAGE, `A Continue break in "${p.title}" has no text ${!nextIsText ? 'after' : 'before'} it, so the reader clicks Continue for nothing.`, {
            entityId: p.id,
            remediation: 'Move the break between two lines, or remove it.',
            exportBlocked: false,
          }),
        );
    });
    // An exit at the very end of an ending: when the game resumes the story, it ends at once.
    const lastShown = [...p.content].reverse().find((b) => shown(b) || b.type === 'exit' || b.type === 'pause');
    if (lastShown?.type === 'exit' && p.isEnding && !p.divert && !p.choices.some((c) => isActive(c.review)))
      ds.push(
        diag('EXIT_THEN_END', 'info', STAGE, `The exit "${lastShown.name}" in "${p.title}" is the last thing before the story ends, so resuming after the game ends the story straight away.`, {
          entityId: p.id,
          remediation: 'Add what happens after the gameplay, or have the game end the story itself instead of resuming it.',
          exportBlocked: false,
        }),
      );
  }

  // The game tells exits apart by name: one name in several places is one exit to the game.
  const exitPlaces = new Map<string, string[]>();
  for (const p of passages) for (const b of p.content) if (b.type === 'exit') (exitPlaces.get(b.name) ?? exitPlaces.set(b.name, []).get(b.name)!).push(p.title || p.id);
  for (const [name, places] of exitPlaces)
    if (places.length > 1)
      ds.push(
        diag('EXIT_NAME_REUSED', 'warning', STAGE, `The exit name "${name}" is used ${places.length} times (${[...new Set(places)].join(', ')}), so the game can't tell those exits apart.`, {
          remediation: 'Give each exit its own name, unless the game should do the same thing at each of them.',
          exportBlocked: false,
        }),
      );

  // Cues: one that would play a sound but has none attached plays nothing in Playtest or the web page (only a game
  // that supplies its own clip), and a name that's one or two letters off another is most likely a typo.
  const cueUses = new Map<string, { count: number; passageId: string; hasSound: boolean; wants: boolean }>();
  for (const p of passages)
    for (const b of p.content) {
      if (b.type !== 'cue') continue;
      const tag = cueTag(b.name, b.value);
      const u = cueUses.get(tag) ?? { count: 0, passageId: p.id, hasSound: false, wants: cueWantsSound(b.name, b.value) };
      u.count++;
      u.hasSound ||= !!b.audio;
      cueUses.set(tag, u);
    }
  for (const [tag, u] of cueUses)
    if (u.wants && !u.hasSound)
      ds.push(
        diag('CUE_WITHOUT_SOUND', 'info', STAGE, `The cue "${tag.replace(':', ': ')}" has no sound attached${u.count > 1 ? ` (it's used ${u.count} times)` : ''}, so it's silent in Playtest and the playable story.`, {
          entityId: u.passageId,
          details: { passageId: u.passageId },
          remediation: 'Attach a sound to it in Review, or leave it for the game to supply.',
          exportBlocked: false,
        }),
      );
  const nameCounts = new Map<string, { count: number; passageId: string }>();
  for (const p of passages) for (const b of p.content) if (b.type === 'cue') {
    const n = nameCounts.get(b.name) ?? { count: 0, passageId: p.id };
    n.count++;
    nameCounts.set(b.name, n);
  }
  const KNOWN_CUES = ['music', 'sound', 'ambience', 'shake', 'stop_music', 'stop_ambience'];
  for (const [name, n] of nameCounts) {
    if (KNOWN_CUES.includes(name)) continue;
    // The likeliest meant name: a known one, or another cue used more often.
    const others = [...KNOWN_CUES, ...[...nameCounts].filter(([m, o]) => m !== name && o.count > n.count).map(([m]) => m)];
    const near = others.find((o) => o !== name && Math.abs(o.length - name.length) <= 2 && editDistance(o, name) <= (name.length > 5 ? 2 : 1));
    if (near)
      ds.push(
        diag('CUE_NAME_TYPO', 'warning', STAGE, `The cue "${name}" looks like a typo for "${near}", so the game would treat it as a different cue.`, {
          entityId: n.passageId,
          details: { passageId: n.passageId },
          remediation: `Rename it to "${near}" in Review, unless it really is a different cue.`,
          exportBlocked: false,
        }),
      );
  }

  // Reachability over approved edges.
  const reachable = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const e of edges) if (!e.pending) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const queue = byId.has(start) ? [start] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    queue.push(...(adj.get(id) ?? []));
  }
  for (const p of passages)
    if (!reachable.has(p.id) && byId.has(start))
      ds.push(diag('UNREACHABLE_PASSAGE', 'warning', STAGE, `No path from the start reaches "${p.title}".`, { entityId: p.id, remediation: 'Add a choice or divert that leads here, or remove it.', exportBlocked: false }));

  const endings = passages.filter((p) => p.isEnding || p.divert === 'END' || p.choices.some((c) => isActive(c.review) && c.target === 'END')).map((p) => p.id);
  if (!project.inkPassthrough && !endings.some((e) => reachable.has(e)))
    ds.push(diag('NO_REACHABLE_ENDING', 'warning', STAGE, 'No ending can be reached from the start passage.', { remediation: 'Mark at least one passage as an ending.', exportBlocked: false }));

  for (const id of usedItems)
    if (items.has(id) && !givenItems.has(id) && passages.some((p) => p.choices.some((c) => isActive(c.review) && c.conditions.some((x) => conditionItemIds(x).has(id)))))
    {
      const giver = pendingGivers.get(id);
      if (giver)
        ds.push(diag('ITEM_GIVEN_ONLY_BY_SUGGESTION', 'review', STAGE, `Only ${giver.label} gives "${id}", and it's still waiting for approval. Until you approve it, the choice that needs "${id}" can't be taken.`, { entityId: giver.entityId, details: { passageId: giver.passageId, itemId: id }, remediation: 'Approve it in the Review tab.', exportBlocked: false }));
      else
        ds.push(diag('ITEM_NEVER_ACQUIRED', 'warning', STAGE, `Item "${id}" gates a choice but nothing ever gives it — that choice can never be taken.`, { entityId: id, remediation: `Give the player "${id}" somewhere reachable: use "+ Effect" in Review to give it (or write "@give ${id}" in the script).`, exportBlocked: false }));
    }
  for (const v of project.variables)
    if (!readVars.has(v.id) && !project.inkPassthrough)
      ds.push(diag('UNUSED_VARIABLE', 'info', STAGE, `Variable "${v.id}" is declared but never read.`, { entityId: v.id, exportBlocked: false }));
  for (const i of project.items)
    if (!usedItems.has(i.id) && i.origin !== 'generated')
      ds.push(diag('UNUSED_ITEM', 'info', STAGE, `Item "${i.id}" is declared but never used.`, { entityId: i.id, exportBlocked: false }));

  const graph: StoryGraph = {
    nodes: passages.map((p) => ({ id: p.id, title: p.title, isEnding: endings.includes(p.id), isStart: p.id === start, reachable: reachable.has(p.id), origin: p.origin })),
    edges,
  };
  return { graph, diagnostics: ds, reachable, endings };
}

function walkCompare(c: Condition, f: (c: Extract<Condition, { type: 'compare' }>) => void) {
  if (c.type === 'compare') f(c);
  else if (c.type === 'not') walkCompare(c.condition, f);
  else if (c.type === 'and' || c.type === 'or') c.conditions.forEach((x) => walkCompare(x, f));
}

/** How many single-letter edits (or swaps of two neighbouring letters) turn one word into another. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
