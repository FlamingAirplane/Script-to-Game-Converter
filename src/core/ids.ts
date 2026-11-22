import { fnv1a } from './hash';
import type { ContentBlock, Passage, StoryProject } from './isr';

// Stable ids for what players read. A line (dialogue, narration or transition) and a choice each carry an id that
// is written into the Ink (#id:l_3f9a1c, or inside a choice's brackets) and kept in the model through every edit.
// Readers then tell lines and choices apart by id rather than by their words, so fixing a typo no longer loses a
// translation, a "chosen before" mark or a saved game's place. Readers fall back to the words for anything made
// before ids existed. Choices already have an id (Choice.id); this file gives the lines theirs.

type Identified = Extract<ContentBlock, { type: 'dialogue' | 'action' | 'transition' }>;

const hasId = (b: ContentBlock): b is Identified => b.type === 'dialogue' || b.type === 'action' || b.type === 'transition';

/** The ids already in use in the story's text lines. */
function taken(project: StoryProject): Set<string> {
  const out = new Set<string>();
  for (const p of project.passages) for (const b of p.content) if (hasId(b) && b.id) out.add(b.id);
  return out;
}

/** A new id for the nth identified block of a passage: made from where it is and what it says, so the same story always gets the same ids. */
function mint(p: Passage, n: number, b: Identified, used: Set<string>): string {
  const base = `l_${fnv1a(`${p.id}|${n}|${b.type}|${b.text}`).slice(0, 6)}`;
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}${i}`;
  return id;
}

/** Whether any line is missing its id. */
export function lacksIds(project: StoryProject): boolean {
  return project.passages.some((p) => p.content.some((b) => hasId(b) && !b.id));
}

/**
 * Gives every line without an id one, in place. Ids it finds are kept as they are (an edit never changes them);
 * new ones come from the line's place and words at the moment it gets one, so the same project always gets the same ids.
 */
export function ensureIds(project: StoryProject): void {
  if (!lacksIds(project)) return;
  const used = taken(project);
  for (const p of project.passages) {
    let n = 0;
    for (const b of p.content) {
      if (!hasId(b)) continue;
      if (!b.id) {
        b.id = mint(p, n, b, used);
        used.add(b.id);
      }
      n++;
    }
  }
}

/** The project itself when every line has its id, or a copy that has them (never changes the one it is given). */
export function withIds(project: StoryProject): StoryProject {
  if (!lacksIds(project)) return project;
  const { sources, ...rest } = project;
  const copy: StoryProject = { ...structuredClone(rest), sources };
  ensureIds(copy);
  return copy;
}

/** The id of a line's paragraph: a line that is several paragraphs in the Ink gives each one its own, "id", "id-2", "id-3". */
export function paragraphId(id: string, paragraph: number): string {
  return paragraph === 0 ? id : `${id}-${paragraph + 1}`;
}

/** Ink without its id tags: how it reads when only the writing matters (tests, comparisons). */
export function stripIds(ink: string): string {
  return ink.replace(/ #id:[\w-]+(?=[\] \n]|$)/g, '');
}
