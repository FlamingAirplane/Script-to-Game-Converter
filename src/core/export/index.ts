import JSZip from 'jszip';
import { log } from '../log';
import type { EngineAdapter, EngineTarget, ExportResult } from './types';
import { unityAdapter } from './unity';
import { unrealAdapter } from './unreal';

export * from './types';
export { ExportBlockedError } from './common';

export const ADAPTERS: Record<EngineTarget, EngineAdapter> = { unity: unityAdapter, unreal: unrealAdapter };

export async function zipExport(result: ExportResult): Promise<Uint8Array> {
  const done = log('export').time('Zipped package');
  const zip = new JSZip();
  for (const f of result.files) zip.file(f.path, f.content, { unixPermissions: f.path.endsWith('.sh') ? 0o755 : 0o644 });
  const bytes = await zip.generateAsync({ type: 'uint8array', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  done({ files: result.files.length, bytes: bytes.length });
  return bytes;
}

export { buildPlayableHtml, playableFileName } from './playable';
export { buildTwee, twineFileName, type TwineKind } from './twine';
export { buildRecordingScript, matchRecordings, recordingScriptFileName, recordingSlot, type RecordingMatch } from './script';
