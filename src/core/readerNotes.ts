import { plainText } from './emphasis';
import type { StoryProject } from './isr';

// Reader notes: what readers of a copy shared for feedback (see PlayableOptions.feedback) wrote as they read, brought
// back into the script. Each note carries the last line the reader could see when they wrote it; the note goes in as a
// note line (kept out of play, an Ink comment) right after that line, so the writer finds it where it applies.

export const READER_NOTES_FORMAT = 'narrative-bridge-reader-notes';
export const READER_NOTE_PREFIX = 'Reader note: ';

export interface ReaderNote {
  /** The line the reader was looking at, as the story showed it (without the speaker). */
  quote: string;
  speaker?: string;
  note: string;
  /** When it was written (ISO date). */
  at?: string;
}

export interface ReaderNotesFile {
  format: typeof READER_NOTES_FORMAT;
  version: 1;
  story: string;
  storyId?: string;
  notes: ReaderNote[];
}

/** Reads a notes file's text, or says why it isn't one. */
export function parseReaderNotes(text: string): ReaderNotesFile | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'That file isn’t a reader notes file (it isn’t JSON).' };
  }
  const d = data as Partial<ReaderNotesFile>;
  if (d?.format !== READER_NOTES_FORMAT || !Array.isArray(d.notes)) return { error: 'That file isn’t a reader notes file.' };
  const notes = d.notes.filter((n): n is ReaderNote => !!n && typeof n.note === 'string' && n.note.trim() !== '' && typeof (n.quote ?? '') === 'string');
  return { format: READER_NOTES_FORMAT, version: 1, story: String(d.story ?? ''), storyId: d.storyId, notes };
}

const norm = (s: string) =>
  plainText(s)
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Puts each note into the story after the line it was written on. Returns how many went in, and the notes whose line
 * the story no longer has (those go at the start of the opening passage, with the line they were on, so none is lost).
 * A note already in the story (same text after the same line) isn't added twice.
 */
export function addReaderNotes(project: StoryProject, notes: ReaderNote[]): { placed: number; unplaced: number; duplicates: number } {
  let placed = 0;
  let unplaced = 0;
  let duplicates = 0;
  for (const n of notes) {
    const q = norm(n.quote ?? '');
    let target: { passage: StoryProject['passages'][number]; index: number } | undefined;
    if (q) {
      // The exact line first, then a line that begins the same way (the reader's copy may be a revision older).
      const exact = (t: string) => norm(t) === q;
      const close = (t: string) => q.length >= 24 && (norm(t).startsWith(q.slice(0, 40)) || q.startsWith(norm(t).slice(0, 40)));
      for (const test of [exact, close]) {
        for (const passage of project.passages) {
          const index = passage.content.findIndex((b) => (b.type === 'action' || b.type === 'dialogue' || b.type === 'transition') && test(b.text));
          if (index >= 0) {
            target = { passage, index };
            break;
          }
        }
        if (target) break;
      }
    }
    const text = `${READER_NOTE_PREFIX}${n.note.trim()}${target || !q ? '' : ` (on “${(n.quote ?? '').slice(0, 80)}”, which the script no longer has)`}`;
    const passage = target?.passage ?? project.passages.find((p) => p.id === project.project.startPassage) ?? project.passages[0];
    if (!passage) continue;
    const at = target ? target.index + 1 : 0;
    // Skip a note that is already there, right after its line (bringing the same file in twice).
    const near = passage.content.slice(at, at + 12);
    if (near.some((b) => b.type === 'note' && b.text === text)) {
      duplicates++;
      continue;
    }
    // After the line, and after any reader notes already on it, so notes keep the order they were written in.
    let insert = at;
    while (passage.content[insert]?.type === 'note' && (passage.content[insert] as { text: string }).text.startsWith(READER_NOTE_PREFIX)) insert++;
    passage.content.splice(insert, 0, { type: 'note', text, origin: 'user_authored' });
    if (target) placed++;
    else unplaced++;
  }
  return { placed, unplaced, duplicates };
}
