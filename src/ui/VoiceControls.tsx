import { useEffect, useRef, useState } from 'react';
import { hasEdit, type AudioRef, type ClipEdit, type VoiceSettings } from '../core/audio';
import { cueKind, cueSounds, cuesWithTag, cueTakesSound } from '../core/cues';
import { cueTag, type ContentBlock, type StoryProject } from '../core/isr';
import { startRecording, storeClip, type Recorder } from './audioStore';
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
  const [editing, setEditing] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recorder]);
  useEffect(() => () => recorder?.cancel(), [recorder]);

  const save = async (blob: Blob, name: string) => {
    try {
      // The clip it replaces stays in the browser, so Undo can bring it back.
      const ref = await storeClip(blob, name, block.speakerId);
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
            onClick={() => onChange(undefined)}
          >
            ×
          </button>
          <button className={`icon${hasEdit(block.audio.edit) ? ' edited' : ''}`} aria-expanded={editing} title="Trim, fade and change the volume (the recording itself is never changed)" aria-label="Edit voice clip" onClick={() => setEditing(!editing)}>
            ✎
          </button>
          {editing && <ClipEditor audio={block.audio} onChange={onChange} onPlay={(a) => (preview.stop(), preview.enqueue([{ text: block.text, audio: a }]))} onClose={() => setEditing(false)} />}
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

/**
 * Non-destructive edits to a clip, like a region's in Pro Tools: trim, fades and gain, plus where a
 * session region sits in its session. Each change is saved to the story straight away (Undo takes it
 * back); the recording itself is never changed. ▶ plays the clip with its edits.
 */
function ClipEditor({ audio, onChange, onPlay, onClose }: { audio: AudioRef; onChange: (a: AudioRef) => void; onPlay: (a: AudioRef) => void; onClose: () => void }) {
  const e = audio.edit ?? {};
  const length = (audio.region && audio.from ? audio.from.end - audio.from.start : (audio.durationMs ?? 10000) / 1000) || 10;
  const setEdit = (patch: Partial<ClipEdit>) => {
    const next: ClipEdit = { ...e, ...patch };
    for (const k of Object.keys(next) as (keyof ClipEdit)[]) if (!next[k]) delete next[k];
    onChange({ ...audio, edit: Object.keys(next).length ? next : undefined });
  };
  const num = (key: keyof ClipEdit, label: string, min: number, max: number, step: number, unit: string) => (
    <label className="clip-edit-field">
      <span className="muted small">
        {label}: {(e[key] ?? 0).toFixed(unit === 'dB' ? 1 : 2)} {unit}
      </span>
      <input type="range" min={min} max={max} step={step} value={e[key] ?? 0} onChange={(ev) => setEdit({ [key]: Number(ev.target.value) })} aria-label={label} />
    </label>
  );
  return (
    <div className="clip-editor" role="group" aria-label="Edit voice clip">
      {audio.region && audio.from && (
        <p className="muted small">
          A stretch of a recording session, {audio.from.start.toFixed(2)}–{audio.from.end.toFixed(2)} s. Move it in Story settings → Recordings → Link a whole session.
        </p>
      )}
      <div className="clip-edit-grid">
        {num('trimStart', 'Trim start', 0, Math.max(0.1, length / 2), 0.01, 's')}
        {num('trimEnd', 'Trim end', 0, Math.max(0.1, length / 2), 0.01, 's')}
        {num('fadeIn', 'Fade in', 0, Math.min(3, length / 2), 0.01, 's')}
        {num('fadeOut', 'Fade out', 0, Math.min(3, length / 2), 0.01, 's')}
        {num('gain', 'Volume', -24, 12, 0.5, 'dB')}
      </div>
      <div className="row">
        <button className="btn tiny" onClick={() => onPlay(audio)}>
          ▶ Play with edits
        </button>
        <button className="btn tiny ghost" disabled={!hasEdit(audio.edit)} onClick={() => onChange({ ...audio, edit: undefined })}>
          Undo all edits
        </button>
        <span className="spacer" />
        <span className="muted small">Saved as you go; the recording is never changed.</span>
        <button className="btn tiny" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
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

type Cue = Extract<ContentBlock, { type: 'cue' }>;

/**
 * The sound a cue plays: attach a file (WAV, MP3, OGG…), play it, or take it away. A sound belongs to the cue's
 * name and value, so every "music: calm" cue in the story plays the same one; Playtest, the playable web page and
 * the Unity package all play it. Stops and shakes have no sound.
 */
export function CueSound({ block, project, onSet }: { block: Cue; project: StoryProject; onSet: (tag: string, audio: AudioRef | undefined) => void }) {
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const tag = cueTag(block.name, block.value);
  const kind = cueKind(block.name);
  if (!cueTakesSound(block.name))
    return <p className="muted small cue-sound">{kind === 'shake' ? 'Shakes the screen in the game; no sound needed.' : kind === 'stop_music' ? 'Stops the music.' : 'Stops the ambience.'}</p>;
  if ((kind === 'music' || kind === 'ambience') && !block.value)
    return <p className="muted small cue-sound">With no {kind === 'music' ? 'track' : 'sound'} named, this stops the {kind}. Name one (e.g. calm) to give it a sound.</p>;
  const audio = block.audio ?? cueSounds(project).get(tag);
  const shared = cuesWithTag(project, tag);
  const attach = async (f: File) => {
    try {
      onSet(tag, await storeClip(f, f.name, `cue_${block.name}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="row wrap cue-sound">
      <span className="muted small">Sound</span>
      {audio ? (
        <>
          <button className="icon" title={`Play ${audio.name}`} aria-label="Play cue sound" onClick={() => (preview.stop(), preview.enqueue([{ text: '', audio }]))}>
            ▶
          </button>
          <span className="clip-name small" title={audio.name}>
            <span className="clip-file">{clipLabel(audio.name)}</span>
            {audio.durationMs ? ` · ${(audio.durationMs / 1000).toFixed(1)}s` : ''}
          </span>
          <button className="icon" title="Remove the sound" aria-label="Remove cue sound" onClick={() => (preview.stop(), onSet(tag, undefined))}>
            ×
          </button>
        </>
      ) : (
        <button className="btn tiny" onClick={() => file.current?.click()}>
          Attach a sound…
        </button>
      )}
      <span className="muted small">
        {kind === 'music' ? 'Loops until the next music cue. ' : kind === 'ambience' ? 'Loops until the next ambience cue. ' : 'Plays once. '}
        {shared > 1 ? `Every “${tag.replace(':', ': ')}” cue (${shared}) plays it.` : ''}
      </span>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        hidden
        aria-label="Cue sound file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = '';
        }}
      />
      {error && <span className="error-text small">{error}</span>}
    </div>
  );
}
