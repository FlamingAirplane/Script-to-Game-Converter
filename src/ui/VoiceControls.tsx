import { useEffect, useRef, useState } from 'react';
import type { AudioRef, VoiceSettings } from '../core/audio';
import type { ContentBlock } from '../core/isr';
import { deleteClip, startRecording, storeClip, type Recorder } from './audioStore';
import { useSystemVoices, VoiceQueue } from './voice';

type Dialogue = Extract<ContentBlock, { type: 'dialogue' }>;
const preview = new VoiceQueue();

/** Record, attach, play or remove the clip for one line of dialogue. */

/** A clip's file name to show beside its line: without the extension, shortened in the middle if long. */
export function clipLabel(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return base.length > 28 ? `${base.slice(0, 16)}…${base.slice(-10)}` : base;
}
export function VoiceClip({ block, voice, onChange }: { block: Dialogue; voice?: VoiceSettings; onChange: (audio: AudioRef | undefined) => void }) {
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recorder]);
  useEffect(() => () => recorder?.cancel(), [recorder]);

  const save = async (blob: Blob, name: string) => {
    try {
      const ref = await storeClip(blob, name, block.speakerId);
      if (block.audio) await deleteClip(block.audio.id);
      onChange(ref);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const record = async () => {
    setError('');
    try {
      setSeconds(0);
      setRecorder(await startRecording());
    } catch {
      setError('Microphone not available. Allow access in the browser, or attach a file instead.');
    }
  };

  const stop = async () => {
    if (!recorder) return;
    const blob = await recorder.stop();
    setRecorder(null);
    await save(blob, `Recording ${new Date().toLocaleTimeString()}`);
  };

  return (
    <span className="voice-clip">
      {recorder ? (
        <button className="btn tiny rec" onClick={stop} aria-label="Stop recording">
          ■ stop · {seconds}s
        </button>
      ) : block.audio ? (
        <>
          <button className="icon" title={`Play ${block.audio.name}`} aria-label="Play voice clip" onClick={() => (preview.stop(), preview.enqueue([{ text: block.text, audio: block.audio }]))}>
            ▶
          </button>
          <span className="clip-name small" title={block.audio.name}>
            <span className="clip-file">{clipLabel(block.audio.name)}</span>
            {block.audio.durationMs ? ` · ${(block.audio.durationMs / 1000).toFixed(1)}s` : ''}
            {block.audio.from && <span className="muted" title="Cut from a recording session (Story settings → Recordings → Link a whole session)"> ✂</span>}
          </span>
          <button
            className="icon"
            title="Remove clip"
            aria-label="Remove voice clip"
            onClick={() => {
              void deleteClip(block.audio!.id);
              onChange(undefined);
            }}
          >
            ×
          </button>
        </>
      ) : (
        <>
          <button className="icon" title="Hear this line with the character's voice" aria-label="Hear line" onClick={() => (preview.stop(), preview.enqueue([{ text: block.text, voice }]))}>
            ▷
          </button>
          <button className="icon" title="Record this line" aria-label="Record voice clip" onClick={record}>
            ●
          </button>
          <button className="icon" title="Attach an audio file (WAV, MP3, OGG…)" aria-label="Attach voice clip" onClick={() => file.current?.click()}>
            ♪
          </button>
        </>
      )}
      <input
        ref={file}
        type="file"
        accept="audio/*"
        hidden
        aria-label="Voice clip file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void save(f, f.name);
          e.target.value = '';
        }}
      />
      {error && <span className="error-text small">{error}</span>}
    </span>
  );
}

const RATES = [
  { label: 'slow', value: 0.8 },
  { label: 'normal', value: 1 },
  { label: 'quick', value: 1.2 },
];
const PITCHES = [
  { label: 'low', value: 0.75 },
  { label: 'mid', value: 1 },
  { label: 'high', value: 1.3 },
];

/** Picks a browser speech voice (with speed and pitch) for a character. */
export function VoicePicker({ voice, name, onChange }: { voice?: VoiceSettings; name: string; onChange: (v: VoiceSettings | undefined) => void }) {
  const voices = useSystemVoices();
  const set = (patch: Partial<VoiceSettings>) => onChange({ ...voice, ...patch });
  const english = voices.filter((v) => v.lang.startsWith('en'));
  const list = english.length ? [...english, ...voices.filter((v) => !v.lang.startsWith('en'))] : voices;
  if (!voices.length) return <span className="muted small">no system voices</span>;
  return (
    <span className="voice-picker">
      <select className="input tiny-select" value={voice?.voiceName ?? ''} onChange={(e) => set({ voiceName: e.target.value || undefined })} aria-label={`Voice for ${name}`}>
        <option value="">default voice</option>
        {list.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
      <select className="input tiny-select" value={voice?.rate ?? 1} onChange={(e) => set({ rate: +e.target.value })} aria-label={`Speed for ${name}`}>
        {RATES.map((r) => (
          <option key={r.label} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <select className="input tiny-select" value={voice?.pitch ?? 1} onChange={(e) => set({ pitch: +e.target.value })} aria-label={`Pitch for ${name}`}>
        {PITCHES.map((r) => (
          <option key={r.label} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button className="icon" title={`Hear ${name}`} aria-label={`Hear ${name}'s voice`} onClick={() => (preview.stop(), preview.enqueue([{ text: `This is ${name}. The story begins.`, voice }]))}>
        ▷
      </button>
    </span>
  );
}
