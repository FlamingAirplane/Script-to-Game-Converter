import type { ExportFile, ExportResult } from './types';

// The NarrativeBridge plugin inside an Unreal export, as something to build and ship on its own. It is the same for every
// story (see the byte-identical test in tests/export-share.test.ts), so scripts/unreal-plugin-build.ts builds it once per
// engine version and platform, and the zip it makes goes into a project's Plugins/ folder (or on Fab).

export const PLUGIN_NAME = 'NarrativeBridge';

/** The plugin's files from an export, with paths relative to the plugin's own folder ("NarrativeBridge.uplugin", "Source/…"). */
export function pluginFilesOf(result: ExportResult): ExportFile[] {
  const prefix = `${result.rootName}/Plugins/${PLUGIN_NAME}/`;
  return result.files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}

/** "NarrativeBridge-0.5.0-UE5.7.zip": one zip per engine version, holding the binaries of every platform built. */
export function pluginZipName(version: string, engine: string): string {
  return `${PLUGIN_NAME}-${version}-UE${engine}.zip`;
}

export type PluginPlatform = 'Win64' | 'Mac';

export interface BuildPluginInput {
  /** The engine's folder (the one that holds Engine/). */
  engineDir: string;
  platform: PluginPlatform;
  /** The plugin's .uplugin file (a copy outside any project: BuildPlugin refuses a plugin that is inside one). */
  uplugin: string;
  /** Where BuildPlugin puts the finished plugin (it must not exist or be empty). */
  packageDir: string;
}

/** The RunUAT command that builds the plugin's binaries for one platform with an installed engine. */
export function buildPluginCommand(i: BuildPluginInput): { command: string; args: string[] } {
  const windows = i.platform === 'Win64';
  const uat = `${i.engineDir.replace(/[\\/]$/, '')}/Engine/Build/BatchFiles/RunUAT.${windows ? 'bat' : 'sh'}`;
  return { command: uat, args: ['BuildPlugin', `-Plugin=${i.uplugin}`, `-Package=${i.packageDir}`, `-TargetPlatforms=${i.platform}`] };
}

/** Whether a file from a built plugin belongs in the zip: sources and binaries, not the build's intermediate files. */
export function shipsInPluginZip(path: string): boolean {
  return !/(^|\/)(Intermediate|Saved|\.git)(\/|$)/.test(path) && !/\.(pdb|ilk|exp|lib)$/i.test(path);
}
