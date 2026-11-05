import { audioFileName } from '../audio';
import { log } from '../log';
import type { StoryProject } from '../isr';

// Recording script: every line of dialogue in story order, one row per line, as CSV (opens in
// Excel, Numbers and Google Sheets). The Clip column names the file a recording should be saved
// as, or the one already attached, so actors' takes can be matched back to lines.

export function recordingScriptFileName(project: StoryProject): string {
  return `${project.project.id || 'story'}-recording-script.csv`;
}

function cell(v: string | number | undefined): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildRecordingScript(project: StoryProject): string {
  const names = new Map(project.characters.map((c) => [c.id, c.displayName]));
  const rows: (string | number)[][] = [['#', 'Passage', 'Character', 'Direction', 'Line', 'Clip', 'Recorded']];
  let n = 0;
  for (const p of project.passages)
    p.content.forEach((b, i) => {
      if (b.type !== 'dialogue') return;
      n++;
      const clip = b.audio ? audioFileName(b.audio) : `${recordingSlot(p.id, i)}.wav`;
      rows.push([n, p.title, names.get(b.speakerId) ?? b.speakerId, b.parenthetical ?? '', b.text, clip, b.audio ? 'yes' : '']);
    });
  log('export').info('Built recording script', { lines: n, recorded: rows.filter((r) => r[6] === 'yes').length });
  // A byte-order mark so spreadsheet apps read the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The file name (without extension) the recording script asks for, for the dialogue at content index `i`. */
export function recordingSlot(passageId: string, i: number): string {
  return `${passageId}_${String(i + 1).padStart(3, '0')}`;
}

export interface RecordingMatch {
  file: string;
  passageId: string;
  /** Content index of the dialogue line. */
  index: number;
}

/**
 * Matches recording files to dialogue lines, the way the recording script names them: by the Clip column
 * ("archive_entry_004.wav"), by a clip already attached (a new take of it), or by the row number ("12.wav").
 * Case, spaces and the extension don't matter. Files that match nothing, or a line already matched by
 * another file, are returned as unmatched.
 */
export function matchRecordings(project: StoryProject, files: string[]): { matched: RecordingMatch[]; unmatched: string[] } {
  const norm = (s: string) => s.replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const slots = new Map<string, { passageId: string; index: number }>();
  let n = 0;
  for (const p of project.passages)
    p.content.forEach((b, i) => {
      if (b.type !== 'dialogue') return;
      n++;
      const at = { passageId: p.id, index: i };
      slots.set(norm(recordingSlot(p.id, i)), at);
      if (b.audio) slots.set(norm(b.audio.id), at);
      slots.set(String(n), at);
    });
  const matched: RecordingMatch[] = [];
  const unmatched: string[] = [];
  const taken = new Set<string>();
  for (const file of files) {
    const base = norm(file);
    const at = slots.get(/^0*\d+$/.test(base) ? String(Number(base)) : base);
    const key = at && `${at.passageId}#${at.index}`;
    if (!at || taken.has(key!)) unmatched.push(file);
    else {
      taken.add(key!);
      matched.push({ file, ...at });
    }
  }
  return { matched, unmatched };
}
