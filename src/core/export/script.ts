import { audioFileName } from '../audio';
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
      const clip = b.audio ? audioFileName(b.audio) : `${p.id}_${String(i + 1).padStart(3, '0')}.wav`;
      rows.push([n, p.title, names.get(b.speakerId) ?? b.speakerId, b.parenthetical ?? '', b.text, clip, b.audio ? 'yes' : '']);
    });
  // A byte-order mark so spreadsheet apps read the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
