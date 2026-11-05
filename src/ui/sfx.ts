import { designSetting } from './design/design';
// Book sounds, synthesised with the Web Audio API (no audio files, nothing to license):
// a papery page turn, a soft quill tap for choices, a small bell for endings, and an embossing
// stamp when an export is bound. Quiet by design, and switchable from the cover band.

const KEY = 'narrative-bridge.sounds';
let ctx: AudioContext | null = null;
let enabled = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    // Someone who hasn't chosen gets the design's default (see the admin design editor).
    return saved ? saved !== 'off' : designSetting<boolean>('sound');
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (!enabled || typeof AudioContext === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function envelope(c: AudioContext, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

export const sfx = {
  get enabled() {
    return enabled;
  },
  setEnabled(on: boolean) {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* preference not saved */
    }
  },

  /** A leaf turning: a band of noise sweeping upward, soft attack, quick fall. */
  pageTurn() {
    const c = audio();
    if (!c) return;
    const src = noise(c, 0.45);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(900, c.currentTime);
    band.frequency.exponentialRampToValueAtTime(3800, c.currentTime + 0.32);
    const g = envelope(c, 0.13, 0.06, 0.32);
    src.connect(band).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + 0.45);
  },

  /** A quill touching paper: a tiny tick with a soft body. */
  choice() {
    const c = audio();
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(280, c.currentTime + 0.07);
    const g = envelope(c, 0.09, 0.004, 0.09);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.12);
    const tick = noise(c, 0.03);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    tick.connect(hp).connect(envelope(c, 0.05, 0.002, 0.02)).connect(c.destination);
    tick.start();
  },

  /** A small bell for "The End": a few inharmonic partials ringing out. */
  chime() {
    const c = audio();
    if (!c) return;
    for (const [f, v] of [
      [660, 0.07],
      [1320, 0.035],
      [1980, 0.02],
      [2640, 0.012],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = envelope(c, v, 0.01, 1.8);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 2);
    }
  },

  /** An embossing stamp when an export is bound: a low thud with a press of noise. */
  stamp() {
    const c = audio();
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.18);
    o.connect(envelope(c, 0.18, 0.005, 0.2)).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.25);
    const n = noise(c, 0.08);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    n.connect(lp).connect(envelope(c, 0.06, 0.003, 0.06)).connect(c.destination);
    n.start();
  },
};
