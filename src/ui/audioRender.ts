import { applyEdit, encodeWav, isRendered, type AudioAssets, type AudioRef } from '../core/audio';
import { cutSamples } from '../core/session';
import { decodeSession, getClip } from './audioStore';

// Non-destructive audio, like regions in Pro Tools: a clip can be a stretch of a session recording
// (AudioRef.region) and carry edits (trim, fades, gain) that never change the stored audio. Its
// sound is made from the source when it plays or exports. Unedited clips of their own pass through
// untouched, in their own format.

type Decoded = { samples: Float32Array; rate: number };

// Decoding a long session takes a moment, so the last few are kept while the app is open.
const cache = new Map<string, Promise<Decoded | null>>();
function decoded(id: string): Promise<Decoded | null> {
  let p = cache.get(id);
  if (!p) {
    p = getClip(id).then((c) => (c ? decodeSession(c.bytes) : null)).catch(() => null);
    cache.set(id, p);
    while (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Forget a decoded recording (its bytes changed, e.g. a session found again). */
export function forgetDecoded(id: string) {
  cache.delete(id);
}

/** A clip's samples, from its own bytes or its session's stretch, with its edits applied. */
export async function clipSamples(ref: AudioRef): Promise<Decoded | null> {
  const source = ref.region && ref.from ? await decoded(ref.from.session) : await decoded(ref.id);
  if (!source) return null;
  const raw = ref.region && ref.from ? cutSamples(source.samples, source.rate, ref.from) : source.samples;
  return { samples: applyEdit(raw, source.rate, ref.edit), rate: source.rate };
}

/** A clip's file: its own bytes when it's neither a region nor edited, otherwise rendered as WAV. */
export async function renderClip(ref: AudioRef): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (!isRendered(ref)) return (await getClip(ref.id)) ?? null;
  const s = await clipSamples(ref);
  return s ? { mime: 'audio/wav', bytes: encodeWav([s.samples], s.rate) } : null;
}

/** Rendered clips for exports, by clip id; any whose source isn't in this browser are left out. */
export async function renderClips(refs: AudioRef[]): Promise<AudioAssets> {
  const out: AudioAssets = {};
  for (const r of refs) {
    const c = await renderClip(r);
    if (c) out[r.id] = c;
  }
  return out;
}
