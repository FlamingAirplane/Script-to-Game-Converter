import { slugify, type Choice, type Passage, type StoryProject } from './isr';

// Interactive adaptation (deterministic, local — no external AI). Proposes reviewable branches
// grounded in the source text; nothing proposed here is emitted to Ink until a human approves it.
//
//  1. Optional item pickup: an action like "Mira pockets the brass key." becomes a choice pair
//     [Take the brass key] / [Leave it] in that scene.
//  2. Item-gated progression: a later scene where that item is used ("she unlocks the door with
//     the key") is gated in the preceding scene behind {has key}, with a [Go back] option to the
//     pickup scene so the story stays completable.

const ACQUIRE =
  /\b(?:picks? up|takes?|grabs?|pockets?|finds?|retrieves?|snatches?|collects?|pulls? out|lifts?)\s+(?:the|a|an|his|her|their|its)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*){0,2})/i;
const PHRASE_STOP = new Set(['from', 'off', 'out', 'on', 'in', 'into', 'and', 'with', 'to', 'of', 'at', 'under', 'behind', 'over', 'up', 'down', 'as', 'before', 'then']);

function trimPhrase(phrase: string): string {
  const words: string[] = [];
  for (const w of phrase.toLowerCase().split(/\s+/)) {
    if (PHRASE_STOP.has(w)) break;
    words.push(w);
  }
  return words.join(' ');
}
const USE_VERBS = /\b(?:unlocks?|opens?|uses?|inserts?|turns?|reads?|shows?|plays?|lights?|wields?|swipes?)\b/i;
const STOP_NOUNS = new Set(['moment', 'breath', 'look', 'step', 'seat', 'lead', 'chance', 'hint', 'beat', 'turn', 'hand', 'way', 'time', 'deep breath']);

function headNoun(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  return words[words.length - 1].toLowerCase();
}

export function proposeAdaptations(project: StoryProject): void {
  const passages = project.passages;
  const choiceIds = new Set(passages.flatMap((p) => p.choices.map((c) => c.id)));
  const newChoice = (p: Passage, text: string, target: string, extra: Partial<Choice> = {}): Choice => {
    let id = slugify(`${p.id}_${text}`) || 'choice';
    let n = 2;
    while (choiceIds.has(id)) id = `${slugify(`${p.id}_${text}`)}_${n++}`;
    choiceIds.add(id);
    return { id, text, target, conditions: [], effects: [], once: false, origin: 'generated', review: 'pending', ...extra };
  };

  const found: { itemId: string; noun: string; display: string; index: number }[] = [];
  passages.forEach((p, index) => {
    if (p.choices.length || !p.divert) return;
    for (const block of p.content) {
      if (block.type !== 'action') continue;
      const m = ACQUIRE.exec(block.text);
      if (!m) continue;
      const display = trimPhrase(m[1]);
      if (!display) continue;
      const noun = headNoun(display);
      if (STOP_NOUNS.has(noun) || STOP_NOUNS.has(display)) continue;
      const itemId = slugify(display);
      if (!itemId || project.items.some((i) => i.id === itemId) || found.some((f) => f.itemId === itemId)) continue;
      project.items.push({ id: itemId, displayName: display.replace(/\b\w/g, (c) => c.toUpperCase()), consumable: false, origin: 'generated' });
      p.choices.push(
        newChoice(p, `Take the ${display}`, p.divert!, { effects: [{ type: 'give_item', itemId }] }),
        newChoice(p, 'Leave it', p.divert!),
      );
      found.push({ itemId, noun, display, index });
      break;
    }
  });

  for (const f of found) {
    const nounRe = new RegExp(`\\b${f.noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
    for (let i = f.index + 1; i < passages.length; i++) {
      const p = passages[i];
      const usesItem = p.content.some((b) => b.type === 'action' && nounRe.test(b.text) && USE_VERBS.test(b.text));
      if (!usesItem) continue;
      const prev = passages.find((q) => q.divert === p.id && q.choices.length === 0);
      if (!prev) break;
      prev.choices.push(
        newChoice(prev, `Use the ${f.display}`, p.id, { conditions: [{ type: 'has_item', itemId: f.itemId }] }),
        newChoice(prev, `Go back to ${passages[f.index].title}`, passages[f.index].id),
      );
      break;
    }
  }
}

/** Approve or reject every pending generated element at once. */
/** How many suggestions (choices and effects) are still waiting for approval. */
export function pendingSuggestions(project: StoryProject): number {
  let n = 0;
  for (const p of project.passages) {
    n += p.choices.filter((c) => c.review === 'pending').length;
    n += p.content.filter((b) => b.type === 'effect' && b.review === 'pending').length;
  }
  return n;
}

export function reviewAll(project: StoryProject, status: 'approved' | 'rejected'): void {
  for (const p of project.passages) {
    for (const c of p.choices) if (c.review === 'pending') c.review = status;
    for (const b of p.content) if (b.type === 'effect' && b.review === 'pending') b.review = status;
  }
}
