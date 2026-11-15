import type { StoryProject } from '../core/isr';

// A small story carried in a link: the project, compressed, after the # of the app's address. The part after #
// never leaves the browser (it isn't sent to the website), so the story goes only to whoever is given the link.
// Pictures and recordings aren't included (a link that held them would be far too long); a project file carries those.

export const LINK_PREFIX = '#story=';
/** A play link: the same story, opened to read and leave notes on rather than to edit (see PlayLinkView.tsx). */
export const PLAY_PREFIX = '#play=';
/** Links longer than this are refused: chat apps and email cut them, and some browsers won't open them. */
export const MAX_LINK_CHARS = 60_000;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function canMakeLinks(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/** The story without what a link can't carry: media references stay, so the story still reads and plays. */
function forLink(project: StoryProject): StoryProject {
  // The original scripts' text is kept: Review shows it beside each passage, and it compresses well.
  return { ...project, sources: project.sources.map(({ original: _, ...s }) => s) };
}

/** A link that opens this story in the app at `base` (the app's address), or why there can't be one. */
export async function storyLink(project: StoryProject, base: string, prefix: string = LINK_PREFIX): Promise<{ url: string } | { error: string }> {
  if (!canMakeLinks()) return { error: 'This browser can’t make story links. Save a project file instead.' };
  const json = JSON.stringify({ format: 'narrative-bridge-project', project: forLink(project) });
  const data = toBase64Url(await through(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
  const url = `${base.replace(/#.*$/, '')}${prefix}${data}`;
  if (url.length > MAX_LINK_CHARS)
    return { error: `This story is too long for a link (${Math.round(url.length / 1000)} thousand characters; links stop working past ${MAX_LINK_CHARS / 1000} thousand). Save a project file instead.` };
  return { url };
}

/** The project file text a link's # part holds, ready for unpackProject; null if it isn't a story link. */
export async function readStoryLink(hash: string, prefix: string = LINK_PREFIX): Promise<string | null> {
  if (!hash.startsWith(prefix)) return null;
  const bytes = await through(fromBase64Url(hash.slice(prefix.length)), new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(bytes);
}
