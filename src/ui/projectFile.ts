import { base64ToBytes, bytesToBase64, referencedAudio } from '../core/audio';
import type { Diagnostic } from '../core/diagnostics';
import { referencedImages } from '../core/images';
import type { StoryProject } from '../core/isr';
import { validateSchema } from '../core/schema';
import { collectClips, putClip } from './audioStore';

// A complete project in one file (.nbproj.json): the story, and every piece of media it uses, so it
// opens the same in any browser. The same file goes to the cloud (cloud.ts).

/** The ids of every stored file a project needs: clips of their own, pictures, session recordings, originals. */
export function projectMediaRefs(project: StoryProject): { id: string }[] {
  const originals = (project.sources as { original?: { id: string } }[]).flatMap((s) => (s.original ? [s.original] : []));
  return [...referencedAudio(project).filter((a) => !(a as { region?: boolean }).region), ...referencedImages(project), ...(project.sessions ?? []), ...originals];
}

/** The project and all its media as the text of a project file. */
export async function packProject(project: StoryProject, parseDiagnostics: Diagnostic[]): Promise<{ json: string; files: number; missing: number }> {
  const refs = projectMediaRefs(project);
  const clips = await collectClips(refs);
  // Every kind of media shares the "audio" map (same store, keyed by id), so older versions still open the file.
  const audio = Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, { mime: c.mime, data: bytesToBase64(c.bytes) }]));
  const json = JSON.stringify({ format: 'narrative-bridge-project', savedAt: new Date().toISOString(), project, parseDiagnostics, audio }, null, 2);
  return { json, files: Object.keys(audio).length, missing: new Set(refs.map((r) => r.id)).size - Object.keys(audio).length };
}

/** Reads a project file's text: stores its media in this browser and returns the story. Throws if it isn't one. */
export async function unpackProject(text: string): Promise<{ project: StoryProject; parseDiagnostics: Diagnostic[]; files: number }> {
  const data = JSON.parse(text);
  const project: StoryProject = data.project?.schemaVersion ? data.project : data;
  const errs = validateSchema(project).filter((d) => d.severity === 'error');
  if (errs.length) throw new Error(`Not a valid Narrative Bridge project:\n${errs.map((e) => e.message).join('\n')}`);
  const media = Object.entries((data.audio ?? {}) as Record<string, { mime: string; data: string }>);
  for (const [id, c] of media) await putClip(id, c.mime, base64ToBytes(c.data));
  return { project, parseDiagnostics: data.parseDiagnostics ?? [], files: media.length };
}
