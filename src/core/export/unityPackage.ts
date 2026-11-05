import { sha256Hex } from '../hash';
import { pascalCase } from './common';
import type { ExportFile } from './types';

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
const RESERVED = new Set(['Ink', 'UnityEngine', 'UnityEditor', 'System', 'Object', 'String', 'Editor', 'EditorTools', 'Setup', 'StoryInfo', 'NarrativeController', 'NarrativeView', 'NarrativeTheme', 'IInventoryAuthority', 'Story', 'Debug', 'Resources', 'Application', 'Color', 'Font', 'Line', 'Choice', 'Mathf', 'Path', 'File', 'Directory', 'Samples']);

export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function packageSlug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return /^[a-z]/.test(s) ? s : `story-${s || 'untitled'}`.replace(/-+$/, '');
}

export function unityPackageId(projectName: string, title: string): UnityPackageId {
  const slug = packageSlug(projectName || title);
  let part = pascalCase(projectName || title);
  if (RESERVED.has(part)) part = `${part}Story`;
  const menuTitle = (title || projectName).replace(/[^\p{L}\p{N} '\-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || part;
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
];

export function runtimeAsmdef(id: UnityPackageId) {
  return {
    name: id.namespace,
    rootNamespace: id.namespace,
    // Optional references (like Unity.InputSystem) are skipped when the game doesn't have them.
    references: ['Ink-Libraries', 'Ink', 'UnityEngine.UI', 'Unity.InputSystem'],
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
  return { ...runtimeAsmdef(id), name: `${id.namespace}.Editor`, rootNamespace: `${id.namespace}.EditorTools`, references: [id.namespace, 'Ink-Libraries', 'Ink', 'UnityEngine.UI', 'Unity.InputSystem'], includePlatforms: ['Editor'] };
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

/** The setup assembly has no Ink references or constraints, so it can offer to install Ink. */
export function setupAsmdef(id: UnityPackageId) {
  return { ...runtimeAsmdef(id), name: `${id.namespace}.Setup`, rootNamespace: `${id.namespace}.Setup`, references: [], includePlatforms: ['Editor'], defineConstraints: [], versionDefines: [INK_DEFINES[0]] };
}

// ---- C#: Ink setup, samples, project first-open hook -------------------------------------
// Template literals of C#: no backslashes and no "${" inside them; __TOKENS__ are filled by fillTemplate.

export const SETUP_CS = `using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace __NAMESPACE__.Setup
{
    /// <summary>
    /// "__MENU_TITLE__" runs on Ink Unity Integration (inkle's free ink runtime). Until a project has it, the
    /// package's scripts stay switched off (so the game never sees compile errors) and this offers, once per
    /// editor session, to install it from GitHub, or to use an ink runtime the project already has.
    /// </summary>
    [InitializeOnLoad]
    static class InkSetup
    {
        const string InkPackage = "__INK_URL__";
        const string Define = "NARRATIVE_BRIDGE_INK";
        const string Title = "__MENU_TITLE__ (Narrative Bridge)";

        static InkSetup()
        {
#if !NARRATIVE_BRIDGE_INK
            EditorApplication.delayCall += Check;
#endif
        }

        static bool InkRuntimeLoaded()
        {
            return AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetType("Ink.Runtime.Story", false) != null);
        }

        static void Check()
        {
            // One question per session, however many Narrative Bridge stories are installed.
            if (SessionState.GetBool("NarrativeBridge.InkChecked", false)) return;
            SessionState.SetBool("NarrativeBridge.InkChecked", true);
            if (Application.isBatchMode)
            {
                Debug.LogWarning("[NarrativeBridge] " + Title + " needs Ink Unity Integration: add " + InkPackage + " to Packages/manifest.json.");
                return;
            }
            if (InkRuntimeLoaded())
            {
                if (EditorUtility.DisplayDialog(Title, "This project has the ink runtime, but not as the Ink Unity Integration package (for example a copy in Assets). Switch on the story's scripts by adding the " + Define + " scripting define?", "Add the define", "Not now"))
                    UseExistingInk();
            }
            else if (EditorUtility.DisplayDialog(Title, "This story needs Ink Unity Integration, inkle's free ink runtime. Install it now from GitHub? (Git must be installed.)", "Install", "Not now"))
                InstallInk();
        }

#if !NARRATIVE_BRIDGE_INK
        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Install Ink Unity Integration")]
#endif
        static void InstallInk()
        {
            UnityEditor.PackageManager.Client.Add(InkPackage);
            Debug.Log("[NarrativeBridge] Installing Ink Unity Integration (" + InkPackage + "). The story's scripts switch on when it has installed.");
        }

#if !NARRATIVE_BRIDGE_INK
        [MenuItem("Tools/Narrative Bridge/__MENU_TITLE__/Use the Ink Already in This Project")]
#endif
        static void UseExistingInk()
        {
            var target = NamedBuildTarget.FromBuildTargetGroup(EditorUserBuildSettings.selectedBuildTargetGroup);
            var defines = PlayerSettings.GetScriptingDefineSymbols(target);
            if (defines.Split(';').Contains(Define)) return;
            PlayerSettings.SetScriptingDefineSymbols(target, string.IsNullOrEmpty(defines) ? Define : defines + ";" + Define);
            Debug.Log("[NarrativeBridge] Added the " + Define + " scripting define for " + target.TargetName + ".");
        }
    }
}
`;

/** In a complete project only: creates the demo scene on first open (by reflection, so it always compiles). */
export const FIRST_OPEN_CS = `using UnityEditor;

namespace NarrativeBridgeProject
{
    [InitializeOnLoad]
    static class OpenDemoOnFirstOpen
    {
        static OpenDemoOnFirstOpen()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                var editor = System.Type.GetType("__NAMESPACE__.EditorTools.NarrativeBridgeEditor, __NAMESPACE__.Editor");
                var create = editor != null ? editor.GetMethod("CreateDemoSceneIfMissing") : null;
                if (create != null) create.Invoke(null, null);
            };
        }
    }
}
`;

export const SAMPLE_TRIGGER_CS = `using UnityEngine;
using UnityEngine.Events;
using __NAMESPACE__;

/// <summary>
/// Starts the story at a passage when the player walks into this trigger (or when you call Begin()), and
/// tells your game when the story starts and ends, e.g. to pause player movement while it's on screen.
/// Put it on an object with a trigger collider, and point it at a NarrativeController with
/// "Start On Awake" turned off.
/// </summary>
public class StoryTrigger : MonoBehaviour
{
    public NarrativeController story;
    [Tooltip("Where to start, one of StoryInfo.Passages. Empty starts from the beginning.")]
    public string passage = "";
    [Tooltip("Only objects with this tag start the story.")]
    public string playerTag = "Player";
    public bool onlyOnce = true;

    public UnityEvent storyStarted = new UnityEvent();
    public UnityEvent storyFinished = new UnityEvent();

    bool used;

    void OnEnable() { if (story != null) story.StoryEnded += OnEnded; }
    void OnDisable() { if (story != null) story.StoryEnded -= OnEnded; }

    // Each needs its physics module; the sample's assembly switches them on when your game has it.
#if NARRATIVE_BRIDGE_PHYSICS
    void OnTriggerEnter(Collider other) { if (other.CompareTag(playerTag)) Begin(); }
#endif
#if NARRATIVE_BRIDGE_PHYSICS_2D
    void OnTriggerEnter2D(Collider2D other) { if (other.CompareTag(playerTag)) Begin(); }
#endif

    public void Begin()
    {
        if (story == null || (onlyOnce && used)) return;
        used = true;
        if (string.IsNullOrEmpty(passage)) story.StartStory(); else story.StartAt(passage);
        storyStarted.Invoke();
    }

    void OnEnded() => storyFinished.Invoke();
}
`;

export const SAMPLE_INVENTORY_CS = `using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using __NAMESPACE__;

/// <summary>
/// Makes your game's inventory the one source of truth for the story's items. Replace the HashSet with
/// calls into your own inventory system, then drag this component onto the NarrativeController's
/// "Inventory Authority" field. Item ids are listed in StoryInfo.ItemVariables (without "has_").
/// </summary>
public class StoryInventoryBridge : MonoBehaviour, IInventoryAuthority
{
    [System.Serializable] public class ItemEvent : UnityEvent<string> { }

    public List<string> startingItems = new List<string>();
    public ItemEvent itemGiven = new ItemEvent();
    public ItemEvent itemTaken = new ItemEvent();

    readonly HashSet<string> items = new HashSet<string>();

    void Awake() { foreach (var i in startingItems) items.Add(i); }

    public bool HasItem(string itemId) => items.Contains(itemId);

    public void GiveItem(string itemId)
    {
        if (items.Add(itemId)) itemGiven.Invoke(itemId);
    }

    public void TakeItem(string itemId)
    {
        if (items.Remove(itemId)) itemTaken.Invoke(itemId);
    }
}
`;

export const SAMPLE_LISTENER_CS = `using UnityEngine;
using __NAMESPACE__;

/// <summary>
/// Shows how a game system can follow the story from code: every line, custom tag (#shake, #music:calm)
/// and variable change. Put it next to a NarrativeController.
/// </summary>
public class StoryEventsListener : MonoBehaviour
{
    public NarrativeController story;

    void OnEnable()
    {
        if (story == null) story = GetComponent<NarrativeController>();
        if (story == null) return;
        story.LineShown += OnLine;
        story.TagFound += OnTag;
        story.VariableChanged += OnVariable;
        story.StoryEnded += OnEnded;
    }

    void OnDisable()
    {
        if (story == null) return;
        story.LineShown -= OnLine;
        story.TagFound -= OnTag;
        story.VariableChanged -= OnVariable;
        story.StoryEnded -= OnEnded;
    }

    void OnLine(NarrativeController.Line line) => Debug.Log((line.Speaker != null ? line.Speaker + ": " : "") + line.Text);
    void OnTag(string tag) => Debug.Log("Story tag: #" + tag);
    void OnVariable(string name, object value) => Debug.Log("Story variable " + name + " = " + value);
    void OnEnded() => Debug.Log("The story has ended.");
}
`;
