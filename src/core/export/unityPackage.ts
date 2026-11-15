import { sha256Hex } from '../hash';
import { foldAccents, nameCode } from '../isr';
import { pascalCase } from './common';
import type { ExportFile } from './types';
import { ENTER_DIALOGUE_TRIGGER_CS, FIRST_OPEN_CS, SAMPLE_EXITS_CS, SAMPLE_INVENTORY_CS, SAMPLE_LISTENER_CS, SAMPLE_TRIGGER_CS, SETUP_CS, STORY_POINT_DRAWERS_CS } from './templates.generated';
export { ENTER_DIALOGUE_TRIGGER_CS, FIRST_OPEN_CS, SAMPLE_EXITS_CS, SAMPLE_INVENTORY_CS, SAMPLE_LISTENER_CS, SAMPLE_TRIGGER_CS, SETUP_CS, STORY_POINT_DRAWERS_CS };

// The Unity export is a UPM package (Unity Package Manager) that drops into an existing game:
// its own assemblies and namespace (one per story, so several stories can live in one game),
// .meta files with stable GUIDs (needed when the package is installed read-only from a tarball,
// and they keep a scene's references to the scripts when the package is updated), and an editor
// helper that installs Ink Unity Integration when the game doesn't have it yet.

export interface UnityPackageId {
  /** UPM name, e.g. com.narrativebridge.locked-archive */
  name: string;
  /** Lower-case, hyphenated story name: the package's Resources folder and save key. */
  slug: string;
  /** C# namespace and assembly name, e.g. NarrativeBridge.LockedArchive */
  namespace: string;
  /** The story's name as it appears in Unity's menus. */
  menuTitle: string;
}

/** Names Narrative Bridge's C# uses unqualified; a namespace part with one of these names would hide it. */
const RESERVED = new Set(['Ink', 'UnityEngine', 'UnityEditor', 'System', 'Object', 'String', 'Editor', 'EditorTools', 'Setup', 'StoryInfo', 'NarrativeController', 'NarrativeView', 'NarrativeTheme', 'IInventoryAuthority', 'NarrativeLocalization', 'GatedChoice', 'NarrativeSettings', 'NarrativeCuePlayer', 'ISaveStorage', 'FileSaveStorage', 'Story', 'Debug', 'Resources', 'Application', 'Color', 'Font', 'Line', 'Choice', 'Mathf', 'Path', 'File', 'Directory', 'Samples']);

export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function packageSlug(name: string): string {
  const s = foldAccents(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  if (!s && /[\p{L}\p{N}]/u.test(name)) return `story-${nameCode(name)}`;
  return /^[a-z]/.test(s) ? s : `story-${s || 'untitled'}`.replace(/-+$/, '');
}

export function unityPackageId(projectName: string, title: string): UnityPackageId {
  const slug = packageSlug(projectName || title);
  let part = pascalCase(projectName || title);
  if (RESERVED.has(part)) part = `${part}Story`;
  const menuTitle = (title || projectName).replace(/[^\p{L}\p{N} '-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || part;
  return { name: `com.narrativebridge.${slug}`, slug, namespace: `NarrativeBridge.${part}`, menuTitle };
}

/** Fills the __TOKENS__ in a C# template. */
export function fillTemplate(template: string, id: UnityPackageId, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    __NAMESPACE__: id.namespace,
    __MENU_TITLE__: id.menuTitle,
    __PACKAGE__: id.name,
    __SLUG__: id.slug,
    ...extra,
  };
  return template.replace(/__[A-Z_]+__/g, (t) => values[t] ?? t);
}

// ---- .meta files -------------------------------------------------------------------------

const IMPORTER_TAIL = '  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n';

export function metaFor(path: string, guid: string, folder = false): string {
  const head = `fileFormatVersion: 2\nguid: ${guid}\n`;
  if (folder) return `${head}folderAsset: yes\nDefaultImporter:\n${IMPORTER_TAIL}`;
  if (path.endsWith('.cs')) return `${head}MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
  if (path.endsWith('.asmdef')) return `${head}AssemblyDefinitionImporter:\n${IMPORTER_TAIL}`;
  if (/(^|\/)package\.json$/.test(path)) return `${head}PackageManifestImporter:\n${IMPORTER_TAIL}`;
  if (/\.(json|md|txt|bytes)$/.test(path)) return `${head}TextScriptImporter:\n${IMPORTER_TAIL}`;
  // Pictures, voice clips and anything else: Unity's default import settings.
  return head;
}

/** A stable GUID for a package path: the same story re-exported keeps the same GUIDs. */
export async function packageGuid(packageName: string, relPath: string): Promise<string> {
  return (await sha256Hex(`narrative-bridge:${packageName}:${relPath}`)).slice(0, 32);
}

/** Whether Unity imports this package path (folders ending in ~ are left alone, and so need no .meta). */
export function isImported(relPath: string): boolean {
  return !relPath.split('/').some((part) => part.endsWith('~') || part.startsWith('.'));
}

/** The package's files plus a .meta for every file and folder Unity imports. `root` ends with "/". */
export async function withMetas(files: ExportFile[], root: string, packageName: string): Promise<ExportFile[]> {
  const folders = new Set<string>();
  const metas: ExportFile[] = [];
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    if (!isImported(rel) || rel.endsWith('.meta')) continue;
    metas.push({ path: `${f.path}.meta`, content: metaFor(rel, await packageGuid(packageName, rel)) });
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  for (const dir of [...folders].sort()) metas.push({ path: `${root}${dir}.meta`, content: metaFor(dir, await packageGuid(packageName, `${dir}/`), true) });
  return [...files, ...metas];
}

// ---- package.json and assembly definitions --------------------------------------------------

export const INK_PACKAGE = 'com.inkle.ink-unity-integration';

export function packageJson(id: UnityPackageId, o: { version: string; title: string; description: string; unity: string }) {
  return {
    name: id.name,
    version: o.version,
    displayName: `${o.title} (Narrative Bridge)`.slice(0, 80),
    description: o.description,
    unity: o.unity,
    keywords: ['narrative', 'story', 'dialogue', 'ink', 'interactive fiction', 'narrative-bridge'],
    author: { name: 'Narrative Bridge', url: 'https://flamingairplane.github.io/Script-to-Game-Converter/' },
    // Ink Unity Integration isn't on Unity's registry, so it can't be listed here; the package's
    // editor helper installs it from GitHub when the game doesn't have it (see SETUP_CS).
    dependencies: {
      'com.unity.ugui': '1.0.0',
      'com.unity.modules.audio': '1.0.0',
      // Scene pictures and portraits are decoded with Texture2D.LoadImage.
      'com.unity.modules.imageconversion': '1.0.0',
      'com.unity.modules.imgui': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0',
    },
    samples: [{ displayName: 'Hooking into your game', description: 'Examples: start the story from a trigger, connect your inventory, react to story tags and variables.', path: 'Samples~/Hooking into your game' }],
  };
}

const INK_DEFINES = [
  // The package compiles only once Ink is in the project (so a game never sees errors before it's installed).
  { name: INK_PACKAGE, expression: '1.0.0', define: 'NARRATIVE_BRIDGE_INK' },
  // Ink 2 makes InkFile a runtime asset, so the controller can also run an InkFile imported in your project.
  { name: INK_PACKAGE, expression: '2.0.0', define: 'NARRATIVE_BRIDGE_INK_FILE' },
  // Keyboard shortcuts and the EventSystem's input module also work in games that use only the Input System.
  { name: 'com.unity.inputsystem', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_INPUT_SYSTEM' },
  // TextMeshPro, Unity's current text: built into uGUI 2.0 (Unity 6), or the TextMeshPro package (2022.3).
  { name: 'com.unity.ugui', expression: '2.0.0', define: 'NARRATIVE_BRIDGE_TMP' },
  { name: 'com.unity.textmeshpro', expression: '3.0.0', define: 'NARRATIVE_BRIDGE_TMP' },
  // Voice clips and pictures loaded on demand, when the story was exported that way.
  { name: 'com.unity.addressables', expression: '1.19.0', define: 'NARRATIVE_BRIDGE_ADDRESSABLES' },
  // Translations from Unity's Localization package's string tables.
  { name: 'com.unity.localization', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_LOCALIZATION' },
  // The Enter Dialogue Trigger's trigger colliders, when the game has 3D or 2D physics.
  { name: 'com.unity.modules.physics', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_PHYSICS' },
  { name: 'com.unity.modules.physics2d', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_PHYSICS_2D' },
];

export function runtimeAsmdef(id: UnityPackageId) {
  return {
    name: id.namespace,
    rootNamespace: id.namespace,
    // Optional references (like Unity.InputSystem) are skipped when the game doesn't have them.
    references: ['Ink-Libraries', 'Ink', 'UnityEngine.UI', 'Unity.InputSystem', 'Unity.TextMeshPro', 'Unity.Addressables', 'Unity.ResourceManager', 'Unity.Localization'],
    includePlatforms: [],
    excludePlatforms: [],
    allowUnsafeCode: false,
    overrideReferences: false,
    precompiledReferences: [],
    autoReferenced: true,
    defineConstraints: ['NARRATIVE_BRIDGE_INK'],
    versionDefines: INK_DEFINES,
    noEngineReferences: false,
  };
}

export function editorAsmdef(id: UnityPackageId) {
  return { ...runtimeAsmdef(id), name: `${id.namespace}.Editor`, rootNamespace: `${id.namespace}.EditorTools`, references: [id.namespace, 'Ink-Libraries', 'Ink', 'UnityEngine.UI', 'Unity.InputSystem', 'Unity.TextMeshPro', 'Unity.Addressables', 'Unity.ResourceManager', 'Unity.Addressables.Editor', 'Unity.Localization', 'Unity.Localization.Editor'], includePlatforms: ['Editor'] };
}

/** The samples' assembly, once imported into a game's Assets from Package Manager. */
export function samplesAsmdef(id: UnityPackageId) {
  return {
    ...runtimeAsmdef(id),
    name: `${id.namespace}.Samples`,
    rootNamespace: '',
    references: [id.namespace],
    versionDefines: [
      INK_DEFINES[0],
      { name: 'com.unity.modules.physics', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_PHYSICS' },
      { name: 'com.unity.modules.physics2d', expression: '1.0.0', define: 'NARRATIVE_BRIDGE_PHYSICS_2D' },
    ],
  };
}

/** The package's tests (the story's playthrough routes), for the Test Runner. */
export function testsAsmdef(id: UnityPackageId) {
  return {
    ...runtimeAsmdef(id),
    name: `${id.namespace}.Tests`,
    rootNamespace: `${id.namespace}.Tests`,
    references: [id.namespace, `${id.namespace}.Editor`, 'UnityEngine.TestRunner', 'UnityEditor.TestRunner'],
    includePlatforms: ['Editor'],
    overrideReferences: true,
    precompiledReferences: ['nunit.framework.dll'],
    autoReferenced: false,
    defineConstraints: ['UNITY_INCLUDE_TESTS', 'NARRATIVE_BRIDGE_INK'],
    versionDefines: [INK_DEFINES[0]],
  };
}

/** The package's Play Mode tests: the story running in the game (the panel, autosave, settings, cue music, language). */
export function playTestsAsmdef(id: UnityPackageId) {
  return {
    ...runtimeAsmdef(id),
    name: `${id.namespace}.PlayTests`,
    rootNamespace: `${id.namespace}.PlayTests`,
    references: [id.namespace, 'Ink-Libraries', 'UnityEngine.TestRunner', 'UnityEngine.UI'],
    includePlatforms: [],
    overrideReferences: true,
    precompiledReferences: ['nunit.framework.dll'],
    autoReferenced: false,
    defineConstraints: ['UNITY_INCLUDE_TESTS', 'NARRATIVE_BRIDGE_INK'],
    versionDefines: [INK_DEFINES[0]],
  };
}

/** The setup assembly has no Ink references or constraints, so it can offer to install Ink. */
export function setupAsmdef(id: UnityPackageId) {
  return { ...runtimeAsmdef(id), name: `${id.namespace}.Setup`, rootNamespace: `${id.namespace}.Setup`, references: [], includePlatforms: ['Editor'], defineConstraints: [], versionDefines: [INK_DEFINES[0], INK_DEFINES.find((d) => d.define === 'NARRATIVE_BRIDGE_ADDRESSABLES')!] };
}

// ---- C#: Ink setup, samples, project first-open hook -------------------------------------
// Template literals of C#: no backslashes and no "${" inside them; __TOKENS__ are filled by fillTemplate.

/** In a complete project only: creates the demo scene on first open (by reflection, so it always compiles). */

