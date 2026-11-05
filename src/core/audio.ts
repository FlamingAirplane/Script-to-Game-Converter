// Dialogue audio: recorded or uploaded clips attached to dialogue lines, and per-character voice
// settings for the browser's built-in text-to-speech. Clip bytes live outside the ISR (in the
// browser's IndexedDB, or base64 in a saved project file); the ISR only stores a reference.

export interface AudioRef {
  id: string; // stable id, also the exported file's base name
  name: string; // original file name, for display
  mime: string;
  durationMs?: number;
  /** Cut from a recording session: which one, and where (seconds). See src/core/session.ts. */
  from?: { session: string; start: number; end: number };
  /**
   * A region: the clip has no bytes of its own and plays the `from` stretch of its session, like a
   * region in Pro Tools. Moving its start or end only changes these numbers.
   */
  region?: boolean;
  /** Edits laid over the clip without changing its audio (trim, fades, gain); applied when it plays or exports. */
  edit?: ClipEdit;
}

/** Non-destructive edits to a clip. Seconds, and gain in decibels. */
export interface ClipEdit {
  trimStart?: number;
  trimEnd?: number;
  fadeIn?: number;
  fadeOut?: number;
  gain?: number;
}

export function hasEdit(e?: ClipEdit): boolean {
  return !!e && !!(e.trimStart || e.trimEnd || e.fadeIn || e.fadeOut || e.gain);
}

/** Whether a clip is rendered (as WAV) to play or export: a region, or a clip with edits. */
export function isRendered(ref: Pick<AudioRef, 'region' | 'edit'>): boolean {
  return !!ref.region || hasEdit(ref.edit);
}

/** A clip's samples with its edits applied: trimmed, faded in and out, and its gain changed. A new array. */
export function applyEdit(samples: Float32Array, rate: number, e?: ClipEdit): Float32Array {
  if (!hasEdit(e)) return samples.slice();
  const a = Math.min(samples.length, Math.max(0, Math.round((e!.trimStart ?? 0) * rate)));
  const b = Math.max(a, samples.length - Math.max(0, Math.round((e!.trimEnd ?? 0) * rate)));
  const out = samples.slice(a, b);
  const g = e!.gain ? Math.pow(10, e!.gain / 20) : 1;
  const fi = Math.min(out.length, Math.round((e!.fadeIn ?? 0) * rate));
  const fo = Math.min(out.length, Math.round((e!.fadeOut ?? 0) * rate));
  for (let i = 0; i < out.length; i++) {
    let v = out[i] * g;
    if (i < fi) v *= i / fi;
    if (i >= out.length - fo) v *= (out.length - 1 - i) / fo;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

export interface VoiceSettings {
  voiceName?: string; // a SpeechSynthesisVoice name; empty = browser default
  rate?: number; // 0.5 – 2
  pitch?: number; // 0 – 2
}

/** Clip bytes keyed by AudioRef.id, as passed to exporters. */
export type AudioAssets = Record<string, { mime: string; bytes: Uint8Array }>;

/** Formats every engine target plays natively. Anything else is converted to WAV before storing. */
export const NATIVE_AUDIO = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/ogg']);

export function audioExtension(mime: string): string {
  if (/wav/.test(mime)) return 'wav';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/ogg/.test(mime)) return 'ogg';
  return 'bin';
}

/** The file a clip is exported as: its own format, or WAV when it's rendered (a region, or edited). */
export function audioFileName(ref: Pick<AudioRef, 'id' | 'mime'> & Partial<Pick<AudioRef, 'region' | 'edit'>>): string {
  return `${ref.id}.${isRendered(ref) ? 'wav' : audioExtension(ref.mime)}`;
}

export function newAudioId(seed: string): string {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `vo_${seed.replace(/[^a-z0-9_]/gi, '_').slice(0, 32)}_${rand}`;
}

/** Encodes PCM channel data as a 16-bit little-endian WAV file (mixed down to mono). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  const data = new DataView(new ArrayBuffer(44 + length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true); // PCM
  data.setUint16(22, 1, true); // mono
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    data.setInt16(44 + i * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
  }
  return new Uint8Array(data.buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Every audio clip the project's dialogue refers to. */
export function referencedAudio(project: { passages: { content: { type: string; audio?: AudioRef }[] }[] }): AudioRef[] {
  const out = new Map<string, AudioRef>();
  for (const p of project.passages) for (const b of p.content) if (b.type === 'dialogue' && b.audio) out.set(b.audio.id, b.audio);
  return [...out.values()];
}
