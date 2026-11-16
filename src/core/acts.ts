import { slugify, type Act, type Passage, type StoryProject } from './isr';

// Acts: an optional, titled grouping of passages. A passage names its act (Passage.act); the story lists them in
// order (StoryProject.acts). Acts only group passages, for the writer and the game: the story plays the same.
//
// Written as "@act <id> [Title]" in a script (the passages after it are in that act; a bare "@act" ends it), and as
// "// @act <id> <Title>" before the first knot of each act in generated Ink, which the Ink importer reads back.

/**
 * The story's acts, in order: the ones it lists, then any a passage names that it doesn't (titled from their id).
 * Empty for a story without acts.
 */
export function actsOf(project: Pick<StoryProject, 'acts' | 'passages'>): Act[] {
  const out = [...(project.acts ?? [])];
  const known = new Set(out.map((a) => a.id));
  for (const p of project.passages)
    if (p.act && !known.has(p.act)) {
      known.add(p.act);
      out.push({ id: p.act, title: actTitleFromId(p.act) });
    }
  return out;
}

/** The act a passage is in, or undefined. */
export function actOf(project: Pick<StoryProject, 'acts' | 'passages'>, passage: Pick<Passage, 'act'>): Act | undefined {
  return passage.act ? actsOf(project).find((a) => a.id === passage.act) : undefined;
}

/** "act_one" → "Act One". */
export function actTitleFromId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A fresh act id from a title ("The Storm" → "the_storm"), not one of `taken`. */
export function newActId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(title) || 'act';
  let id = root;
  for (let n = 2; used.has(id); n++) id = `${root}_${n}`;
  return id;
}

/** An act's title made safe for one line (an Ink comment, a C# or C++ string). */
export function actTitleLine(title: string): string {
  return title.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The passages in each act, in story order, with the passages in no act (if any) first under `null`. */
export function passagesByAct<P extends Pick<Passage, 'act'>>(project: Pick<StoryProject, 'acts' | 'passages'>, passages: P[]): { act: Act | null; passages: P[] }[] {
  const acts = actsOf(project);
  const ids = new Set(acts.map((a) => a.id));
  const groups: { act: Act | null; passages: P[] }[] = [];
  const none = passages.filter((p) => !p.act || !ids.has(p.act));
  if (none.length) groups.push({ act: null, passages: none });
  for (const a of acts) groups.push({ act: a, passages: passages.filter((p) => p.act === a.id) });
  return groups;
}

// Editing acts (Review). Each changes the project in place, like the other editing operations (see ui/projectOps.ts).

/** Puts a passage in an act (undefined: in no act). An act the story doesn't list yet is added to it. */
export function setPassageAct(project: StoryProject, passageId: string, actId: string | undefined) {
  const p = project.passages.find((x) => x.id === passageId);
  if (!p) return;
  if (!actId) {
    delete p.act;
    return;
  }
  if (!actsOf(project).some((a) => a.id === actId)) project.acts = [...(project.acts ?? []), { id: actId, title: actTitleFromId(actId) }];
  else if (!project.acts?.some((a) => a.id === actId)) project.acts = actsOf(project); // named by passages only until now
  p.act = actId;
}

/** A new act with this title (after the others), with the passage in it if one is given. Returns its id. */
export function addAct(project: StoryProject, title: string, passageId?: string): string {
  const acts = actsOf(project);
  const id = newActId(title, acts.map((a) => a.id));
  project.acts = [...acts, { id, title: actTitleLine(title) || actTitleFromId(id) }];
  if (passageId) setPassageAct(project, passageId, id);
  return id;
}

/** Gives an act a new title (its id stays, so the game's references to it keep working). */
export function renameAct(project: StoryProject, actId: string, title: string) {
  project.acts = actsOf(project).map((a) => (a.id === actId ? { ...a, title } : a));
}

/** Removes an act: its passages are in no act. The story has no acts left when it was the last one. */
export function removeAct(project: StoryProject, actId: string) {
  for (const p of project.passages) if (p.act === actId) delete p.act;
  const acts = actsOf(project).filter((a) => a.id !== actId);
  if (acts.length) project.acts = acts;
  else delete project.acts;
}

/** Puts the passages after this one (up to the next passage in another act) in its act, the way @act reads. Returns how many changed. */
export function actToFollowing(project: StoryProject, passageId: string): number {
  const at = project.passages.findIndex((p) => p.id === passageId);
  if (at < 0) return 0;
  const act = project.passages[at].act;
  let n = 0;
  for (const p of project.passages.slice(at + 1)) {
    if (p.act && p.act !== act) break;
    if (p.act === act) continue;
    if (act) p.act = act;
    else delete p.act;
    n++;
  }
  return n;
}
