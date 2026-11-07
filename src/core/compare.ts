import { describeCondition } from './gating';
import { isActive, type ContentBlock, type Effect, type Passage, type StoryProject } from './isr';
import { storyStats } from './stats';

// Compares two versions of a story (a draft and the story now) the way a writer reads it: which passages
// were added, removed or renamed, and, inside each changed passage, which lines and choices changed.
// Passages are matched by id, so a renamed passage is a change, not a removal and an addition.

export type LineChange = { kind: 'same' | 'added' | 'removed'; text: string };

export interface PassageChange {
  id: string;
  title: string;
  /** The title it had before, when it was renamed. */
  oldTitle?: string;
  status: 'added' | 'removed' | 'changed';
  /** Every line of the passage (heading, text, choices), marked as kept, added or removed. */
  lines: LineChange[];
  added: number;
  removed: number;
}

export interface StoryComparison {
  passages: PassageChange[];
  /** How many passages are the same in both. */
  unchanged: number;
  words: { before: number; after: number };
  characters: { added: string[]; removed: string[] };
  startChanged?: { before: string; after: string };
}

function effectText(e: Effect, p: StoryProject): string {
  const item = (id: string) => p.items.find((i) => i.id === id)?.displayName ?? id;
  const v = (id: string) => id;
  switch (e.type) {
    case 'give_item':
      return `gives ${item(e.itemId)}`;
    case 'take_item':
      return `takes ${item(e.itemId)}`;
    case 'set_var':
      return `sets ${v(e.variableId)} to ${String(e.value)}`;
    case 'add_var':
      return `${e.amount < 0 ? 'takes' : 'adds'} ${Math.abs(e.amount)} ${e.amount < 0 ? 'from' : 'to'} ${v(e.variableId)}`;
  }
}

function blockLines(b: ContentBlock, p: StoryProject): string[] {
  const name = (id: string) => (p.characters.find((c) => c.id === id)?.displayName ?? id).toUpperCase();
  switch (b.type) {
    case 'dialogue':
      return [`${name(b.speakerId)}${b.extension ? ` (${b.extension})` : ''}${b.parenthetical ? ` (${b.parenthetical.replace(/^\(|\)$/g, '')})` : ''}: ${b.text}`];
    case 'action':
      return b.text.split('\n').filter((t) => t.trim());
    case 'transition':
      return [b.text];
    case 'note':
      return [`[note] ${b.text}`];
    case 'effect':
      return [`[${effectText(b.effect, p)}]`];
    case 'unsupported':
      return [`[kept as written] ${b.text}`];
    case 'pause':
      return ['[Continue]'];
    case 'exit':
      return [`[back to the game: ${b.name}]`];
    case 'cue':
      return [`[cue ${b.name}${b.value ? `: ${b.value}` : ''}]`];
  }
}

/** A passage as the lines a writer would read: its heading, its text, its choices and where it goes. */
export function passageLines(pa: Passage, p: StoryProject, titleOf: (id: string) => string | undefined = (id) => p.passages.find((x) => x.id === id)?.title): string[] {
  const title = (id: string) => (id === 'END' ? 'the end' : (titleOf(id) ?? id));
  const out: string[] = [];
  if (pa.sceneHeading) out.push(pa.sceneHeading);
  for (const b of pa.content) out.push(...blockLines(b, p));
  for (const c of pa.choices) {
    if (!isActive(c.review)) continue;
    const needs = c.conditions.map((x) => describeCondition(x, p));
    const does = c.effects.map((e) => effectText(e, p));
    out.push(`▸ ${c.text} → ${title(c.target)}${needs.length ? ` (needs ${needs.join(', ')})` : ''}${does.length ? ` (${does.join(', ')})` : ''}`);
  }
  if (pa.divert) out.push(`→ ${title(pa.divert)}`);
  if (pa.isEnding) out.push('[ending]');
  return out;
}

/** Line diff (longest common subsequence), in order. */
export function diffLines(a: string[], b: string[]): LineChange[] {
  const n = a.length;
  const m = b.length;
  // Long passages: trim the shared start and end first, which keeps the table small.
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e);
  const B = b.slice(s, m - e);
  const L: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      mid.push({ kind: 'same', text: A[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ kind: 'removed', text: A[i++] });
    else mid.push({ kind: 'added', text: B[j++] });
  }
  while (i < A.length) mid.push({ kind: 'removed', text: A[i++] });
  while (j < B.length) mid.push({ kind: 'added', text: B[j++] });
  return [...a.slice(0, s).map((text) => ({ kind: 'same' as const, text })), ...mid, ...a.slice(n - e).map((text) => ({ kind: 'same' as const, text }))];
}

const words = (p: StoryProject) => storyStats(p).words;

/** What changed from `before` (e.g. a draft) to `after` (e.g. the story now), in the order of `after`, removed passages last. */
export function compareProjects(before: StoryProject, after: StoryProject): StoryComparison {
  const old = new Map(before.passages.map((p) => [p.id, p]));
  // Choices name where they go by the passage's title now, so renaming a passage doesn't change every choice leading to it.
  const titles = new Map([...before.passages, ...after.passages].map((p) => [p.id, p.title]));
  const titleOf = (id: string) => titles.get(id);
  const now = new Set(after.passages.map((p) => p.id));
  const passages: PassageChange[] = [];
  let unchanged = 0;
  const change = (id: string, title: string, status: PassageChange['status'], lines: LineChange[], oldTitle?: string) => {
    passages.push({ id, title, status, lines, oldTitle, added: lines.filter((l) => l.kind === 'added').length, removed: lines.filter((l) => l.kind === 'removed').length });
  };
  for (const p of after.passages) {
    const o = old.get(p.id);
    const lines = passageLines(p, after, titleOf);
    if (!o) {
      change(p.id, p.title, 'added', lines.map((text) => ({ kind: 'added', text })));
      continue;
    }
    const d = diffLines(passageLines(o, before, titleOf), lines);
    const renamed = o.title !== p.title;
    if (renamed || d.some((l) => l.kind !== 'same')) change(p.id, p.title, 'changed', d, renamed ? o.title : undefined);
    else unchanged++;
  }
  for (const o of before.passages) if (!now.has(o.id)) change(o.id, o.title, 'removed', passageLines(o, before, titleOf).map((text) => ({ kind: 'removed', text })));
  const names = (p: StoryProject) => new Set(p.characters.map((c) => c.displayName));
  const bn = names(before);
  const an = names(after);
  const start = (p: StoryProject) => p.passages.find((x) => x.id === p.project.startPassage)?.title ?? p.project.startPassage;
  return {
    passages,
    unchanged,
    words: { before: words(before), after: words(after) },
    characters: { added: [...an].filter((n) => !bn.has(n)), removed: [...bn].filter((n) => !an.has(n)) },
    startChanged: before.project.startPassage !== after.project.startPassage ? { before: start(before), after: start(after) } : undefined,
  };
}
