import JSZip from 'jszip';
import { log } from '../log';
import type { EngineAdapter, EngineTarget, ExportResult } from './types';
import { unityAdapter } from './unity';
import { unrealAdapter } from './unreal';
import { packageTarball } from './tar';

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

/** The Unity package of an export as a .tgz, for Package Manager's "Install package from tarball…". */
export async function unityTarball(result: ExportResult): Promise<Uint8Array | null> {
  const pkg = result.unityPackage;
  if (!pkg) return null;
  const done = log('export').time('Packed Unity tarball');
  const entries = result.files.filter((f) => f.path.startsWith(pkg.root)).map((f) => ({ path: f.path.slice(pkg.root.length), content: f.content }));
  const bytes = await packageTarball(entries);
  done({ files: entries.length, bytes: bytes.length });
  return bytes;
}

export function unityTarballName(result: ExportResult): string {
  return result.unityPackage ? `${result.unityPackage.name}-${result.unityPackage.version}.tgz` : `${result.rootName}.tgz`;
}

export { buildPlayableHtml, playableFileName } from './playable';
export { buildTwee, twineFileName, type TwineKind } from './twine';
export { buildRecordingScript, matchRecordings, recordingScriptFileName, recordingSlot, type RecordingMatch } from './script';
