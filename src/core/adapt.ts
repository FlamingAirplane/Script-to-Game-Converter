import { slugify, type Choice, type StoryProject } from './isr';
import type { Proposal, Suggester } from './proposals';

// Interactive adaptation (deterministic, local — no external AI). Proposes reviewable branches
// grounded in the source text; nothing proposed here is emitted to Ink until a human approves it.
// The rules return Proposals (see proposals.ts), which applyProposals checks and writes.
//
//  1. Optional item pickup: an action like "Mira pockets the brass key." becomes a choice pair
//     [Take the brass key] / [Leave it] in that scene.
//  2. Item-gated progression: a later scene where that item is used ("she unlocks the door with
//     the key") is gated in the preceding scene behind {has key}, with a [Go back] option to the
//     pickup scene so the story stays completable.

export const ACQUIRE =
  /\b(?:picks? up|takes?|grabs?|pockets?|finds?|retrieves?|snatches?|collects?|pulls? out|lifts?)\s+(?:the|a|an|his|her|their|its)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})/i;
const PHRASE_STOP = new Set(['from', 'off', 'out', 'on', 'in', 'into', 'and', 'with', 'to', 'of', 'at', 'under', 'behind', 'over', 'up', 'down', 'as', 'before', 'then']);

/** The item named in a phrase, cut at the first preposition: "brass key from the mantel" → "brass key". */
export function trimPhrase(phrase: string): string {
  const words: string[] = [];
  for (const w of phrase.toLowerCase().split(/\s+/)) {
    if (PHRASE_STOP.has(w)) break;
    words.push(w);
  }
  return words.join(' ');
}
export const USE_VERBS = /\b(?:unlocks?|opens?|uses?|inserts?|turns?|reads?|shows?|plays?|lights?|wields?|swipes?)\b/i;
const STOP_NOUNS = new Set(['moment', 'breath', 'look', 'step', 'seat', 'lead', 'chance', 'hint', 'beat', 'turn', 'hand', 'way', 'time', 'deep breath']);

export function headNoun(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  return words[words.length - 1].toLowerCase();
}

/** An item's display name from the phrase in the script: "brass key" → "Brass Key". */
export function itemDisplayName(display: string): string {
  return display.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** An item a pickup proposal declares, and where: `index` is the pickup passage's position in the project. */
export interface FoundItem {
  itemId: string;
  noun: string;
  display: string;
  index: number;
}

export interface PickupOptions {
  /** The regex to find pickups with; its first group is the item phrase. Default: ACQUIRE. */
  pattern?: RegExp;
  suggester?: string;
  /** Passages another suggester has already claimed; filled in with the passages this call claims. */
  claimed?: Set<string>;
  /** Item ids no proposal may declare again (beyond the project's own). */
  knownItems?: Set<string>;
}

/**
 * Rule 1: in a passage with no choices and a next passage, the first action line that has someone pick an
 * item up proposes [Take the <item>] (gives it) and [Leave it], both leading on. One pickup per passage.
 */
export function pickupProposals(project: StoryProject, opts: PickupOptions = {}): { proposals: Proposal[]; found: FoundItem[] } {
  const pattern = opts.pattern ?? ACQUIRE;
  const suggester = opts.suggester ?? 'heuristic';
  const claimed = opts.claimed ?? new Set<string>();
  const known = new Set([...project.items.map((i) => i.id), ...(opts.knownItems ?? [])]);
  const proposals: Proposal[] = [];
  const found: FoundItem[] = [];
  project.passages.forEach((p, index) => {
    if (p.choices.length || !p.divert || claimed.has(p.id)) return;
    for (const [evidence, block] of p.content.entries()) {
      if (block.type !== 'action') continue;
      const m = pattern.exec(block.text);
      if (!m) continue;
      const display = trimPhrase(m[1]);
      if (!display) continue;
      const noun = headNoun(display);
      if (STOP_NOUNS.has(noun) || STOP_NOUNS.has(display)) continue;
      const itemId = slugify(display);
      if (!itemId || known.has(itemId) || found.some((f) => f.itemId === itemId)) continue;
      proposals.push({
        kind: 'pickup',
        passageId: p.id,
        evidence,
        suggester,
        newItems: [{ id: itemId, displayName: itemDisplayName(display) }],
        choices: [
          { text: `Take the ${display}`, target: p.divert, effects: [{ type: 'give_item', itemId }] },
          { text: 'Leave it', target: p.divert },
        ],
      });
      found.push({ itemId, noun, display, index });
      claimed.add(p.id);
      break;
    }
  });
  return { proposals, found };
}

/**
 * Rule 2: the first later action line that uses a found item (its noun with a verb such as "unlocks") gates
 * that scene: the passage before it, if it has no choices, gets [Use the <item>] (needs it) and
 * [Go back to <pickup scene>]. The evidence is the line where the item is used.
 */
export function gateProposals(project: StoryProject, found: FoundItem[], claimed: Set<string>, suggester = 'heuristic'): Proposal[] {
  const passages = project.passages;
  const proposals: Proposal[] = [];
  for (const f of found) {
    const nounRe = new RegExp(`\\b${f.noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
    for (let i = f.index + 1; i < passages.length; i++) {
      const p = passages[i];
      const evidence = p.content.findIndex((b) => b.type === 'action' && nounRe.test(b.text) && USE_VERBS.test(b.text));
      if (evidence < 0) continue;
      const prev = passages.find((q) => q.divert === p.id && q.choices.length === 0 && !claimed.has(q.id));
      if (!prev) break;
      proposals.push({
        kind: 'gate',
        passageId: prev.id,
        evidence,
        evidencePassageId: p.id,
        suggester,
        choices: [
          { text: `Use the ${f.display}`, target: p.id, conditions: [{ type: 'has_item', itemId: f.itemId }] },
          { text: `Go back to ${passages[f.index].title}`, target: passages[f.index].id },
        ],
      });
      claimed.add(prev.id);
      break;
    }
  }
  return proposals;
}

/** Today's two regex rules as a Suggester: pickups first, then the gates for the items they found. */
export const heuristicSuggester: Suggester = {
  id: 'heuristic',
  async suggest(project) {
    const claimed = new Set<string>();
    const { proposals, found } = pickupProposals(project, { claimed });
    return [...proposals, ...gateProposals(project, found, claimed)];
  },
};

/** How many suggestions (choices and effects) are still waiting for approval. */
export function pendingSuggestions(project: StoryProject): number {
  let n = 0;
  for (const p of project.passages) {
    n += p.choices.filter((c) => c.review === 'pending').length;
    n += p.content.filter((b) => b.type === 'effect' && b.review === 'pending').length;
  }
  return n;
}

/** A model's suggestion (see src/suggest/model.ts), as opposed to a rule's or a person's. */
export function isModelSuggestion(c: Pick<Choice, 'suggester'>): boolean {
  return !!c.suggester && c.suggester.startsWith('model:');
}

/** Which suggestions a bulk review touches: a model's, everything else's (rules and pending effects), or all. */
export type ReviewScope = 'all' | 'model' | 'not_model';

/** Approve or reject every pending generated element at once (or only a model's, or only the rest). */
export function reviewAll(project: StoryProject, status: 'approved' | 'rejected', scope: ReviewScope = 'all'): void {
  const takes = (c: Pick<Choice, 'suggester'>) => scope === 'all' || (scope === 'model') === isModelSuggestion(c);
  for (const p of project.passages) {
    for (const c of p.choices) if (c.review === 'pending' && takes(c)) c.review = status;
    if (scope !== 'model') for (const b of p.content) if (b.type === 'effect' && b.review === 'pending') b.review = status;
  }
}
