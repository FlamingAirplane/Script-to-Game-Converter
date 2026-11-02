import { encodeWav, NATIVE_AUDIO, newAudioId, type AudioAssets, type AudioRef } from '../core/audio';

// Clip storage in the browser (IndexedDB: recordings are too large for localStorage), plus
// recording and conversion helpers. Everything stays on this computer.

const DB = 'narrative-bridge-audio';
const STORE = 'clips';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putClip(id: string, mime: string, bytes: Uint8Array): Promise<void> {
  await tx('readwrite', (s) => s.put({ mime, bytes }, id));
}

export async function getClip(id: string): Promise<{ mime: string; bytes: Uint8Array } | undefined> {
  try {
    return await tx('readonly', (s) => s.get(id));
  } catch {
    return undefined;
  }
}

export async function deleteClip(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* already gone */
  }
}

/** Clip bytes for the given references (missing ones are simply left out). */
export async function collectClips(refs: AudioRef[]): Promise<AudioAssets> {
  const out: AudioAssets = {};
  for (const r of refs) {
    const c = await getClip(r.id);
    if (c) out[r.id] = c;
  }
  return out;
}

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes);
}

/**
 * Stores an uploaded or recorded clip. WAV, MP3 and OGG are kept as they are; anything else
 * (e.g. a browser recording in WebM or MP4) is converted to WAV so every engine can play it.
 */
export async function storeClip(blob: Blob, name: string, seed: string): Promise<AudioRef> {
  const raw = await blob.arrayBuffer();
  // Browsers name the same formats differently (WebKit: audio/x-wav); store one canonical type.
  let mime = (blob.type.split(';')[0] || 'audio/wav').replace(/^audio\/(x-wav|wave|vnd\.wave)$/, 'audio/wav').replace(/^audio\/mp3$/, 'audio/mpeg');
  let bytes: Uint8Array = new Uint8Array(raw);
  let durationMs: number | undefined;
  try {
    const buf = await decode(raw.slice(0));
    durationMs = Math.round(buf.duration * 1000);
    if (!NATIVE_AUDIO.has(mime)) {
      bytes = encodeWav(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate);
      mime = 'audio/wav';
    }
  } catch {
    if (!NATIVE_AUDIO.has(mime)) throw new Error('This audio file could not be read. Use WAV, MP3 or OGG.');
  }
  const id = newAudioId(seed);
  await putClip(id, mime, bytes);
  return { id, name, mime, durationMs };
}

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
}

/** Records from the microphone (the browser asks permission the first time). */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = release;
      rec.stop();
    },
  };
}

export function clipUrl(clip: { mime: string; bytes: Uint8Array }): string {
  return URL.createObjectURL(new Blob([clip.bytes as BlobPart], { type: clip.mime }));
}
