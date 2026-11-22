import type { Story } from 'inkjs';
import { chosenKey } from '../../core/chosen';
import { cuesIn, type ParsedCue } from '../../core/cues';
import { CONTINUE_TEXT } from '../../core/isr';
import { isPause, readOn, type Line } from '../../core/reader';
import { chosenId, idOf } from '../../core/readerCore';

// The pure parts of Playtest: what a stretch of the story is, which choices are on offer and how a save from another
// version of the story is replayed. The screen itself is PlaytestView.tsx.

/** Story state at the start of the current stretch of text, so a state change can replay it. */
export interface Segment {
  state: string;
  prefix: Line[];
  overrides: Record<string, boolean | number | string>;
}

export interface Snapshot {
  state: string;
  lines: Line[];
  segment: Segment | null;
}

/** A cutscene line (#cutscene): shown one at a time, going on by itself. */
export const isCutscene = (l: Line | undefined) => !!l && l.kind === 'text' && l.tags.includes('cutscene');
/**
 * How many lines show once the cutscene line at `n - 1` has been read: up to the next cutscene line (and any cues
 * before it), or 0 when the cutscene is over.
 */
export function nextShown(ls: Line[], n: number): number {
  let i = n;
  while (i < ls.length && ls[i].kind === 'cue') i++;
  return isCutscene(ls[i]) ? i + 1 : 0;
}

/** The reader asked their system for less motion: scroll and show new text without animating it. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The choices on offer, each with how it's remembered once taken (see core/chosen.ts). */
export const offered = (s: Story): OfferedChoice[] =>
  s.currentChoices.map((c) => {
    const id = idOf(c.tags ?? []);
    return { text: c.text, index: c.index, id: id ?? undefined, key: chosenId(id, c.sourcePath, c.text), legacy: chosenKey(c.sourcePath, c.text) };
  });

/** A choice on offer: its id when the Ink has ids, how it's remembered once taken, and how older stories remembered it. */
export interface OfferedChoice {
  text: string;
  index: number;
  id?: string;
  key: string;
  legacy: string;
}

/** The cues among these lines, in order. */
export const cuesOf = (lines: Line[]): ParsedCue[] => lines.filter((l) => l.kind === 'cue').flatMap((l) => cuesIn(l.tags));

/**
 * Brings a save from another version of the story forward: plays the new version from the start
 * making the same choices (by their id when both versions have ids, else by their text), so its text and variables apply. Stops at the first
 * choice the new version no longer offers. The playable story export does the same for readers.
 */
export function replayChoices(s: Story, chosen: { text: string; id?: string }[]): { lines: Line[]; history: Snapshot[]; segment: Segment; followed: number } {
  let segment: Segment = { state: s.state.toJson(), prefix: [], overrides: {} };
  let lines = readOn(s, []);
  const history: Snapshot[] = [];
  let followed = 0;
  const take = (c: { index: number; text: string; tags?: string[] | null }) => {
    history.push({ state: s.state.toJson(), lines, segment });
    const pause = isPause(s);
    s.ChooseChoiceIndex(c.index);
    const choiceId = idOf(c.tags ?? []) ?? undefined;
    const prefix: Line[] = [...lines, { text: c.text, tags: [], kind: 'choice', pause, ...(choiceId ? { choiceId } : {}) }];
    segment = { state: s.state.toJson(), prefix, overrides: {} };
    lines = readOn(s, prefix);
  };
  // Continue breaks added or removed since the save don't stop it: take or skip them.
  for (let i = 0, steps = 0; i < chosen.length && steps < 10000; steps++) {
    const want = chosen[i];
    const c = (want.id ? s.currentChoices.find((x) => idOf(x.tags ?? []) === want.id) : undefined) ?? s.currentChoices.find((x) => x.text === want.text);
    if (c) {
      take(c);
      i++;
      followed++;
    } else if (isPause(s)) take(s.currentChoices[0]);
    else if (want.text === CONTINUE_TEXT) {
      i++;
      followed++;
    } else break;
  }
  return { lines, history, segment, followed };
}

/** What to tell the writer after a save from another version of the story was replayed in this one. */
export function replayNote(from: string, to: string, followed: number, total: number): string {
  const n = (k: number) => `${k} choice${k === 1 ? '' : 's'}`;
  return (
    `The story changed since this save (version ${from} → ${to}). ` +
    (followed === total
      ? `Replayed ${total === 1 ? 'its choice' : `all ${n(total)}`} in the new version.`
      : followed
        ? `${followed} of ${n(total)} still exist, so it resumes after the last one that does.`
        : `None of its ${n(total)} exist any more, so it starts from the beginning.`) +
    ' Readers’ saves of the playable story carry over the same way.'
  );
}
