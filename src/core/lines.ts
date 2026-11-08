import { slugify, type Passage, type StoryProject } from './isr';
import { forPlayers } from './players';

// Lines of dialogue a game can start the story at (or jump to), not just passages: talk to someone again and pick the
// conversation up at "Did you bring the flowers?" instead of from the top.
//
// In Ink each dialogue line is a labelled gather, "- (line_mara_did_you_bring) MARA: Did you bring…", and gets a
// tiny entry knot at the end of the file, "=== garden__line_mara_did_you_bring ===" / "-> garden.line_mara_did_you_bring".
// The entry knot is what the game chooses: a gather after a Continue break or an exit sits inside the weave, where a
// runtime path can't name it, but a divert from Ink can (see inkgen.ts). Games use "passage.label"
// (StartAt("garden.line_mara_did_you_bring")); the label comes from the speaker and the words, so it stays put when
// lines are added or moved around it.

export interface LineEntry {
  /** The passage (Ink knot) the line is in. */
  passageId: string;
  /** The line's label in its passage: line_<speaker>_<first words>. */
  label: string;
  /** How a game names it: "passage.label". */
  path: string;
  /** The Ink knot a game chooses to start there: "passage__label". */
  entryKnot: string;
  /** The line as shown in menus: "MARA: Did you bring the flowers?". */
  display: string;
}

const LABEL_LENGTH = 40;

/** The labels of a passage's dialogue lines, in order (one per dialogue block). */
export function passageLineLabels(p: Passage): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const b of p.content) {
    if (b.type !== 'dialogue') continue;
    const base = `line_${slugify(`${b.speakerId} ${b.text}`).slice(0, LABEL_LENGTH).replace(/_+$/, '') || 'line'}`;
    let label = base;
    for (let n = 2; used.has(label); n++) label = `${base}_${n}`;
    used.add(label);
    out.push(label);
  }
  return out;
}

/** Every line of dialogue a game can start at, in story order (none for Ink kept as written). */
export function lineEntries(story: StoryProject): LineEntry[] {
  if (story.inkPassthrough !== undefined) return [];
  const project = forPlayers(story);
  const names = new Map(project.characters.map((c) => [c.id, c.displayName]));
  return project.passages.flatMap((p) => {
    const labels = passageLineLabels(p);
    const lines = p.content.flatMap((b) => (b.type === 'dialogue' ? [b] : []));
    return lines.map((b, i) => {
      const text = b.text.replace(/\s+/g, ' ').trim();
      const display = `${(names.get(b.speakerId) ?? b.speakerId).toUpperCase()}: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`;
      return { passageId: p.id, label: labels[i], path: `${p.id}.${labels[i]}`, entryKnot: `${p.id}__${labels[i]}`, display };
    });
  });
}

/** The entry knot names Narrative Bridge adds to the Ink (not passages of the story). */
export function lineEntryKnots(story: StoryProject): Set<string> {
  return new Set(lineEntries(story).map((e) => e.entryKnot));
}
