import { uniqueId, type Choice, type Passage, type StoryProject } from '../core/isr';

// Pure editing operations on the ISR used by the review UI. Every edit made here is recorded
// with user_authored provenance so regeneration never silently loses it.

export function renamePassage(p: StoryProject, from: string, to: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) return 'Use letters, digits and underscores; do not start with a digit.';
  if (p.passages.some((x) => x.id === to)) return `"${to}" is already used.`;
  if (['END', 'DONE'].includes(to.toUpperCase())) return 'That name is reserved by Ink.';
  for (const ps of p.passages) {
    if (ps.id === from) ps.id = to;
    if (ps.divert === from) ps.divert = to;
    for (const c of ps.choices) if (c.target === from) c.target = to;
  }
  if (p.project.startPassage === from) p.project.startPassage = to;
  return null;
}

export function addPassage(p: StoryProject, afterId?: string): Passage {
  const taken = new Set(p.passages.map((x) => x.id));
  const id = uniqueId('new_passage', taken);
  const passage: Passage = { id, title: 'New Passage', content: [], choices: [], isEnding: true, origin: 'user_authored', review: 'approved' };
  const idx = afterId ? p.passages.findIndex((x) => x.id === afterId) : -1;
  if (idx >= 0) p.passages.splice(idx + 1, 0, passage);
  else p.passages.push(passage);
  return passage;
}

export function deletePassage(p: StoryProject, id: string) {
  p.passages = p.passages.filter((x) => x.id !== id);
  // References are kept on purpose: the analyzer reports them as missing destinations to fix.
  if (p.project.startPassage === id) p.project.startPassage = p.passages[0]?.id ?? '';
}

export function addChoice(p: StoryProject, passageId: string): Choice | null {
  const ps = p.passages.find((x) => x.id === passageId);
  if (!ps) return null;
  const ids = new Set(p.passages.flatMap((x) => x.choices.map((c) => c.id)));
  const choice: Choice = {
    id: uniqueId(`${passageId}_choice`, ids),
    text: 'New choice',
    target: ps.divert && ps.divert !== 'END' ? ps.divert : p.passages.find((x) => x.id !== passageId)?.id ?? 'END',
    conditions: [],
    effects: [],
    once: false,
    origin: 'user_authored',
    review: 'approved',
  };
  ps.choices.push(choice);
  ps.isEnding = false;
  return choice;
}

export function findPassage(p: StoryProject, id: string | undefined): Passage | undefined {
  return p.passages.find((x) => x.id === id);
}

/** Resolve a diagnostic's entity id to the passage that contains it. */
export function passageForEntity(p: StoryProject, entityId?: string, passageHint?: unknown): string | undefined {
  if (typeof passageHint === 'string' && p.passages.some((x) => x.id === passageHint)) return passageHint;
  if (!entityId) return undefined;
  if (p.passages.some((x) => x.id === entityId)) return entityId;
  return p.passages.find((x) => x.choices.some((c) => c.id === entityId))?.id;
}
