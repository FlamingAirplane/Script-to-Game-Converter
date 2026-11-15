// Suggestions as data. Any suggester (the regex heuristics, the cheap rules, an on-device model) returns
// Proposals; applyProposals is the only code that writes suggestions into a project. A proposal is a group
// of choices accepted or dropped as one, pointed at the line of the script that prompted it. Every
// proposal passes six deterministic checks before it is written, and what is written is exactly what the
// heuristics wrote before: origin 'generated', review 'pending', so nothing reaches Ink until a person approves it.

import { analyze } from './analyzer';
import { diag, type Diagnostic } from './diagnostics';
import { conditionItemIds, conditionVarIds, slugify, type Choice, type Condition, type Effect, type Passage, type StoryProject } from './isr';

export type ProposalKind = 'pickup' | 'gate' | 'reply' | 'decision';
export const PROPOSAL_KINDS: readonly ProposalKind[] = ['pickup', 'gate', 'reply', 'decision'];

/** The longest label a suggested choice may have. */
export const MAX_LABEL_LENGTH = 60;

export interface ProposedChoice {
  text: string;
  target: string; // an existing passage id, or 'END'
  conditions?: Condition[]; // the typed trees from isr.ts
  effects?: Effect[];
  once?: boolean;
}

export interface Proposal {
  kind: ProposalKind;
  /** Where the choices go. */
  passageId: string;
  /** Index in the evidence passage's content of the line that prompts it (code looks the text up; nothing is quoted). */
  evidence: number;
  /** The passage holding the evidence line when it isn't `passageId` (a gate's evidence is the scene the item is used in). */
  evidencePassageId?: string;
  /** Added together, or not at all. */
  choices: ProposedChoice[];
  newItems?: { id: string; displayName: string }[];
  newVariables?: { id: string; type: 'bool'; initial: false }[];
  /** 'heuristic', 'rule:<name>' or 'model:<name>@<revision>'. */
  suggester: string;
}

export interface SuggestOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface Suggester {
  id: string;
  suggest(project: StoryProject, opts?: SuggestOptions): Promise<Proposal[]>;
}

export const SUGGESTION_DROPPED = 'SUGGESTION_DROPPED';

export type ProposalCheck = 'shape' | 'references' | 'evidence' | 'fit' | 'one_per_passage' | 'completable';

const KIND_LABEL: Record<ProposalKind, string> = { pickup: 'item pickup', gate: 'locked path', reply: 'reply', decision: 'decision' };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Problems that a proposal must not add to the story once everything is approved (check 6). */
const COMPLETION_CODES = new Set(['NO_REACHABLE_ENDING', 'UNREACHABLE_PASSAGE', 'ALL_CHOICES_CONDITIONAL', 'ITEM_NEVER_ACQUIRED']);

/**
 * Checks every proposal and writes the ones that pass into the project as pending generated choices (and
 * their new items and variables). Heuristic proposals are applied first, so a project's default output never
 * changes. Returns one SUGGESTION_DROPPED note per proposal that failed, with `details.index` naming it.
 */
export function applyProposals(project: StoryProject, proposals: Proposal[]): Diagnostic[] {
  const dropped: Diagnostic[] = [];
  const indexed = proposals.map((proposal, index) => ({ proposal, index }));
  const ordered = [...indexed.filter((x) => x.proposal?.suggester === 'heuristic'), ...indexed.filter((x) => x.proposal?.suggester !== 'heuristic')];
  const byId = new Map(project.passages.map((p) => [p.id, p]));
  const choiceIds = new Set(project.passages.flatMap((p) => p.choices.map((c) => c.id)));
  const hadChoices = new Set(project.passages.filter((p) => p.choices.length).map((p) => p.id));
  const claimed = new Set<string>();
  // Check 6 compares against what the story reports before any proposal, with everything pending approved.
  let approved = approveAll(lightClone(project));
  let approvedIds = new Set(choiceIds);
  const baseline = completionKeys(approved);

  for (const { proposal, index } of ordered) {
    const drop = (check: ProposalCheck, reason: string) => {
      const passage = typeof proposal?.passageId === 'string' ? byId.get(proposal.passageId) : undefined;
      const kind = PROPOSAL_KINDS.includes(proposal?.kind) ? KIND_LABEL[proposal.kind] : 'choice';
      const where = passage ? `"${passage.title}"` : typeof proposal?.passageId === 'string' ? `"${proposal.passageId}"` : 'a passage';
      dropped.push(
        diag(SUGGESTION_DROPPED, 'info', 'story_validation', `A suggested ${kind} for ${where} was set aside: ${reason}.`, {
          entityId: passage?.id ?? (typeof proposal?.passageId === 'string' ? proposal.passageId : undefined),
          details: { index, check, kind: proposal?.kind, suggester: proposal?.suggester, passageId: proposal?.passageId, labels: Array.isArray(proposal?.choices) ? proposal.choices.map((c) => c?.text) : undefined },
          exportBlocked: false,
        }),
      );
    };
    const shape = shapeProblem(proposal);
    if (shape) {
      drop('shape', shape);
      continue;
    }
    const refs = referenceProblem(project, proposal, byId);
    if (refs) {
      drop('references', refs);
      continue;
    }
    const evidencePassage = byId.get(proposal.evidencePassageId ?? proposal.passageId)!;
    const evidence = evidencePassage.content[proposal.evidence];
    if (!Number.isInteger(proposal.evidence) || proposal.evidence < 0 || !evidence) {
      drop('evidence', `line ${proposal.evidence + 1} is not in "${evidencePassage.title}"`);
      continue;
    }
    if (evidence.type !== 'action' && evidence.type !== 'dialogue') {
      drop('evidence', 'the line that prompted it is not action or dialogue');
      continue;
    }
    const passage = byId.get(proposal.passageId)!;
    const fit = fitProblem(project, passage, hadChoices.has(passage.id));
    if (fit) {
      drop('fit', fit);
      continue;
    }
    if (claimed.has(passage.id)) {
      drop('one_per_passage', 'another suggestion already adds choices to this passage');
      continue;
    }
    // Check 6: with every suggestion approved, the story must still be completable.
    const trial = lightClone(approved);
    const trialIds = new Set(approvedIds);
    write(trial, proposal, trialIds, 'approved');
    const fresh = [...completionKeys(trial)].filter((k) => !baseline.has(k));
    if (fresh.length) {
      drop('completable', `once approved, the story would report ${describeKeys(fresh, trial)}`);
      continue;
    }
    approved = trial;
    approvedIds = trialIds;
    write(project, proposal, choiceIds, 'pending');
    claimed.add(passage.id);
  }
  return dropped;
}

/** Check 1: the proposal has the right shape; labels are present, short enough and distinct. */
function shapeProblem(p: unknown): string | null {
  if (!isObj(p)) return 'it is not an object';
  if (!PROPOSAL_KINDS.includes(p.kind as ProposalKind)) return `"${String(p.kind)}" is not a kind of suggestion`;
  if (typeof p.passageId !== 'string' || !p.passageId) return 'it names no passage';
  if (typeof p.evidence !== 'number' || !Number.isInteger(p.evidence)) return 'it names no line';
  if (p.evidencePassageId !== undefined && (typeof p.evidencePassageId !== 'string' || !p.evidencePassageId)) return 'its evidence passage is not a passage id';
  if (typeof p.suggester !== 'string' || !p.suggester) return 'it names no suggester';
  if (!Array.isArray(p.choices) || p.choices.length === 0) return 'it has no choices';
  const seen = new Map<string, string>();
  for (const c of p.choices) {
    if (!isObj(c)) return 'a choice is not an object';
    if (typeof c.text !== 'string' || !c.text.trim()) return 'a label is empty';
    if (c.text.length > MAX_LABEL_LENGTH) return `a label is longer than ${MAX_LABEL_LENGTH} characters`;
    const key = c.text.trim().toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) return `two choices have the same label "${first}"`;
    seen.set(key, c.text.trim());
    if (typeof c.target !== 'string' || !c.target) return `"${c.text.trim()}" leads nowhere`;
    if (c.conditions !== undefined && (!Array.isArray(c.conditions) || !c.conditions.every(isCondition))) return `"${c.text.trim()}" has a malformed condition`;
    if (c.effects !== undefined && (!Array.isArray(c.effects) || !c.effects.every(isEffect))) return `"${c.text.trim()}" has a malformed effect`;
    if (c.once !== undefined && typeof c.once !== 'boolean') return `"${c.text.trim()}" has a malformed once flag`;
  }
  if (p.newItems !== undefined && (!Array.isArray(p.newItems) || !p.newItems.every((i) => isObj(i) && typeof i.id === 'string' && typeof i.displayName === 'string' && i.displayName.trim())))
    return 'a new item is malformed';
  if (p.newVariables !== undefined && (!Array.isArray(p.newVariables) || !p.newVariables.every((v) => isObj(v) && typeof v.id === 'string' && v.type === 'bool' && v.initial === false)))
    return 'a new variable is malformed';
  return null;
}

/** Check 2: every passage, item and variable it names exists (or is declared by the proposal itself). */
function referenceProblem(project: StoryProject, p: Proposal, byId: Map<string, Passage>): string | null {
  if (!byId.has(p.passageId)) return `passage "${p.passageId}" does not exist`;
  if (p.evidencePassageId && !byId.has(p.evidencePassageId)) return `passage "${p.evidencePassageId}" does not exist`;
  const items = new Set(project.items.map((i) => i.id));
  const vars = new Set(project.variables.map((v) => v.id));
  for (const i of p.newItems ?? []) {
    if (!IDENTIFIER.test(i.id)) return `"${i.id}" is not a valid item id`;
    if (items.has(i.id) || vars.has(i.id) || vars.has(`has_${i.id}`)) return `item "${i.id}" already exists`;
    items.add(i.id);
  }
  for (const v of p.newVariables ?? []) {
    if (!IDENTIFIER.test(v.id)) return `"${v.id}" is not a valid variable id`;
    if (vars.has(v.id) || items.has(v.id)) return `variable "${v.id}" already exists`;
    vars.add(v.id);
  }
  for (const c of p.choices) {
    if (c.target !== 'END' && !byId.has(c.target)) return `"${c.text.trim()}" leads to "${c.target}", which does not exist`;
    for (const cond of c.conditions ?? []) {
      for (const id of conditionItemIds(cond)) if (!items.has(id)) return `item "${id}" does not exist`;
      for (const id of conditionVarIds(cond)) if (!vars.has(id)) return `variable "${id}" does not exist`;
    }
    for (const e of c.effects ?? []) {
      if (e.type === 'give_item' || e.type === 'take_item') {
        if (!items.has(e.itemId)) return `item "${e.itemId}" does not exist`;
      } else if (!vars.has(e.variableId)) return `variable "${e.variableId}" does not exist`;
    }
  }
  return null;
}

/** Check 4: the passage can take a choice menu at its end (judged as it was before this batch; check 5 covers the batch). */
function fitProblem(project: StoryProject, p: Passage, hadChoices: boolean): string | null {
  if (project.inkPassthrough !== undefined) return 'the Ink is kept exactly as written';
  if (hadChoices) return 'the passage already has choices';
  if (!p.divert) return 'the passage has no next passage';
  if (p.isEnding) return 'the passage is an ending';
  if (p.cutscene) return 'the passage is a cutscene';
  return null;
}

/** Writes a checked proposal: new items and variables, then its choices, with ids made as the heuristics always made them. */
function write(project: StoryProject, p: Proposal, choiceIds: Set<string>, review: Choice['review']): void {
  const passage = project.passages.find((x) => x.id === p.passageId)!;
  const evidence = project.passages.find((x) => x.id === (p.evidencePassageId ?? p.passageId))!.content[p.evidence];
  for (const i of p.newItems ?? []) project.items.push({ id: i.id, displayName: i.displayName, consumable: false, origin: 'generated' });
  for (const v of p.newVariables ?? []) project.variables.push({ id: v.id, type: 'bool', initial: false, origin: 'generated' });
  for (const c of p.choices) {
    let id = slugify(`${passage.id}_${c.text}`) || 'choice';
    let n = 2;
    while (choiceIds.has(id)) id = `${slugify(`${passage.id}_${c.text}`)}_${n++}`;
    choiceIds.add(id);
    passage.choices.push({
      id,
      text: c.text,
      target: c.target,
      conditions: c.conditions ?? [],
      effects: c.effects ?? [],
      once: c.once ?? false,
      origin: 'generated',
      review,
      suggester: p.suggester,
      ...(evidence?.source ? { source: evidence.source } : {}),
    });
  }
}

function completionKeys(project: StoryProject): Set<string> {
  return new Set(analyze(project).diagnostics.filter((d) => COMPLETION_CODES.has(d.code)).map((d) => `${d.code}:${d.entityId ?? ''}`));
}

function describeKeys(keys: string[], project: StoryProject): string {
  return keys
    .map((k) => {
      const [code, entityId] = k.split(':');
      const title = project.passages.find((p) => p.id === entityId)?.title ?? entityId;
      return `${code.toLowerCase().replace(/_/g, ' ')}${title ? ` (${title})` : ''}`;
    })
    .join(', ');
}

/** A copy for trial analysis: everything but the source texts, which analysis never reads. */
function lightClone(project: StoryProject): StoryProject {
  return structuredClone({ ...project, sources: [] });
}

function approveAll(project: StoryProject): StoryProject {
  for (const p of project.passages) {
    for (const c of p.choices) if (c.review === 'pending') c.review = 'approved';
    for (const b of p.content) if (b.type === 'effect' && b.review === 'pending') b.review = 'approved';
  }
  return project;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isCondition(c: unknown): c is Condition {
  if (!isObj(c)) return false;
  switch (c.type) {
    case 'has_item': return typeof c.itemId === 'string';
    case 'not': return isCondition(c.condition);
    case 'compare': return typeof c.variableId === 'string' && ['==', '!=', '>', '>=', '<', '<='].includes(c.op as string) && ['boolean', 'number', 'string'].includes(typeof c.value);
    case 'and': case 'or': return Array.isArray(c.conditions) && c.conditions.every(isCondition);
    default: return false;
  }
}

function isEffect(e: unknown): e is Effect {
  if (!isObj(e)) return false;
  switch (e.type) {
    case 'give_item': case 'take_item': return typeof e.itemId === 'string';
    case 'set_var': return typeof e.variableId === 'string' && ['boolean', 'number', 'string'].includes(typeof e.value);
    case 'add_var': return typeof e.variableId === 'string' && typeof e.amount === 'number';
    default: return false;
  }
}

/**
 * A suggested label made presentable: whitespace tidied, quotes and a trailing full stop dropped, sentence
 * case, and cut at a word to fit MAX_LABEL_LENGTH. Returns '' when nothing is left.
 */
export function cleanLabel(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  s = s.replace(/\.+$/, '').trim();
  if (!s) return '';
  s = s[0].toUpperCase() + s.slice(1);
  if (s.length > MAX_LABEL_LENGTH) {
    const cut = s.slice(0, MAX_LABEL_LENGTH - 1);
    const at = cut.lastIndexOf(' ');
    s = `${(at > MAX_LABEL_LENGTH / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`;
  }
  return s;
}

/** The first sentence of a line: up to its first full stop, question mark or exclamation mark. */
export function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(?:\s|$)/.exec(text.trim());
  return (m ? m[1] : text).trim();
}
