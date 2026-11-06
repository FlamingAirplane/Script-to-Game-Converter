import type { AudioRef } from './audio';
import { cueTag, RESERVED_TAGS, type StoryProject } from './isr';

// Cues and their sounds. A cue is an Ink tag (#music:calm); a writer can attach a sound to it in Review,
// and every cue with the same name and value then plays that sound: in Playtest, the playable web page,
// and the Unity package (NarrativeCuePlayer). What a cue does follows from its name, the same way in all
// of them (and as NarrativeCuePlayer.Guess sets it up in Unity).

export type CueKind = 'music' | 'ambience' | 'stop_music' | 'stop_ambience' | 'shake' | 'sound';

/** What a cue does, from its name: music and ambience loop (one track each), stop_… stops them, shake shakes, anything else is a sound. */
export function cueKind(name: string): CueKind {
  const n = name.toLowerCase();
  if (n.includes('stop_music') || n === 'silence') return 'stop_music';
  if (n.includes('stop_ambience')) return 'stop_ambience';
  if (n.includes('music') || n === 'song' || n === 'track') return 'music';
  if (n.includes('ambien') || n === 'weather') return 'ambience';
  if (n.includes('shake') || n === 'rumble') return 'shake';
  return 'sound';
}

/** Whether a cue of this name can have a sound (music, ambience and sounds; not stops or shakes). */
export function cueTakesSound(name: string): boolean {
  const k = cueKind(name);
  return k === 'music' || k === 'ambience' || k === 'sound';
}

/** Whether this cue would play a sound if one were attached (music or ambience with a track named, or a sound). */
export function cueWantsSound(name: string, value: string | undefined): boolean {
  const k = cueKind(name);
  return k === 'sound' || ((k === 'music' || k === 'ambience') && !!value);
}

export interface ParsedCue {
  name: string;
  value: string;
  /** The tag as Ink has it, e.g. "music:calm". */
  tag: string;
}

/** The cues among a line's tags (the ones that aren't Narrative Bridge's own, such as speaker: or audio:). */
export function cuesIn(tags: string[]): ParsedCue[] {
  const out: ParsedCue[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const colon = tag.indexOf(':');
    const name = (colon < 0 ? tag : tag.slice(0, colon)).trim();
    if (!name || RESERVED_TAGS.has(name)) continue;
    out.push({ name, value: colon < 0 ? '' : tag.slice(colon + 1).trim(), tag });
  }
  return out;
}

/** The sound attached to each cue tag (the first one, when cues with the same tag disagree). */
export function cueSounds(project: Pick<StoryProject, 'passages'>): Map<string, AudioRef> {
  const out = new Map<string, AudioRef>();
  for (const p of project.passages)
    for (const b of p.content) if (b.type === 'cue' && b.audio && cueTakesSound(b.name) && !out.has(cueTag(b.name, b.value))) out.set(cueTag(b.name, b.value), b.audio);
  return out;
}

/** How many cues in the story share this tag (and so this sound). */
export function cuesWithTag(project: Pick<StoryProject, 'passages'>, tag: string): number {
  let n = 0;
  for (const p of project.passages) for (const b of p.content) if (b.type === 'cue' && cueTag(b.name, b.value) === tag) n++;
  return n;
}

/** Attaches a sound to every cue with this tag (or takes it away, for undefined). */
export function setCueSound(project: Pick<StoryProject, 'passages'>, tag: string, audio: AudioRef | undefined): void {
  for (const p of project.passages)
    for (const b of p.content) {
      if (b.type !== 'cue' || cueTag(b.name, b.value) !== tag) continue;
      if (audio) b.audio = audio;
      else delete b.audio;
    }
}

/**
 * Where the music and ambience stand after these cues, read in order: the tag of the track playing (null
 * when stopped). A music or ambience cue without a sound attached leaves things as they were, as in Unity.
 */
export function backgroundAfter(cues: ParsedCue[], hasSound: (tag: string) => boolean, start: { music: string | null; ambience: string | null } = { music: null, ambience: null }) {
  let { music, ambience } = start;
  for (const c of cues) {
    const k = cueKind(c.name);
    if (k === 'stop_music' || (k === 'music' && !c.value)) music = null;
    else if (k === 'stop_ambience' || (k === 'ambience' && !c.value)) ambience = null;
    else if (k === 'music' && hasSound(c.tag)) music = c.tag;
    else if (k === 'ambience' && hasSound(c.tag)) ambience = c.tag;
  }
  return { music, ambience };
}
