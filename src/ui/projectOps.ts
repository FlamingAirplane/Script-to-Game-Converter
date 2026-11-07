import { isActive, uniqueId, type Choice, type Passage, type StoryProject } from '../core/isr';

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
  if (p.layout?.[from]) {
    p.layout[to] = p.layout[from];
    delete p.layout[from];
  }
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
  if (p.layout) delete p.layout[id];
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

/** Resolve a diagnostic's entity id to the passage that contains it. */
export function passageForEntity(p: StoryProject, entityId?: string, passageHint?: unknown): string | undefined {
  if (typeof passageHint === 'string' && p.passages.some((x) => x.id === passageHint)) return passageHint;
  if (!entityId) return undefined;
  if (p.passages.some((x) => x.id === entityId)) return entityId;
  return p.passages.find((x) => x.choices.some((c) => c.id === entityId))?.id;
}

// ---- Find & replace -------------------------------------------------------------------------

export interface TextMatch {
  passageId: string;
  where: 'title' | 'content' | 'choice';
  index: number; // content block or choice index
  excerpt: string;
}

function matcher(query: string, matchCase: boolean): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
}

function excerpt(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 24);
  const end = Math.min(text.length, at + len + 24);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Every place the text appears: passage titles, narrative text, parentheticals and choice wording. */
export function findText(p: StoryProject, query: string, matchCase = false): TextMatch[] {
  if (!query) return [];
  const out: TextMatch[] = [];
  const scan = (text: string | undefined, m: Omit<TextMatch, 'excerpt'>) => {
    if (!text) return;
    for (const hit of text.matchAll(matcher(query, matchCase))) out.push({ ...m, excerpt: excerpt(text, hit.index ?? 0, query.length) });
  };
  for (const ps of p.passages) {
    scan(ps.title, { passageId: ps.id, where: 'title', index: 0 });
    ps.content.forEach((b, i) => {
      if ('text' in b) scan(b.text, { passageId: ps.id, where: 'content', index: i });
      if (b.type === 'dialogue') scan(b.parenthetical, { passageId: ps.id, where: 'content', index: i });
    });
    ps.choices.forEach((c, i) => scan(c.text, { passageId: ps.id, where: 'choice', index: i }));
  }
  return out;
}

/** Replaces every match; changed elements are marked as edited. Returns the number of replacements. */
export function replaceText(p: StoryProject, query: string, replacement: string, matchCase = false): number {
  if (!query) return 0;
  let count = 0;
  const re = matcher(query, matchCase);
  const rep = (text: string) =>
    text.replace(re, () => {
      count++;
      return replacement;
    });
  for (const ps of p.passages) {
    const t = rep(ps.title);
    if (t !== ps.title) {
      ps.title = t;
      if (ps.origin === 'source') ps.origin = 'user_authored';
    }
    for (const b of ps.content) {
      let changed = false;
      if ('text' in b && b.type !== 'unsupported') {
        const n = rep(b.text);
        if (n !== b.text) (b.text = n), (changed = true);
      }
      if (b.type === 'dialogue' && b.parenthetical) {
        const n = rep(b.parenthetical);
        if (n !== b.parenthetical) (b.parenthetical = n), (changed = true);
      }
      if (changed && b.origin !== 'generated') b.origin = 'user_authored';
    }
    for (const c of ps.choices) {
      const n = rep(c.text);
      if (n !== c.text) {
        c.text = n;
        if (c.origin === 'source') c.origin = 'user_authored';
      }
    }
  }
  return count;
}

// ---- Characters and passage order ------------------------------------------------------------

/** Moves every line spoken by `fromId` to `intoId`, keeps the old name as an alias, and removes `fromId`. */
export function mergeCharacter(p: StoryProject, fromId: string, intoId: string): number {
  const from = p.characters.find((c) => c.id === fromId);
  const into = p.characters.find((c) => c.id === intoId);
  if (!from || !into || fromId === intoId) return 0;
  let moved = 0;
  for (const ps of p.passages)
    for (const b of ps.content)
      if (b.type === 'dialogue' && b.speakerId === fromId) {
        b.speakerId = intoId;
        if (b.origin === 'source') b.origin = 'transformed';
        moved++;
      }
  into.aliases = [...new Set([...into.aliases, from.displayName, ...from.aliases])].filter((a) => a !== into.displayName);
  if (!into.portrait && from.portrait) into.portrait = from.portrait;
  if (!into.voice && from.voice) into.voice = from.voice;
  p.characters = p.characters.filter((c) => c.id !== fromId);
  return moved;
}

/** Moves a passage up or down in the contents (story flow is unchanged: it follows choices and diverts). */
export function movePassage(p: StoryProject, id: string, dir: -1 | 1): boolean {
  const i = p.passages.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.passages.length) return false;
  [p.passages[i], p.passages[j]] = [p.passages[j], p.passages[i]];
  return true;
}

/** An edit to the project (see App.update): applied to a copy, one undo step unless grouped. */
export type Update = (fn: (draft: StoryProject) => void, group?: string) => void;

/** Puts a Continue break before content block `at`: from there on, the reader clicks Continue first. */
export function addBreak(p: StoryProject, passageId: string, at: number) {
  p.passages.find((x) => x.id === passageId)?.content.splice(at, 0, { type: 'pause', origin: 'user_authored' });
}

/** Removes the Continue break at content index `at` (if it is one). */
export function removeBreak(p: StoryProject, passageId: string, at: number) {
  const passage = p.passages.find((x) => x.id === passageId);
  if (passage?.content[at]?.type === 'pause') passage.content.splice(at, 1);
}

export function countBreaks(passage: { content: { type: string }[] }): number {
  return passage.content.filter((b) => b.type === 'pause').length;
}

/** How a new scene joins the story. */
export type SceneLink =
  /** The story goes on from `from` into the new scene (which takes over where `from` went next). */
  | 'continue'
  /** A new choice in `from` leads to the new scene. */
  | 'choice'
  /** Not connected yet: connect it later (it shows as "Can't be reached"). */
  | 'none';

export interface NewScene {
  title: string;
  /** e.g. "INT. LIGHTHOUSE - NIGHT". */
  heading?: string;
  /** The scene's first line of narration. */
  firstLine?: string;
  /** The passage it follows, for 'continue' and 'choice'. */
  from?: string;
  link: SceneLink;
  /** The new choice's wording ('choice'). */
  choiceText?: string;
  /**
   * 'choice' only, when `from` goes straight on to another passage and has no choices yet: the wording of a choice
   * for that way, so it stays open to the reader (a passage with choices only goes straight on when none can be taken).
   */
  keepPathText?: string;
  /** Where the scene goes afterwards: a passage id, or 'END'. Unset: where `from` went next ('continue'), else the end. */
  then?: string;
  /** Where to put it on the map. */
  at?: { x: number; y: number };
}

/** Whether a passage goes straight on (no choices the reader sees), so a scene can be put after it with 'continue'. */
export function goesStraightOn(p: Passage): boolean {
  return !p.choices.some((c) => isActive(c.review));
}

/**
 * Adds a scene to the story and connects it: after a passage, as a new choice in one, or on its own. Returns the new
 * passage, or an error for the writer.
 */
export function addScene(p: StoryProject, s: NewScene): Passage | string {
  const title = s.title.trim();
  if (!title) return 'Give the scene a title.';
  const from = s.from ? p.passages.find((x) => x.id === s.from) : undefined;
  if (s.link !== 'none' && !from) return 'Choose the passage it comes after.';
  if (s.link === 'continue' && from && !goesStraightOn(from)) return `“${from.title}” ends with choices, so add the scene as a new choice instead.`;
  if (s.then && s.then !== 'END' && !p.passages.some((x) => x.id === s.then)) return 'The passage it goes to next doesn’t exist.';
  const taken = new Set(p.passages.map((x) => x.id));
  const id = uniqueId(title, taken, 'scene');
  const heading = s.heading?.trim();
  const firstLine = s.firstLine?.trim();
  const scene: Passage = {
    id,
    title,
    ...(heading ? { sceneHeading: heading } : {}),
    content: firstLine ? [{ type: 'action', text: firstLine, origin: 'user_authored' }] : [],
    choices: [],
    isEnding: false,
    origin: 'user_authored',
    review: 'approved',
  };
  // Where it goes next.
  const fromNext = from && goesStraightOn(from) ? (from.divert ?? (from.isEnding ? 'END' : undefined)) : undefined;
  const then = s.then ?? (s.link === 'continue' ? (fromNext ?? 'END') : 'END');
  if (then === 'END') scene.isEnding = true;
  else scene.divert = then;

  if (from && s.link === 'continue') {
    from.divert = id;
    from.isEnding = false;
  } else if (from && s.link === 'choice') {
    const ids = new Set(p.passages.flatMap((x) => x.choices.map((c) => c.id)));
    const choice = (text: string, target: string): Choice => ({ id: uniqueId(`${from.id}_${text}`, ids, `${from.id}_choice`), text, target, conditions: [], effects: [], once: false, origin: 'user_authored', review: 'approved' });
    // A passage that went straight on keeps that way as a choice of its own, or the reader would lose it.
    if (goesStraightOn(from) && from.divert && from.divert !== 'END') {
      const target = p.passages.find((x) => x.id === from.divert);
      from.choices.push(choice(s.keepPathText?.trim() || `Go on to ${target?.title ?? from.divert}`, from.divert));
      delete from.divert;
    }
    from.choices.push(choice(s.choiceText?.trim() || title, id));
    from.isEnding = false;
  }
  const at = from ? p.passages.indexOf(from) : -1;
  if (at >= 0) p.passages.splice(at + 1, 0, scene);
  else p.passages.push(scene);
  if (s.at) p.layout = { ...p.layout, [id]: { x: Math.round(s.at.x), y: Math.round(s.at.y) } };
  return scene;
}
