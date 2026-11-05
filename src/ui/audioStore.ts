import { encodeWav, NATIVE_AUDIO, newAudioId, type AudioAssets, type AudioRef } from '../core/audio';
import { newImageId, type ImageRef } from '../core/images';
import type { SessionRef } from '../core/session';
import { errorData, log } from '../core/log';

const logger = log('audio');

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

/** Stored bytes (voice clips or scene pictures) for the given references; missing ones are left out. */
export async function collectClips(refs: { id: string }[]): Promise<AudioAssets> {
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
  const originalMime = mime;
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
    logger.warn('Could not decode audio clip', { type: blob.type || 'unknown', bytes: raw.byteLength });
    if (!NATIVE_AUDIO.has(mime)) throw new Error('This audio file could not be read. Use WAV, MP3 or OGG.');
  }
  const id = newAudioId(seed);
  await putClip(id, mime, bytes);
  logger.info('Stored voice clip', { id, mime, bytes: bytes.length, originalType: blob.type || 'unknown', converted: mime !== originalMime, durationMs });
  return { id, name, mime, durationMs };
}

export interface Recorder {
  stop(): Promise<Blob>;
  cancel(): void;
}

/** Records from the microphone (the browser asks permission the first time). */
export async function startRecording(): Promise<Recorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    logger.warn('Microphone unavailable', errorData(e));
    throw e;
  }
  logger.debug('Recording started');
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

/** Pictures larger than this on their longest side are scaled down: plenty for a 4K screen, and keeps files small. */
const MAX_PICTURE_SIDE = 2560;

/**
 * Stores a scene picture (in the same browser store as voice clips). PNG and JPEG are kept as they are
 * unless very large; other formats (WebP, GIF, HEIC where the browser reads it…) become PNG, which every
 * engine loads. JPEGs stay JPEG so photos stay small.
 */
export async function storeImage(file: Blob, name: string, seed: string): Promise<ImageRef> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    logger.warn('Could not decode picture', { type: file.type || 'unknown', bytes: file.size });
    throw new Error('This picture could not be read. Use PNG, JPEG or WebP.');
  }
  const { width, height } = bitmap;
  const kept = file.type === 'image/png' || file.type === 'image/jpeg';
  let mime: ImageRef['mime'] = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  let bytes: Uint8Array;
  let size = { width, height };
  if (kept && Math.max(width, height) <= MAX_PICTURE_SIDE) bytes = new Uint8Array(await file.arrayBuffer());
  else {
    const k = Math.min(1, MAX_PICTURE_SIDE / Math.max(width, height));
    size = { width: Math.round(width * k), height: Math.round(height * k) };
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.9));
    if (!blob) throw new Error('This picture could not be converted.');
    mime = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  bitmap.close();
  const id = newImageId(seed);
  await putClip(id, mime, bytes);
  logger.info('Stored scene picture', { id, mime, bytes: bytes.length, originalType: file.type || 'unknown', ...size });
  return { id, name, mime, ...size };
}

// ---- Recording sessions (see src/core/session.ts) --------------------------------------------

/** Keeps a whole session recording in this browser, as it is. */
export async function storeSession(file: Blob, name: string): Promise<SessionRef> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = (file.type.split(';')[0] || 'audio/wav').replace(/^audio\/(x-wav|wave|vnd\.wave)$/, 'audio/wav');
  const decoded = await decodeSession(raw);
  const id = `ses_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  await putClip(id, mime, raw);
  logger.info('Stored recording session', { id, mime, bytes: raw.length, seconds: Math.round(decoded.samples.length / decoded.rate) });
  return { id, name, mime, durationMs: Math.round((decoded.samples.length / decoded.rate) * 1000) };
}

/** A session's sound as one channel of samples (mixed down), at 44.1 kHz. */
export async function decodeSession(bytes: Uint8Array): Promise<{ samples: Float32Array; rate: number }> {
  let buf: AudioBuffer;
  try {
    buf = await decode(bytes.slice().buffer as ArrayBuffer);
  } catch {
    throw new Error('This recording could not be read. Use WAV, MP3, OGG, M4A or FLAC.');
  }
  const samples = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) samples[i] += ch[i] / buf.numberOfChannels;
  }
  return { samples, rate: buf.sampleRate };
}
