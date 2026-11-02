import { useEffect, useState } from 'react';
import type { AudioRef, VoiceSettings } from '../core/audio';
import { clipUrl, getClip } from './audioStore';

// Plays dialogue in order: a line's recorded clip if it has one, otherwise the browser's speech
// voice chosen for that character. Used by Playtest and the voice "Test" buttons.

export interface VoiceItem {
  text: string;
  audio?: AudioRef;
  voice?: VoiceSettings;
}

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

/** The system's speech voices (they load asynchronously in some browsers). */
export function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

export class VoiceQueue {
  private items: VoiceItem[] = [];
  private current: HTMLAudioElement | null = null;
  private busy = false;
  private generation = 0;

  enqueue(items: VoiceItem[]) {
    this.items.push(...items);
    if (!this.busy) void this.next();
  }

  stop() {
    this.generation++;
    this.items = [];
    this.busy = false;
    this.current?.pause();
    this.current = null;
    synth?.cancel();
  }

  private async next() {
    const gen = this.generation;
    const item = this.items.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    await this.play(item);
    if (gen === this.generation) void this.next();
  }

  private async play(item: VoiceItem): Promise<void> {
    if (item.audio) {
      const clip = await getClip(item.audio.id);
      if (clip) {
        const url = clipUrl(clip);
        const a = new Audio(url);
        this.current = a;
        await new Promise<void>((done) => {
          a.onended = a.onerror = () => done();
          a.play().catch(() => done());
        });
        URL.revokeObjectURL(url);
        return;
      }
    }
    if (!synth) return;
    await new Promise<void>((done) => {
      const u = new SpeechSynthesisUtterance(item.text);
      const v = item.voice;
      if (v?.voiceName) u.voice = synth.getVoices().find((x) => x.name === v.voiceName) ?? null;
      if (v?.rate) u.rate = v.rate;
      if (v?.pitch) u.pitch = v.pitch;
      u.onend = u.onerror = () => done();
      synth.speak(u);
    });
  }
}
