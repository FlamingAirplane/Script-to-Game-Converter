import JSZip from 'jszip';
import { CONDITION_H, INK_COMPAT_H, INK_H, INK_OBSERVER_H, INVENTORY_H, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_H, STORY_DATA_H, TYPES_H } from './unrealRuntime';
import { COMPONENT_H } from './unrealComponent';
import { CUE_PLAYER_H, ENTER_DIALOGUE_TRIGGER_H, INVENTORY_COMPONENT_H, TRIGGER_H } from './unrealCues';
import { DEMO_H, PANEL_H, WIDGET_H } from './unrealUi';
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

/** The runtime module's Blueprint-visible types: what a Blueprint saved with an earlier export refers to as /Script/<ProjectName>.<Name>. */
export function runtimeTypes(): { classes: string[]; structs: string[]; enums: string[] } {
  const headers = [TYPES_H, COMPONENT_H, CUE_PLAYER_H, ENTER_DIALOGUE_TRIGGER_H, INVENTORY_COMPONENT_H, TRIGGER_H, INVENTORY_H, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_H, STORY_DATA_H, DEMO_H, PANEL_H, WIDGET_H, CONDITION_H, INK_H, INK_OBSERVER_H, INK_COMPAT_H];
  // A macro's arguments can hold parentheses of their own: UCLASS(ClassGroup = (NarrativeBridge), meta = (…)).
  const args = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
  const all = (re: RegExp) => headers.flatMap((h) => [...h.matchAll(re)].map((m) => m[1]));
  // NarrativeTheme.h is filled in by themeH (unrealUi.ts), not a template file.
  const theme = { classes: ['NarrativeThemeAsset', 'NarrativeThemeLibrary'], structs: ['NarrativeTheme'] };
  return {
    // UCLASS and UINTERFACE: the name without its U (an interface is also declared as I…, which has no redirect of its own).
    classes: [...new Set([...all(new RegExp(String.raw`\b(?:UCLASS|UINTERFACE)${args}\s*class\s+(?:__API__\s+)?[UA](\w+)`, 'g')), ...theme.classes])],
    structs: [...new Set([...all(new RegExp(String.raw`\bUSTRUCT${args}\s*struct\s+(?:__API__\s+)?F(\w+)`, 'g')), ...theme.structs])],
    enums: [...new Set(all(new RegExp(String.raw`\bUENUM${args}\s*enum\s+class\s+E(\w+)`, 'g')))],
  };
}

/**
 * Unreal's CoreRedirects for a project that was exported before the code moved into the NarrativeBridge plugin: Blueprints
 * and assets saved then refer to the types as /Script/<ProjectName>.<Name>, which now live in /Script/NarrativeBridge.
 * Goes in Config/DefaultEngine.ini (the export writes it there).
 */
export function coreRedirectsIni(oldModule: string): string {
  const t = runtimeTypes();
  const line = (kind: string, name: string) => `+${kind}Redirects=(OldName="/Script/${oldModule}.${name}",NewName="/Script/${PLUGIN_NAME}.${name}")`;
  return `[CoreRedirects]\n${[...t.classes.map((n) => line('Class', n)), ...t.structs.map((n) => line('Struct', n)), ...t.enums.map((n) => line('Enum', n))].join('\n')}\n`;
}

export interface PluginOverlay {
  files: ExportFile[];
  warnings: string[];
}

/**
 * Puts a prebuilt plugin (the zip scripts/unreal-plugin-build.ts makes) into an export: its files replace the export's
 * plugin files, so the project opens without compiling. Warns when the plugin's version or engine doesn't match the export's.
 */
export async function overlayPluginZip(files: ExportFile[], rootName: string, zipBytes: Uint8Array, zipName: string, wanted: { engineVersion: string; pluginVersion: string }): Promise<PluginOverlay> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(zipBytes);
  const prefix = `${PLUGIN_NAME}/`;
  const inZip = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(prefix));
  const uplugin = zip.file(`${prefix}${PLUGIN_NAME}.uplugin`);
  if (!uplugin) throw new Error(`That zip has no ${PLUGIN_NAME}/${PLUGIN_NAME}.uplugin: is it a plugin built by scripts/unreal-plugin-build.ts?`);
  const descriptor = JSON.parse(await uplugin.async('string')) as { VersionName?: string };
  if (descriptor.VersionName !== wanted.pluginVersion) warnings.push(`The prebuilt plugin is version ${descriptor.VersionName ?? 'unknown'} but this export was made with ${wanted.pluginVersion}: the story data may need a different plugin than the one in the zip.`);
  if (!inZip.some((f) => f.name.startsWith(`${prefix}Binaries/`))) warnings.push('The prebuilt plugin has no Binaries/, so the project will still need a C++ toolchain to build it.');
  // Binaries are for one engine version, which only the zip's name says: the editor refuses them on another.
  const built = /-UE(\d+\.\d+)\.zip$/.exec(zipName)?.[1];
  if (built && built !== wanted.engineVersion) warnings.push(`The prebuilt plugin is for Unreal Engine ${built} but this export is for ${wanted.engineVersion}: the editor will want to rebuild it.`);
  const dest = `${rootName}/Plugins/${PLUGIN_NAME}/`;
  const kept = files.filter((f) => !f.path.startsWith(dest));
  const added: ExportFile[] = [];
  for (const f of inZip) added.push({ path: dest + f.name.slice(prefix.length), content: await f.async('uint8array') });
  return { files: [...kept, ...added], warnings };
}
