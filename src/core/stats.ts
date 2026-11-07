// Story statistics for writers and producers: how long the story is, how much it branches, and
// how much each character speaks (to plan voice sessions).

import { plainText } from './emphasis';
import type { StoryProject } from './isr';

/** Typical silent reading speed, words per minute. */
const READ_WPM = 230;
/** Typical speed of recorded dialogue, words per minute. */
const SPOKEN_WPM = 150;

export interface CharacterStats {
  id: string;
  name: string;
  lines: number;
  words: number;
  /** Lines that already have a recorded or attached clip. */
  clips: number;
}

export interface StoryStats {
  passages: number;
  words: number;
  dialogueWords: number;
  choices: number;
  conditionalChoices: number;
  endings: number;
  /** Minutes to read every passage once. */
  readingMinutes: number;
  /** Minutes of recorded dialogue if every line were voiced. */
  spokenMinutes: number;
  /** Characters with at least one line, most lines first. */
  characters: CharacterStats[];
}

export function countWords(text: string): number {
  return plainText(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function storyStats(project: StoryProject): StoryStats {
  const names = new Map(project.characters.map((c) => [c.id, c.displayName]));
  const byChar = new Map<string, CharacterStats>();
  let words = 0;
  let dialogueWords = 0;
  let choices = 0;
  let conditionalChoices = 0;
  let endings = 0;

  for (const p of project.passages) {
    if (p.review === 'rejected') continue;
    for (const b of p.content) {
      if (b.type === 'dialogue') {
        const n = countWords(b.text);
        words += n;
        dialogueWords += n;
        const c = byChar.get(b.speakerId) ?? { id: b.speakerId, name: names.get(b.speakerId) ?? b.speakerId, lines: 0, words: 0, clips: 0 };
        c.lines++;
        c.words += n;
        if (b.audio) c.clips++;
        byChar.set(b.speakerId, c);
      } else if (b.type === 'action' || b.type === 'transition') {
        words += countWords(b.text);
      }
    }
    const live = p.choices.filter((c) => c.review !== 'rejected');
    choices += live.length;
    conditionalChoices += live.filter((c) => c.conditions.length > 0).length;
    words += live.reduce((n, c) => n + countWords(c.text), 0);
    if (p.isEnding || p.divert === 'END' || live.some((c) => c.target === 'END')) endings++;
  }

  return {
    passages: project.passages.filter((p) => p.review !== 'rejected').length,
    words,
    dialogueWords,
    choices,
    conditionalChoices,
    endings,
    readingMinutes: words / READ_WPM,
    spokenMinutes: dialogueWords / SPOKEN_WPM,
    characters: [...byChar.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name)),
  };
}

/** "under a minute", "about 4 minutes", "about 1 hour 20 minutes". */
export function formatMinutes(min: number): string {
  if (min < 1) return 'under a minute';
  const m = Math.round(min);
  if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `about ${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`;
}
