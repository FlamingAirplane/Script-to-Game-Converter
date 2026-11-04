import { log } from '../log';
import type { ProcessedStory } from '../pipeline';
import { assertExportable, audioFiles, buildManifest, commonFiles, itemVarNames, json, sourceFiles, storyVersion, verifyExport } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { normaliseUnityTheme, unityThemeJson } from './unityTheme';
import { THEME_CS, VIEW_CS } from './unityUi';

// Unity adapter. Uses inkle's Ink Unity Integration (com.inkle.ink-unity-integration) as a
// versioned UPM git dependency rather than copying its source. The canonical .ink is delivered
// for the integration to import; a precompiled JSON (from the pinned preflight compiler) is
// shipped under Resources/ so the demo runs on first open without manual steps.

const NB = 'Assets/NarrativeBridge';

export const unityAdapter: EngineAdapter = {
  id: 'unity',
  label: 'Unity',
  defaultEngineVersion: '2022.3.62f1',
  integration: {
    name: 'Ink Unity Integration',
    repository: 'https://github.com/inkle/ink-unity-integration.git',
    defaultRef: '2.0.0',
  },
  requirements: (o) => [
    { id: 'unity', label: `Unity ${o.engineVersion} (2022.3 LTS or later)`, detail: 'Install through Unity Hub.', probe: { paths: ['/Applications/Unity/Hub/Editor', 'C:\\Program Files\\Unity\\Hub\\Editor', '~/Unity/Hub/Editor'] } },
    { id: 'git', label: 'Git on PATH', detail: 'Unity Package Manager needs git to fetch the Ink integration from GitHub.', probe: { command: 'git --version' } },
  ],
  async export(story, options) {
    assertExportable(story);
    const root = `${options.projectName}/`;
    const manifest = await buildManifest(story, options, this);
    const voice = audioFiles(story, options.audio, `${root}${NB}/Resources/NarrativeBridgeAudio/`);
    const files: ExportFile[] = [
      { path: `${root}${NB}/Ink/MainStory.ink`, content: story.generated.ink },
      { path: `${root}${NB}/Resources/MainStory.compiled.json`, content: story.compile.json! },
      ...voice.files,
      { path: `${root}${NB}/Scripts/StoryInfo.cs`, content: storyInfoCs(story) },
      { path: `${root}${NB}/Scripts/IInventoryAuthority.cs`, content: INVENTORY_CS },
      { path: `${root}${NB}/Scripts/NarrativeController.cs`, content: CONTROLLER_CS },
      { path: `${root}${NB}/Scripts/NarrativeTheme.cs`, content: THEME_CS },
      { path: `${root}${NB}/Scripts/NarrativeView.cs`, content: VIEW_CS },
      // The look chosen on the Export page; NarrativeTheme reads it (see unityTheme.ts).
      { path: `${root}${NB}/Resources/NarrativeBridgeTheme.json`, content: json(unityThemeJson(normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity))) },
      ...(options.includeDemo ? [{ path: `${root}${NB}/Editor/NarrativeBridgeEditor.cs`, content: EDITOR_CS }] : []),
      { path: `${root}Packages/manifest.json`, content: json(packageManifest(options)) },
      { path: `${root}ProjectSettings/ProjectVersion.txt`, content: `m_EditorVersion: ${options.engineVersion}\n` },
      { path: `${root}README.md`, content: readme(story, options) },
      ...commonFiles(story, manifest, `${root}NarrativeBridge/`),
      ...sourceFiles(story, `${root}NarrativeBridge/`),
    ];
    const result: ExportResult = {
      engine: 'unity',
      rootName: options.projectName,
      files,
      manifest,
      report: {
        exportPath: root,
        engine: 'Unity',
        engineVersion: options.engineVersion,
        integration: `${this.integration.name} @ ${options.integrationRef}`,
        filesCreated: files.map((f) => f.path),
        warnings: [],
        errors: [],
        setupInstructions: setupSteps(options),
        diagnostics: [],
      },
    };
    for (const name of voice.missing) result.report.warnings.push(`Voice clip "${name}" is missing from this browser, so it was left out of the package.`);
    finalize(result, story, [`${root}${NB}/Ink/MainStory.ink`, `${root}${NB}/Resources/MainStory.compiled.json`, `${root}Packages/manifest.json`]);
    return result;
  },
};

export function finalize(result: ExportResult, story: ProcessedStory, required: string[]) {
  const ds = verifyExport(result, story, required);
  result.report.diagnostics = ds;
  result.report.errors = ds.filter((d) => d.severity === 'error').map((d) => d.message);
  result.report.warnings = [
    ...result.report.warnings,
    ...ds.filter((d) => d.severity === 'warning').map((d) => d.message),
    ...story.diagnostics.filter((d) => d.severity === 'warning' || d.severity === 'review').map((d) => d.message),
  ];
  result.manifest.validation.exportVerification = result.report.errors.length ? 'failed' : 'passed';
  const manifestPath = result.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'));
  if (manifestPath) manifestPath.content = json(result.manifest);
  result.files.push({ path: `${result.rootName}/NarrativeBridge/export-report.json`, content: json(result.report) });
  log('export').info(`Built ${result.report.engine} package`, {
    files: result.files.length,
    bytes: result.files.reduce((n, f) => n + (typeof f.content === 'string' ? f.content.length : f.content.byteLength), 0),
    voiceClips: result.files.filter((f) => /\.(wav|mp3|ogg)$/.test(f.path)).length,
    warnings: result.report.warnings.length,
    errors: result.report.errors.length,
    integration: result.report.integration,
  });
}

/** UPM git URL. Releases 2.x keep the package in a subfolder; the legacy "upm" branches have it at the root. */
export function unityPackageUrl(ref: string): string {
  const path = ref.startsWith('upm') ? '' : '?path=/Packages/com.inkle.ink-unity-integration';
  return `${unityAdapter.integration.repository}${path}#${ref}`;
}

function packageManifest(o: ExportOptions) {
  return {
    dependencies: {
      'com.inkle.ink-unity-integration': unityPackageUrl(o.integrationRef),
      'com.unity.modules.audio': '1.0.0',
      'com.unity.modules.imgui': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0',
      // uGUI for the story panel (NarrativeView). 2022.3 ships 1.0.0; Unity 6 raises it to its own 2.0.0.
      'com.unity.ugui': '1.0.0',
    },
  };
}

function setupSteps(o: ExportOptions): string[] {
  return [
    `Open Unity Hub → Add → select the "${o.projectName}" folder. Open it with Unity ${o.engineVersion} or any later 2022.3+/6000.x editor.`,
    'Unity Package Manager fetches Ink Unity Integration from GitHub on first open (git must be installed).',
    o.includeDemo
      ? 'The "NarrativeDemo" scene is created automatically on first open. Press Play to run the story. Change its look in Assets/NarrativeBridge/Settings/NarrativeTheme.asset (even while playing).'
      : 'Add a NarrativeController component to any GameObject and press Play.',
    'Optional: run the automated check from Narrative Bridge → Run Story Smoke Test, or headless: Unity -batchmode -projectPath <path> -executeMethod NarrativeBridge.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch',
  ];
}

function csString(s: string): string {
  return JSON.stringify(s);
}

function storyInfoCs(story: ProcessedStory): string {
  const items = itemVarNames(story);
  const vars = story.project.variables.map((v) => v.id);
  return `// <auto-generated> by Narrative Bridge. Regenerated on every export. </auto-generated>
namespace NarrativeBridge
{
    public static class StoryInfo
    {
        public const string Title = ${csString(story.project.project.title)};
        public const string ProjectId = ${csString(story.project.project.id)};
        /// <summary>Changes whenever the generated Ink changes. Save data from another version is rejected.</summary>
        public const string StoryVersion = ${csString(storyVersion(story))};
        public const string CompiledResource = "MainStory.compiled";
        /// <summary>Ink variables that mirror inventory items (has_&lt;item&gt;).</summary>
        public static readonly string[] ItemVariables = { ${items.map(csString).join(', ')} };
        /// <summary>Story variables the game is allowed to read and write.</summary>
        public static readonly string[] Variables = { ${vars.map(csString).join(', ')} };
    }
}
`;
}

function readme(story: ProcessedStory, o: ExportOptions): string {
  return `# ${story.project.project.title} — Unity export

Generated by Narrative Bridge. Story version \`${storyVersion(story)}\`.

## Run it
${setupSteps(o).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Layout
- \`Assets/NarrativeBridge/Ink/MainStory.ink\` — canonical, validated Ink source (imported by Ink Unity Integration).
- \`Assets/NarrativeBridge/Resources/MainStory.compiled.json\` — preflight-compiled story used by the demo.
- \`Assets/NarrativeBridge/Scripts/NarrativeController.cs\` — continue/choose/variables/inventory/save-load, and the events a UI listens to.
- \`Assets/NarrativeBridge/Scripts/NarrativeView.cs\` — the story panel (uGUI), built at runtime from a \`NarrativeTheme\`.
- \`Assets/NarrativeBridge/Scripts/NarrativeTheme.cs\` and \`Settings/NarrativeTheme.asset\` — the look: colours, font and size, panel
  position, typewriter speed, what to show, button words. \`Resources/NarrativeBridgeTheme.json\` is the look chosen in Narrative Bridge.
- \`NarrativeBridge/\` — manifest, validation report, ISR, source map and original source documents.

## Integration notes
- Ink Unity Integration is referenced as \`${unityPackageUrl(o.integrationRef)}\` in \`Packages/manifest.json\`.
  ${/^[0-9a-f]{7,40}$/i.test(o.integrationRef) || /^v?\d/.test(o.integrationRef) ? 'This ref is pinned.' : '**This ref is a branch.** Replace it with a tested release tag or commit for reproducible builds.'}
- The demo scene's controller references the \`InkFile\` that Ink Unity Integration imports from \`MainStory.ink\`, so the integration owns
  final compilation. If that asset is missing or failed to compile, the controller falls back to \`Resources/MainStory.compiled\`.

## Story UI
The demo scene's \`NarrativeView\` draws the story as a themed uGUI panel: story text (with an optional typewriter), choices, the
Continue button for Continue breaks, the ending, and optional Restart / Save / Load. Keys: 1–9 choose, Space or Return continues.
- **Change the look:** select \`Assets/NarrativeBridge/Settings/NarrativeTheme.asset\` and edit it in the Inspector, even while
  playing; right-click its header → *Layout* for panel positions. *Narrative Bridge → Reset Theme to Exported Defaults* brings back
  the look chosen in Narrative Bridge. Exporting again updates \`NarrativeBridgeTheme.json\` but never your edited asset.
- **Your own UI:** remove \`NarrativeView\` and listen to \`NarrativeController\`: \`LineShown\` (with \`Speaker\`, \`Paren\`, \`Scene\`),
  \`ChoicesShown\` → \`Choose(i)\`, \`ContinueShown\` → \`Continue()\`, \`StoryEnded\`, \`Restarted\`, \`StatusChanged\`.
- Buttons need an EventSystem; one is added when missing. With only the new Input System enabled, give it an
  *Input System UI Input Module*.

## Inventory
Items are Ink Booleans named \`has_<item>\`. Assign a component implementing \`IInventoryAuthority\` to make your game's
inventory the single source of truth: the controller copies possession into Ink before every step, and forwards
story-driven gains/losses to the authority instead of letting both sides edit independently.

## Saves
\`SaveState()\` records \`StoryInfo.StoryVersion\` and the text of every choice made. \`TryLoadState()\` loads a save
from the same version exactly. A save from a different version (after you revise the story) is carried over: the new
version is played from the start, making the same choices, so its text and variables apply; if a choice no longer exists,
the player resumes just before it. \`LoadNote\` then describes what happened. Saves without a choice record are refused
with a clear message; call \`StartStory()\` to restart the narrative.
`;
}

const INVENTORY_CS = `namespace NarrativeBridge
{
    /// <summary>
    /// Implement on a MonoBehaviour to make the host game the authority for item possession.
    /// The story only requests changes; the game decides and the controller mirrors the result into Ink.
    /// </summary>
    public interface IInventoryAuthority
    {
        bool HasItem(string itemId);
        void GiveItem(string itemId);
        void TakeItem(string itemId);
    }
}
`;

const CONTROLLER_CS = `using System;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;

namespace NarrativeBridge
{
    /// <summary>
    /// Runs a Narrative Bridge story with the Ink runtime from Ink Unity Integration:
    /// advances text, presents choices and Continue breaks, exposes approved variables,
    /// synchronises inventory and saves/restores state with story-version checks.
    /// NarrativeView draws it as a themed uGUI story panel; any other UI can use the events below.
    /// Includes an optional bare-bones IMGUI demo (drawDemoUI).
    /// </summary>
    public class NarrativeController : MonoBehaviour
    {
        [Tooltip("The InkFile asset Ink Unity Integration imports from MainStory.ink (preferred).")]
        public Ink.UnityIntegration.InkFile inkFile;

        [Tooltip("Fallback compiled ink JSON. Leave empty to use Resources/MainStory.compiled.")]
        public TextAsset storyJson;

        [Tooltip("Optional component implementing IInventoryAuthority. When set, the game owns item possession.")]
        public MonoBehaviour inventoryAuthority;

        public bool startOnAwake = true;

        [Tooltip("Draw the bare-bones IMGUI demo. Off when a NarrativeView draws the story.")]
        public bool drawDemoUI = true;

        [Tooltip("Play recorded dialogue clips (#audio tags) from Resources/NarrativeBridgeAudio.")]
        public bool playVoiceClips = true;

        public struct Line
        {
            public string Speaker;
            public string Text;
            public List<string> Tags;
            /// <summary>The scene heading this line opens (from #scene), or null.</summary>
            public string Scene;
            /// <summary>A stage direction for the speaker (from #paren), or null.</summary>
            public string Paren;
            /// <summary>A choice the player made (shown in the transcript), not story text.</summary>
            public bool IsChoice;
            public bool IsTransition;
        }

        /// <summary>The text of a Continue break's only choice (see the Ink conventions).</summary>
        public const string ContinueText = "Continue";

        public event Action<Line> LineShown;
        /// <summary>Real choices to make. A Continue break raises ContinueShown instead.</summary>
        public event Action<IReadOnlyList<Choice>> ChoicesShown;
        /// <summary>A Continue break: the reader continues (Continue()) to see what follows.</summary>
        public event Action ContinueShown;
        public event Action StoryEnded;
        public event Action<string> RuntimeError;
        /// <summary>The transcript was cleared (start, restart or load): redraw from scratch.</summary>
        public event Action Restarted;
        public event Action<string> StatusChanged;

        public Story Story { get; private set; }
        public bool HasEnded { get; private set; }
        public IReadOnlyList<Line> Transcript => transcript;
        public string Status => status;

        /// <summary>The story is at a Continue break: its only choice is Continue.</summary>
        public bool IsWaitingForContinue => Story != null && Story.currentChoices.Count == 1 && Story.currentChoices[0].text == ContinueText;

        const string SaveKey = "NarrativeBridge.Save." + StoryInfo.ProjectId;
        readonly List<Line> transcript = new List<Line>();
        IInventoryAuthority authority;
        AudioSource voice;
        readonly Queue<AudioClip> voiceQueue = new Queue<AudioClip>();
        bool syncing;
        string status = "";
        Vector2 scroll;

        // The text of every choice made since the start, so a save can carry over to a revised story.
        readonly List<string> choicePath = new List<string>();

        /// <summary>Set by TryLoadState when it carried a save over from another story version; null otherwise.</summary>
        public string LoadNote { get; private set; }

        [Serializable]
        class SaveData
        {
            public string storyVersion;
            public string inkState;
            public List<string> choicePath;
        }

        void Awake()
        {
            authority = inventoryAuthority as IInventoryAuthority;
            if (inventoryAuthority != null && authority == null)
                Debug.LogError("[NarrativeBridge] inventoryAuthority does not implement IInventoryAuthority.", this);
            voice = GetComponent<AudioSource>();
            if (voice == null) voice = gameObject.AddComponent<AudioSource>();
            voice.playOnAwake = false;
            if (startOnAwake) StartStory();
        }

        public void StartStory()
        {
            string json = null;
            if (inkFile != null && inkFile.isCompiled) json = inkFile.storyJson;
            else if (inkFile != null) Debug.LogWarning("[NarrativeBridge] " + inkFile.name + " has not compiled; using the preflight-compiled story.", this);
            if (json == null)
            {
                var asset = storyJson != null ? storyJson : Resources.Load<TextAsset>(StoryInfo.CompiledResource);
                if (asset != null) json = asset.text;
            }
            if (json == null)
            {
                ReportError("No compiled story found. Assign inkFile or keep Resources/" + StoryInfo.CompiledResource + ".json.");
                return;
            }
            Story = new Story(json);
            Story.onError += (message, type) =>
            {
                if (type == Ink.ErrorType.Error) ReportError(message);
                else Debug.LogWarning("[NarrativeBridge] " + message);
            };
            foreach (var v in StoryInfo.ItemVariables) Story.ObserveVariable(v, OnItemVariableChanged);
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            SetStatus("");
            StopVoice();
            Restarted?.Invoke();
            Advance();
        }

        /// <summary>Goes on past a Continue break.</summary>
        public void Continue()
        {
            if (IsWaitingForContinue) Choose(0);
        }

        public void Choose(int index)
        {
            if (Story == null || index < 0 || index >= Story.currentChoices.Count) return;
            // A Continue break leaves no trace in the transcript: the page simply goes on.
            if (!IsWaitingForContinue)
                transcript.Add(new Line { Speaker = null, Text = Story.currentChoices[index].text, Tags = new List<string> { "choice" }, IsChoice = true });
            choicePath.Add(Story.currentChoices[index].text);
            Story.ChooseChoiceIndex(index);
            StopVoice();
            Advance();
        }

        void Advance()
        {
            SyncFromAuthority();
            while (Story.canContinue)
            {
                var raw = Story.Continue().Trim();
                if (raw.Length == 0) continue;
                var line = ParseLine(raw, new List<string>(Story.currentTags));
                transcript.Add(line);
                QueueVoice(line);
                LineShown?.Invoke(line);
            }
            if (IsWaitingForContinue) ContinueShown?.Invoke();
            else if (Story.currentChoices.Count > 0) ChoicesShown?.Invoke(Story.currentChoices);
            else
            {
                HasEnded = true;
                StoryEnded?.Invoke();
            }
        }

        // ---- Voice clips: lines tagged #audio:<file> play in order --------------------------

        void QueueVoice(Line line)
        {
            if (!playVoiceClips || voice == null) return;
            foreach (var t in line.Tags)
            {
                if (!t.StartsWith("audio:")) continue;
                var file = t.Substring(6).Trim();
                var dot = file.LastIndexOf('.');
                var clip = Resources.Load<AudioClip>("NarrativeBridgeAudio/" + (dot > 0 ? file.Substring(0, dot) : file));
                if (clip != null) voiceQueue.Enqueue(clip);
                else Debug.LogWarning("[NarrativeBridge] Voice clip not found: " + file);
            }
        }

        void StopVoice()
        {
            voiceQueue.Clear();
            if (voice != null) voice.Stop();
        }

        void Update()
        {
            if (voice != null && !voice.isPlaying && voiceQueue.Count > 0)
            {
                voice.clip = voiceQueue.Dequeue();
                voice.Play();
            }
        }

        static Line ParseLine(string raw, List<string> tags)
        {
            string speaker = null, scene = null, paren = null;
            var transition = false;
            foreach (var t in tags)
            {
                if (t.StartsWith("speaker:")) speaker = t.Substring(8).Trim();
                else if (t.StartsWith("scene:")) scene = t.Substring(6).Trim();
                else if (t.StartsWith("paren:")) paren = t.Substring(6).Trim();
                else if (t == "transition") transition = true;
            }
            var text = raw;
            if (speaker != null)
            {
                var colon = raw.IndexOf(": ", StringComparison.Ordinal);
                if (colon > 0) { speaker = raw.Substring(0, colon); text = raw.Substring(colon + 2); }
            }
            return new Line { Speaker = speaker, Text = text, Tags = tags, Scene = scene, Paren = paren, IsTransition = transition };
        }

        // ---- Variables -------------------------------------------------------------------

        public object GetVariable(string name)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0 && Array.IndexOf(StoryInfo.ItemVariables, name) < 0)
                throw new ArgumentException("Not an approved story variable: " + name);
            return Story.variablesState[name];
        }

        public void SetVariable(string name, object value)
        {
            if (Array.IndexOf(StoryInfo.Variables, name) < 0)
                throw new ArgumentException("Not a writable story variable: " + name);
            Story.variablesState[name] = value;
        }

        // ---- Inventory synchronisation: the host game is the single source of truth -------

        void SyncFromAuthority()
        {
            if (authority == null || Story == null) return;
            syncing = true;
            foreach (var v in StoryInfo.ItemVariables)
                Story.variablesState[v] = authority.HasItem(v.Substring(4));
            syncing = false;
        }

        void OnItemVariableChanged(string variableName, object newValue)
        {
            if (syncing || authority == null) return;
            var itemId = variableName.Substring(4);
            if (newValue is bool has)
            {
                if (has) authority.GiveItem(itemId);
                else authority.TakeItem(itemId);
            }
        }

        // ---- Save / load with story-version checks ----------------------------------------

        /// <summary>Saves to PlayerPrefs (one slot per story), as the demo's Save button does.</summary>
        public void SaveToPrefs()
        {
            if (Story == null) return;
            PlayerPrefs.SetString(SaveKey, SaveState());
            SetStatus("Saved.");
        }

        /// <summary>Loads the PlayerPrefs slot, as the demo's Load button does. The outcome is in Status.</summary>
        public void LoadFromPrefs()
        {
            if (Story == null) return;
            SetStatus(TryLoadState(PlayerPrefs.GetString(SaveKey, ""), out var err) ? LoadNote ?? "Loaded." : err);
        }

        public string SaveState()
        {
            return JsonUtility.ToJson(new SaveData { storyVersion = StoryInfo.StoryVersion, inkState = Story.state.ToJson(), choicePath = new List<string>(choicePath) });
        }

        public bool TryLoadState(string saveJson, out string error)
        {
            error = null;
            LoadNote = null;
            SaveData data = null;
            try { data = JsonUtility.FromJson<SaveData>(saveJson); } catch (Exception e) { error = "Save data is corrupt: " + e.Message; return false; }
            if (data == null || string.IsNullOrEmpty(data.inkState)) { error = "Save data is empty."; return false; }
            if (data.storyVersion != StoryInfo.StoryVersion)
            {
                // Saves from before choices were recorded can't be carried over (JsonUtility turns a
                // missing list into an empty one, so look for the field itself).
                if (data.choicePath == null || saveJson.IndexOf("\\"choicePath\\"", StringComparison.Ordinal) < 0)
                {
                    error = "This save was made with story version " + data.storyVersion + " but the game now has " + StoryInfo.StoryVersion + ". Restart the narrative.";
                    return false;
                }
                ReplayChoices(data.choicePath, data.storyVersion);
                return true;
            }
            Story.state.LoadJson(data.inkState);
            choicePath.Clear();
            if (data.choicePath != null) choicePath.AddRange(data.choicePath);
            transcript.Clear();
            HasEnded = false;
            Restarted?.Invoke();
            if (Story.canContinue) Advance();
            else if (IsWaitingForContinue) ContinueShown?.Invoke();
            else if (Story.currentChoices.Count > 0) ChoicesShown?.Invoke(Story.currentChoices);
            return true;
        }

        // A save from another version of the story: play the new version from the start, silently,
        // making the same choices (matched by their text), so its text and variables apply. Stops at
        // the first choice the new version no longer offers.
        void ReplayChoices(List<string> path, string savedVersion)
        {
            Story.ResetState();
            choicePath.Clear();
            transcript.Clear();
            HasEnded = false;
            StopVoice();
            var followed = 0;
            syncing = true; // the host's inventory is already where the save left it
            try
            {
                // Continue breaks added or removed since the save don't stop it: take or skip them.
                for (int i = 0, steps = 0; i < path.Count && steps < 10000; steps++)
                {
                    var before = Story.state.ToJson();
                    while (Story.canContinue) Story.Continue();
                    var match = Story.currentChoices.Find(c => c.text == path[i]);
                    if (match != null)
                    {
                        Story.ChooseChoiceIndex(match.index);
                        choicePath.Add(path[i]);
                        followed++;
                        i++;
                    }
                    else if (IsWaitingForContinue)
                    {
                        Story.ChooseChoiceIndex(0);
                        choicePath.Add(ContinueText);
                    }
                    else if (path[i] == ContinueText)
                    {
                        followed++;
                        i++;
                    }
                    else { Story.state.LoadJson(before); break; }
                }
            }
            finally { syncing = false; }
            Restarted?.Invoke();
            LoadNote = followed == path.Count
                ? "Carried this save over from story version " + savedVersion + ": all " + path.Count + " choices replayed."
                : "Carried this save over from story version " + savedVersion + ": " + followed + " of " + path.Count + " choices still exist, so it resumes after the last one that does.";
            Advance();
        }

        void ReportError(string message)
        {
            Debug.LogError("[NarrativeBridge] " + message, this);
            SetStatus(message);
            RuntimeError?.Invoke(message);
        }

        void SetStatus(string message)
        {
            status = message ?? "";
            StatusChanged?.Invoke(status);
        }

        // ---- Demo UI ---------------------------------------------------------------------

        void OnGUI()
        {
            if (!drawDemoUI) return;
            var w = Mathf.Min(720, Screen.width - 40);
            GUILayout.BeginArea(new Rect((Screen.width - w) / 2, 20, w, Screen.height - 40));
            GUILayout.Label("<size=20><b>" + StoryInfo.Title + "</b></size>", new GUIStyle(GUI.skin.label) { richText = true });
            scroll = GUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            var style = new GUIStyle(GUI.skin.label) { richText = true, wordWrap = true, fontSize = 15 };
            foreach (var l in transcript)
            {
                if (l.IsChoice) GUILayout.Label("<i>> " + l.Text + "</i>", style);
                else if (l.Speaker != null) GUILayout.Label("<b>" + l.Speaker + "</b>  " + l.Text, style);
                else GUILayout.Label(l.Text, style);
            }
            GUILayout.EndScrollView();
            if (Story != null)
            {
                for (int i = 0; i < Story.currentChoices.Count; i++)
                    if (GUILayout.Button(Story.currentChoices[i].text, GUILayout.Height(32))) { Choose(i); scroll.y = float.MaxValue; }
                if (HasEnded) GUILayout.Label("<b>— The End —</b>", style);
            }
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Restart")) StartStory();
            if (Story != null && GUILayout.Button("Save")) SaveToPrefs();
            if (Story != null && GUILayout.Button("Load")) LoadFromPrefs();
            GUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(status)) GUILayout.Label(status);
            GUILayout.EndArea();
        }
    }
}
`;

const EDITOR_CS = `using System.Collections.Generic;
using System.IO;
using Ink.Runtime;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace NarrativeBridge.EditorTools
{
    [InitializeOnLoad]
    public static class NarrativeBridgeEditor
    {
        const string ScenePath = "Assets/NarrativeBridge/Scenes/NarrativeDemo.unity";
        const string InkPath = "Assets/NarrativeBridge/Ink/MainStory.ink";
        const string ThemePath = "Assets/NarrativeBridge/Settings/NarrativeTheme.asset";

        static NarrativeBridgeEditor()
        {
            // Create the demo scene once, on first open of the generated project.
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(ScenePath) && !EditorApplication.isPlayingOrWillChangePlaymode) CreateDemoScene();
            };
        }

        /// <summary>
        /// Returns the InkFile imported by Ink Unity Integration. The integration marks master files in a
        /// deferred pass after import; MainStory.ink includes nothing and is included by nothing, so if that
        /// pass has not run yet we mark it as a master and reimport so it is compiled now.
        /// </summary>
        static Ink.UnityIntegration.InkFile LoadCompiledInkFile()
        {
            var inkFile = AssetDatabase.LoadAssetAtPath<Ink.UnityIntegration.InkFile>(InkPath);
            if (inkFile != null && inkFile.isCompiled) return inkFile;
            var importer = AssetImporter.GetAtPath(InkPath);
            if (importer == null) return inkFile;
            var so = new SerializedObject(importer);
            var master = so.FindProperty("isMasterFile");
            if (master != null && !master.boolValue)
            {
                master.boolValue = true;
                so.ApplyModifiedPropertiesWithoutUndo();
                importer.SaveAndReimport();
                inkFile = AssetDatabase.LoadAssetAtPath<Ink.UnityIntegration.InkFile>(InkPath);
            }
            return inkFile;
        }

        [MenuItem("Narrative Bridge/Create Demo Scene")]
        public static void CreateDemoScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var controller = new GameObject("Narrative Controller").AddComponent<NarrativeController>();
            controller.inkFile = LoadCompiledInkFile();
            // The themed uGUI story panel replaces the bare-bones IMGUI demo.
            controller.drawDemoUI = false;
            var view = controller.gameObject.AddComponent<NarrativeView>();
            view.controller = controller;
            view.theme = LoadOrCreateTheme();
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Debug.Log("[NarrativeBridge] Demo scene created at " + ScenePath + ". Press Play to run the story.");
        }

        /// <summary>The project's theme asset, created from the exported look the first time.</summary>
        static NarrativeTheme LoadOrCreateTheme()
        {
            var theme = AssetDatabase.LoadAssetAtPath<NarrativeTheme>(ThemePath);
            if (theme != null) return theme;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(ThemePath));
            theme = NarrativeTheme.LoadExported();
            AssetDatabase.CreateAsset(theme, ThemePath);
            AssetDatabase.SaveAssets();
            return theme;
        }

        [MenuItem("Narrative Bridge/Reset Theme to Exported Defaults")]
        public static void ResetTheme()
        {
            var theme = LoadOrCreateTheme();
            var exported = Resources.Load<TextAsset>(NarrativeTheme.ExportedResource);
            if (exported == null) { Debug.LogWarning("[NarrativeBridge] Resources/" + NarrativeTheme.ExportedResource + ".json is missing."); return; }
            Undo.RecordObject(theme, "Reset Narrative Bridge theme");
            theme.ApplyExported(exported.text);
            EditorUtility.SetDirty(theme);
            AssetDatabase.SaveAssets();
            Selection.activeObject = theme;
            Debug.Log("[NarrativeBridge] Theme reset to the look exported from Narrative Bridge.");
        }

        [MenuItem("Narrative Bridge/Run Story Smoke Test")]
        public static void RunSmokeTestMenu()
        {
            var ok = SmokeTest(false, out var log);
            if (ok) Debug.Log(log); else Debug.LogError(log);
        }

        /// <summary>
        /// Headless engine check: Unity -batchmode -projectPath . -executeMethod NarrativeBridge.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch
        /// Requires the integration's own import to compile the story (no fallback), then plays it. Exit code 0 = pass.
        /// </summary>
        public static void RunSmokeTestBatch()
        {
            var ok = SmokeTest(true, out var log);
            Debug.Log(log);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        static bool SmokeTest(bool requireEngineImport, out string log)
        {
            // Prefer the integration's own import so this also verifies the engine-side compile.
            var inkFile = LoadCompiledInkFile();
            var imported = inkFile != null && inkFile.isCompiled;
            if (!imported && requireEngineImport)
            {
                var why = inkFile == null ? "MainStory.ink was not imported as an InkFile" : string.Join("; ", inkFile.errors.ConvertAll(e => e.content));
                log = "[NarrativeBridge] Smoke test failed: Ink Unity Integration did not compile the story (" + (why.Length > 0 ? why : "unknown reason") + ").";
                return false;
            }
            var fallback = Resources.Load<TextAsset>(StoryInfo.CompiledResource);
            string json = imported ? inkFile.storyJson : fallback != null ? fallback.text : null;
            var source = imported ? "Ink Unity Integration import" : "preflight JSON";
            if (json == null) { log = "[NarrativeBridge] Smoke test failed: compiled story not found."; return false; }
            var errors = new List<string>();
            var clipsHeard = new HashSet<string>();
            int completed = 0;
            var rng = new System.Random(1234);
            const int runs = 50;
            for (int r = 0; r < runs; r++)
            {
                var story = new Story(json);
                story.onError += (m, t) => { if (t == Ink.ErrorType.Error) errors.Add(m); };
                int steps = 0;
                while (steps++ < 400)
                {
                    while (story.canContinue)
                    {
                        story.Continue();
                        foreach (var t in story.currentTags)
                            if (t.StartsWith("audio:")) clipsHeard.Add(t.Substring(6).Trim());
                    }
                    if (story.currentChoices.Count == 0) { completed++; break; }
                    story.ChooseChoiceIndex(rng.Next(story.currentChoices.Count));
                }
            }
            // Every voice clip a line refers to must have imported as an AudioClip.
            foreach (var file in clipsHeard)
            {
                var dot = file.LastIndexOf('.');
                if (Resources.Load<AudioClip>("NarrativeBridgeAudio/" + (dot > 0 ? file.Substring(0, dot) : file)) == null)
                    errors.Add("Voice clip did not import: " + file);
            }
            var carry = SaveCarryOverCheck(errors);
            var ui = StoryViewCheck(errors);
            log = "[NarrativeBridge] Smoke test (" + source + "): " + clipsHeard.Count + " voice clip(s) checked, " + completed + "/" + runs + " playthroughs reached an ending, " + carry + ", " + ui + ", " + errors.Count + " runtime errors." +
                  (errors.Count > 0 ? "\\n" + string.Join("\\n", errors) : "");
            return errors.Count == 0 && completed > 0;
        }

        /// Saves part-way through, then loads that save as if it came from an earlier story version:
        /// the controller must replay the choices and land on the same choices as an exact load.
        static string SaveCarryOverCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge smoke test");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.StartStory();
                if (c.Story == null) { errors.Add("Save carry-over: the controller could not start the story."); return "save carry-over not run"; }
                for (int i = 0; i < 3 && c.Story.currentChoices.Count > 0; i++) c.Choose(0);
                var expected = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                var save = c.SaveState();
                var older = save.Replace("\\"storyVersion\\":\\"" + StoryInfo.StoryVersion + "\\"", "\\"storyVersion\\":\\"earlier\\"");
                c.StartStory();
                if (!c.TryLoadState(older, out var err)) { errors.Add("Save carry-over: " + err); return "save carry-over failed"; }
                var got = string.Join(" | ", c.Story.currentChoices.ConvertAll(x => x.text));
                if (got != expected || c.LoadNote == null) { errors.Add("Save carry-over: expected choices [" + expected + "] but got [" + got + "]"); return "save carry-over failed"; }
                return "save carry-over passed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        /// Builds the story panel from the exported theme and plays a few steps through its buttons:
        /// one button per choice (one for a Continue break), clicks advance the story, the ending shows.
        static string StoryViewCheck(List<string> errors)
        {
            var go = new GameObject("NarrativeBridge view check");
            try
            {
                var c = go.AddComponent<NarrativeController>();
                c.drawDemoUI = false;
                var view = go.AddComponent<NarrativeView>();
                view.controller = c;
                view.theme = NarrativeTheme.LoadExported();
                view.Build();
                c.StartStory();
                if (c.Story == null || view.Canvas == null) { errors.Add("Story UI: the panel was not built."); return "story UI failed"; }
                var steps = 0;
                while (!c.HasEnded && steps++ < 200)
                {
                    var expected = c.IsWaitingForContinue ? 1 : c.Story.currentChoices.Count;
                    if (view.Buttons.Count != expected) { errors.Add("Story UI: expected " + expected + " button(s) but the panel shows " + view.Buttons.Count + "."); return "story UI failed"; }
                    var before = c.Transcript.Count + "/" + c.Story.state.currentTurnIndex;
                    view.Buttons[0].onClick.Invoke();
                    if (before == c.Transcript.Count + "/" + c.Story.state.currentTurnIndex) { errors.Add("Story UI: clicking a button did not advance the story."); return "story UI failed"; }
                }
                if (!c.HasEnded) return "story UI passed (" + steps + " steps, no ending within the check)";
                if (view.Buttons.Count != 0) { errors.Add("Story UI: buttons are still shown after the ending."); return "story UI failed"; }
                return "story UI passed";
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }
    }
}
`;
