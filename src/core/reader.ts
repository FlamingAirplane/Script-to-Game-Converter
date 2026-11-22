import type { Story } from 'inkjs';
import { cuesIn } from './cues';
import { readLine } from './readerCore';
import { CONTINUE_TEXT, exitOf } from './isr';

// The TypeScript reader of the Ink conventions: what Playtest does with a compiled story. The playable page, Unity and
// Unreal each read the same conventions in their own language; tests/conformance.test.ts holds every reader to the
// fixtures in tests/fixtures/conformance, so they can't drift apart without a test saying so.

export interface Line {
  text: string;
  speaker?: string;
  tags: string[];
  /** cue: a cue for the game (#music:calm), shown as a small marker; its text is the tag. */
  kind: 'text' | 'choice' | 'system' | 'cue';
  /** A Continue break was taken here (a choice line that isn't shown). */
  pause?: boolean;
  /** The passage (Ink knot) the line was read in. */
  passage?: string;
}

/** The passage (Ink knot) the reader is in: where the story last read from, even when it offers no choices. */
export const knotOf = (s: Story) => (s.state.previousPointer?.path?.toString() ?? s.currentChoices[0]?.sourcePath ?? '').split('.')[0];

/** A Continue break: the story offers only "Continue" (see inkgen.ts). */
export const isPause = (s: Story) => s.currentChoices.length === 1 && s.currentChoices[0].text === CONTINUE_TEXT;

/** Reads on until the next choice (or the end), appending the new lines to `prefix`. */
export function readOn(s: Story, prefix: Line[]): Line[] {
  const out = [...prefix];
  while (s.canContinue) {
    const raw = (s.Continue() ?? '').trim();
    const tags = s.currentTags ?? [];
    // Cues come before the line they're on (or alone, at the end of a passage).
    for (const c of cuesIn(tags)) out.push({ text: c.tag, tags: [c.tag], kind: 'cue' });
    if (!raw) continue;
    const passage = knotOf(s) || undefined;
    const { text, speaker, who } = readLine(raw, tags);
    out.push({ ...(speaker ?? who ? { speaker: speaker ?? who! } : {}), text, tags, kind: 'text', passage });
  }
  return out;
}

/** Why the story has stopped reading: it's over, offers a Continue break, hands over to the game, or waits for a choice. */
export type Stop = { kind: 'end' } | { kind: 'pause' } | { kind: 'exit'; name: string } | { kind: 'choices' };

export function stopOf(s: Story): Stop {
  const c = s.currentChoices;
  if (!c.length) return { kind: 'end' };
  if (isPause(s)) return { kind: 'pause' };
  const exit = c.length === 1 ? exitOf(c[0].text) : null;
  return exit ? { kind: 'exit', name: exit } : { kind: 'choices' };
}
