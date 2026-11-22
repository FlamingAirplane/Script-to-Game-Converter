// The reader's own rules, in one place. Everything that reads Pen to Ink's Ink conventions in TypeScript or in
// the playable page's JavaScript gets these functions from here: Playtest and the exports import them, and the
// playable page has this file's code compiled into it (scripts/reader-core.mjs writes readerCore.generated.ts,
// which playable.ts embeds). Unity and Unreal keep their own copies; tests/conformance.test.ts holds all of them
// to the same fixtures.
//
// This file must stay self-contained: no imports, and only plain functions and constants, so it can be dropped
// into the page as it is.

/** A Continue break is, in Ink, a lone choice with this text. */
export const CONTINUE_TEXT = 'Continue';

/** An exit to the game is, in Ink, a lone choice with this text before the exit's name. */
export const EXIT_PREFIX = 'Back to the game: ';

/** Tags that are Pen to Ink's own, never cues. */
export const RESERVED_TAG_NAMES: string[] = ['speaker', 'scene', 'paren', 'ext', 'image', 'audio', 'transition', 'title', 'author', 'choice', 'cutscene'];

/** The exit's name when this choice text hands over to the game, else null. */
export function exitOf(choiceText: string): string | null {
  return choiceText.startsWith(EXIT_PREFIX) ? choiceText.slice(EXIT_PREFIX.length).trim() || null : null;
}

/** Whether the offered choices are just a Continue break. */
export function isContinueOnly(choiceTexts: string[]): boolean {
  return choiceTexts.length === 1 && choiceTexts[0] === CONTINUE_TEXT;
}

export type CueKind = 'music' | 'ambience' | 'stop_music' | 'stop_ambience' | 'shake' | 'sound';

/** What a cue does, from its name: music and ambience loop (one track each), stop_… stops them, shake shakes, anything else is a sound. */
export function cueKind(name: string): CueKind {
  const n = name.toLowerCase();
  if (n.includes('stop_music') || n === 'silence') return 'stop_music';
  if (n.includes('stop_ambience')) return 'stop_ambience';
  if (n.includes('music') || n === 'song' || n === 'track') return 'music';
  if (n.includes('ambien') || n === 'weather') return 'ambience';
  if (n.includes('shake') || n === 'rumble') return 'shake';
  return 'sound';
}

export interface ParsedCue {
  name: string;
  value: string;
  /** The tag as Ink has it, e.g. "music:calm". */
  tag: string;
}

/** The cues among a line's tags (the ones that aren't Pen to Ink's own, such as speaker: or audio:). */
export function cuesIn(tags: string[]): ParsedCue[] {
  const out: ParsedCue[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const colon = tag.indexOf(':');
    const name = (colon < 0 ? tag : tag.slice(0, colon)).trim();
    if (!name || RESERVED_TAG_NAMES.includes(name)) continue;
    out.push({ name, value: colon < 0 ? '' : tag.slice(colon + 1).trim(), tag });
  }
  return out;
}

/** How a choice is remembered as "chosen before": its passage (Ink knot) and its text as written, "knot|text". */
export function chosenKey(sourcePath: string, text: string): string {
  return `${sourcePath.split('.')[0] ?? ''}|${text.trim()}`;
}

/** How long a cutscene line stays up: 1.2 s plus 0.055 s a letter, between 2 and 9 s. */
export function cutsceneSeconds(text: string): number {
  return Math.min(9, Math.max(2, 1.2 + text.length * 0.055));
}

/** A line's text reduced to letters and digits, to tell endings apart. */
export function endingKey(text: string): string {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface ReadLine {
  /** The line as shown: without the "Name: " prefix when it has one. */
  text: string;
  /** The name written before the colon, when the line is spoken (it has a #speaker tag and a "Name: " prefix). */
  speaker?: string;
  /** The #speaker tag's value, when the line has that tag. */
  who: string | null;
}

/** The value of a tag like "speaker:Ana" among a line's tags, or null. */
export function tagValue(tags: string[], name: string): string | null {
  for (const t of tags) if (t.startsWith(name + ':')) return t.slice(name.length + 1).trim();
  return null;
}

/** Splits a line Ink gave us into who says it and what: spoken lines are "Name: text" with a #speaker tag. */
export function readLine(raw: string, tags: string[]): ReadLine {
  const who = tagValue(tags, 'speaker');
  if (who === null) return { text: raw, who };
  const i = raw.indexOf(': ');
  return i > 0 ? { text: raw.slice(i + 2), speaker: raw.slice(0, i), who } : { text: raw, who };
}
