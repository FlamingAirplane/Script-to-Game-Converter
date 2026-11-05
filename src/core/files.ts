import { audioExtension, audioFileName, isRendered, type AudioRef } from './audio';
import { imageFileName } from './images';
import type { SourceDocument, StoryProject } from './isr';

// Every file a story holds, for downloading them again: the scripts it was made from, the voice
// recordings on its lines, its scene pictures and its character portraits. Scripts are kept as text
// (a Word, PDF, Final Draft or Twine file as the text taken from it); media bytes live in the browser
// (see src/ui/audioStore.ts) and are fetched by `id`.

export type StoryFileKind = 'script' | 'recording' | 'picture' | 'portrait';

export interface StoryFile {
  kind: StoryFileKind;
  /** The name to save it under. */
  fileName: string;
  /** What it is, e.g. the passage and line a recording belongs to. */
  context: string;
  /** Media: the id of its bytes in the browser. */
  id?: string;
  /** Recordings: the clip, which may be a region or edited, so it's rendered to download. */
  audio?: AudioRef;
  mime: string;
  /** Scripts: their text. */
  text?: string;
  /** Scripts: the format the original was converted from, when it wasn't text (e.g. "docx"). */
  convertedFrom?: string;
}

const SCRIPT_EXT: Record<SourceDocument['format'], string> = { txt: 'txt', fountain: 'fountain', md: 'md', ink: 'ink', twee: 'twee' };

/** A file name made safe for every system, keeping its extension. */
export function safeFileName(name: string, fallback = 'file'): string {
  const clean = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(-120);
  return clean || fallback;
}

/** `name` with this extension (replacing another one). */
function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

const snippet = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function storyFiles(project: StoryProject): StoryFile[] {
  const files: StoryFile[] = [];
  for (const s of project.sources) {
    const ext = SCRIPT_EXT[s.format] ?? 'txt';
    const own = s.fileName.toLowerCase().endsWith(`.${ext}`);
    const from = own ? undefined : (s.fileName.split('.').pop() ?? '').toLowerCase() || undefined;
    files.push({
      kind: 'script',
      fileName: safeFileName(own ? s.fileName : withExtension(s.fileName, ext), `script.${ext}`),
      context: from ? `the text of ${s.fileName}` : 'the original script',
      mime: 'text/plain',
      text: s.text,
      convertedFrom: from,
    });
  }
  const speakers = new Map(project.characters.map((c) => [c.id, c.displayName]));
  const seen = new Set<string>();
  for (const p of project.passages) {
    if (p.image && !seen.has(p.image.id)) {
      seen.add(p.image.id);
      files.push({ kind: 'picture', fileName: safeFileName(p.image.name, imageFileName(p.image)), context: p.title || p.id, id: p.image.id, mime: p.image.mime });
    }
    for (const b of p.content) {
      if (b.type !== 'dialogue' || !b.audio || seen.has(b.audio.id)) continue;
      seen.add(b.audio.id);
      const ext = isRendered(b.audio) ? 'wav' : audioExtension(b.audio.mime);
      const name = b.audio.name.toLowerCase().endsWith(`.${ext}`) ? b.audio.name : isRendered(b.audio) ? withExtension(b.audio.name, 'wav') : audioFileName(b.audio);
      files.push({ kind: 'recording', audio: b.audio, fileName: safeFileName(name, audioFileName(b.audio)), context: `${p.title || p.id} · ${speakers.get(b.speakerId) ?? b.speakerId}: “${snippet(b.text)}”`, id: b.audio.id, mime: isRendered(b.audio) ? 'audio/wav' : b.audio.mime });
    }
  }
  for (const c of project.characters)
    if (c.portrait && !seen.has(c.portrait.id)) {
      seen.add(c.portrait.id);
      files.push({ kind: 'portrait', fileName: safeFileName(c.portrait.name, imageFileName(c.portrait)), context: c.displayName, id: c.portrait.id, mime: c.portrait.mime });
    }
  return files;
}

const FOLDER: Record<StoryFileKind, string> = { script: 'Scripts', recording: 'Recordings', picture: 'Scene pictures', portrait: 'Portraits' };

/** Where each file goes in a "download all" zip: a folder per kind, names made unique. */
export function zipPaths(files: StoryFile[]): string[] {
  const used = new Set<string>();
  return files.map((f) => {
    let path = `${FOLDER[f.kind]}/${f.fileName}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) {
      const dot = f.fileName.lastIndexOf('.');
      path = `${FOLDER[f.kind]}/${dot > 0 ? `${f.fileName.slice(0, dot)} (${i})${f.fileName.slice(dot)}` : `${f.fileName} (${i})`}`;
    }
    used.add(path.toLowerCase());
    return path;
  });
}
