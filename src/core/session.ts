import { recordingSlot } from './export/script';
import type { StoryProject } from './isr';

// Recording sessions: one long recording of a voice session (say, everything one actor read), with
// lines of dialogue linked to stretches of it. Each linked stretch is cut out as that line's clip; the
// clip remembers where it came from (AudioRef.from), so the links can be opened and changed again.
// The session's bytes live in the browser like other media; the project keeps this reference.

export interface SessionRef {
  id: string;
  /** The recording's file name, for display. */
  name: string;
  mime: string;
  durationMs?: number;
}

/** A stretch of a session, in seconds. */
export interface Segment {
  start: number;
  end: number;
}

/** Where a clip was cut from. */
export interface ClipSource extends Segment {
  session: string;
}

export interface SessionLine {
  /** The recording script's name for the line, e.g. archive_entry_004. */
  slot: string;
  passageId: string;
  /** Content index of the dialogue block. */
  index: number;
  /** Its number in the recording script (1-based, story order). */
  number: number;
  passageTitle: string;
  speakerId: string;
  speaker: string;
  parenthetical?: string;
  text: string;
  /** The stretch of a session its clip was cut from, if any. */
  from?: ClipSource;
  hasClip: boolean;
}

/** Every line of dialogue, in recording-script order. */
export function sessionLines(project: StoryProject): SessionLine[] {
  const names = new Map(project.characters.map((c) => [c.id, c.displayName]));
  const out: SessionLine[] = [];
  for (const p of project.passages)
    p.content.forEach((b, i) => {
      if (b.type !== 'dialogue') return;
      out.push({
        slot: recordingSlot(p.id, i),
        passageId: p.id,
        index: i,
        number: out.length + 1,
        passageTitle: p.title || p.id,
        speakerId: b.speakerId,
        speaker: names.get(b.speakerId) ?? b.speakerId,
        parenthetical: b.parenthetical,
        text: b.text,
        from: b.audio?.from,
        hasClip: !!b.audio,
      });
    });
  return out;
}

/** 75.5 → "1:15.50"; an hour or more → "1:02:03.40". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(2).padStart(5, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** "1:15.5", "75.5", "1:02:03" or "1:15,5" → seconds; null when it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((p, i) => p >= 60 && i < parts.length - 1)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export interface DetectOptions {
  /** 0–1: how loud, between the quietest and loudest parts, counts as speech. Higher finds fewer, louder takes. */
  sensitivity?: number;
  /** A pause at least this long (seconds) ends a take. */
  minGap?: number;
  /** Takes shorter than this (seconds) are ignored (coughs, clicks). */
  minLength?: number;
  /** Silence kept before and after each take (seconds). */
  padding?: number;
}

/**
 * Finds the takes in a session: stretches of sound separated by pauses. A simple loudness detector
 * (20 ms windows against a threshold between the noise floor and the peaks), good enough to cut a
 * session read line by line into one segment per line, for a person to check and adjust.
 */
export function detectSegments(samples: Float32Array, rate: number, o: DetectOptions = {}): Segment[] {
  const sensitivity = o.sensitivity ?? 0.3;
  const minGap = o.minGap ?? 0.5;
  const minLength = o.minLength ?? 0.25;
  const padding = o.padding ?? 0.12;
  const win = Math.max(1, Math.round(rate * 0.02));
  const n = Math.floor(samples.length / win);
  if (!n) return [];
  const db = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sum += samples[i] * samples[i];
    db[w] = 10 * Math.log10(sum / win + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const floor = sorted[Math.floor(n * 0.1)];
  const peak = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
  if (peak - floor < 6) return []; // nothing stands out from the noise
  const threshold = floor + (peak - floor) * (1 - sensitivity) * 0.6;
  const raw: Segment[] = [];
  let start = -1;
  let lastLoud = -1;
  const gapWindows = Math.round(minGap / 0.02);
  for (let w = 0; w < n; w++) {
    if (db[w] > threshold) {
      if (start < 0) start = w;
      lastLoud = w;
    } else if (start >= 0 && w - lastLoud > gapWindows) {
      raw.push({ start: start * 0.02, end: (lastLoud + 1) * 0.02 });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ start: start * 0.02, end: (lastLoud + 1) * 0.02 });
  const duration = samples.length / rate;
  const kept = raw.filter((s) => s.end - s.start >= minLength);
  // Padding, without running into the next take.
  return kept.map((s, i) => {
    const prev = i > 0 ? (kept[i - 1].end + s.start) / 2 : 0;
    const next = i < kept.length - 1 ? (s.end + kept[i + 1].start) / 2 : duration;
    return { start: round(Math.max(prev, s.start - padding)), end: round(Math.min(next, s.end + padding)) };
  });
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** The takes given to the lines in order: the first take to the first line, and so on. */
export function assignInOrder(lines: string[], segments: Segment[]): Record<string, Segment> {
  const out: Record<string, Segment> = {};
  lines.forEach((slot, i) => {
    if (segments[i]) out[slot] = segments[i];
  });
  return out;
}

/** The samples of a stretch, with 5 ms fades so the cut doesn't click. */
export function cutSamples(samples: Float32Array, rate: number, seg: Segment): Float32Array {
  const a = Math.max(0, Math.floor(seg.start * rate));
  const b = Math.min(samples.length, Math.ceil(seg.end * rate));
  const out = samples.slice(a, Math.max(a, b));
  const fade = Math.min(Math.floor(rate * 0.005), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

/** A clip's name: the session's name and the stretch, e.g. "Mira session 1:02.50–1:05.10.wav". */
export function clipName(session: SessionRef, seg: Segment): string {
  const base = session.name.replace(/\.[a-z0-9]+$/i, '');
  return `${base} ${formatTime(seg.start)}–${formatTime(seg.end)}.wav`.replace(/:/g, '.');
}
