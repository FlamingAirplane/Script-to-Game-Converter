import type { AudioRef } from '../core/audio';
import { backgroundAfter, cueKind, type ParsedCue } from '../core/cues';
import { clipUrl } from './audioStore';
import { renderClip } from './audioRender';

// Plays the sounds writers attach to cues, in Playtest: music and ambience loop, one track each, fading
// from one to the next; any other cue with a sound plays it once. `sync` sets the music and ambience to
// where the story stands (after an undo or a restart too); `play` plays the one-off sounds of new cues.

const LOOP_VOLUME = 0.7;
const FADE_MS = 700;

interface Track {
  tag: string;
  el: HTMLAudioElement;
  url: string;
}

function fade(el: HTMLAudioElement, to: number, done?: () => void) {
  const from = el.volume;
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

function release(track: Track) {
  fade(track.el, 0, () => {
    track.el.pause();
    URL.revokeObjectURL(track.url);
  });
}

export class CuePlayer {
  private tracks: Record<'music' | 'ambience', Track | null> = { music: null, ambience: null };
  private wanted: Record<'music' | 'ambience', string | null> = { music: null, ambience: null };

  constructor(private sounds: () => Map<string, AudioRef>) {}

  /** Plays the one-off sounds among these (new) cues. */
  play(cues: ParsedCue[]) {
    const sounds = this.sounds();
    for (const c of cues) {
      const ref = cueKind(c.name) === 'sound' ? sounds.get(c.tag) : undefined;
      if (ref) void this.once(ref);
    }
  }

  /** Sets the music and ambience to where they stand after all these cues, read in order. */
  sync(cues: ParsedCue[]) {
    const sounds = this.sounds();
    const want = backgroundAfter(cues, (tag) => sounds.has(tag));
    void this.set('music', want.music);
    void this.set('ambience', want.ambience);
  }

  stop() {
    void this.set('music', null);
    void this.set('ambience', null);
  }

  private async set(which: 'music' | 'ambience', tag: string | null) {
    this.wanted[which] = tag;
    if ((this.tracks[which]?.tag ?? null) === tag) return;
    const old = this.tracks[which];
    this.tracks[which] = null;
    if (old) release(old);
    const ref = tag ? this.sounds().get(tag) : undefined;
    if (!tag || !ref) return;
    const clip = await renderClip(ref);
    // Something else was asked for while the clip loaded.
    if (!clip || this.wanted[which] !== tag || this.tracks[which]) return;
    const url = clipUrl(clip);
    const el = new Audio(url);
    el.loop = true;
    el.volume = 0;
    this.tracks[which] = { tag, el, url };
    el.play().then(
      () => fade(el, LOOP_VOLUME),
      () => undefined, // the browser may block sound until the reader clicks; the next cue tries again
    );
  }

  private async once(ref: AudioRef) {
    const clip = await renderClip(ref);
    if (!clip) return;
    const url = clipUrl(clip);
    const a = new Audio(url);
    a.onended = a.onerror = () => URL.revokeObjectURL(url);
    a.play().catch(() => URL.revokeObjectURL(url));
  }
}
