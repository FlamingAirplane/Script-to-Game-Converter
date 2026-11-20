import type { ProcessedStory } from '../pipeline';
import { GENERATOR_VERSION } from '../version';
import { storyRoutes } from './routes';
import { translationSheet } from './translations';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, isPinnedRef, json, pascalCase, sourceFiles, storyVersion } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { finalize } from './unity';
import { normaliseUnityTheme } from './unityTheme';
import { COMPONENT_CPP, COMPONENT_H } from './unrealComponent';
import { CUE_PLAYER_CPP, CUE_PLAYER_H, ENTER_DIALOGUE_TRIGGER_CPP, ENTER_DIALOGUE_TRIGGER_H, INVENTORY_COMPONENT_H, TRIGGER_CPP, TRIGGER_H } from './unrealCues';
import { EDITOR_INK_IMPORT_CPP, EDITOR_INK_IMPORT_H, EDITOR_MODULE_CPP, EDITOR_STORY_DATA_TESTS_CPP, EDITOR_TESTS_CPP, editorBuildCs, keySamples } from './unrealEditor';
import { CONDITION_H, fillUnreal, INK_COMPAT_CPP, INK_COMPAT_H, INK_CPP, INK_H, INK_OBSERVER_H, INVENTORY_H, LOCALIZATION_CPP, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_CPP, SETTINGS_H, STORY_DATA_CPP, STORY_DATA_H, TYPES_H } from './unrealRuntime';
import { conditionChecks, storyInfoData } from './unrealStoryData';
import { coreRedirectsIni } from './unrealPlugin';
import { DEMO_CPP, DEMO_H, PANEL_CPP, PANEL_H, THEME_CPP, themeH, unrealThemeJson, WIDGET_CPP, WIDGET_H } from './unrealUi';

// Unreal adapter. Uses The Chinese Room's Inkpot plugin, provisioned at a pinned ref by the included setup script (never
// vendored). The export is a Blueprint-only Unreal project (no Source/ of its own) with all the code in one plugin,
// Plugins/NarrativeBridge, which is the same for every story (so a prebuilt copy can replace it; see unrealPlugin.ts):
// - its runtime module, NarrativeBridge: the story component (a port of the Unity package's NarrativeController), the
//   story's data (UNarrativeStoryData, read from StorySource/StoryInfo.json; see unrealStoryData.ts), the Ink runtime
//   boundary (NarrativeBridgeInk*, the only files that call Inkpot; see unrealBoundary.ts), translations, the player's
//   reading settings, the cue player, a themed story panel (UMG, built in C++ from the same look as the Unity story
//   panel), and helpers for hooking the story into a game (see unrealRuntime.ts, unrealComponent.ts, unrealCues.ts,
//   unrealUi.ts);
// - its editor module, NarrativeBridgeEditor: it imports the story files the first time the project opens, adds
//   Tools → Narrative Bridge (including importing a story into an existing project), and holds the automation tests
//   (see unrealEditor.ts).
// The story itself is data: the canonical .ink, its compiled JSON and StoryInfo.json in StorySource/, imported into
// Content/NarrativeBridge/. `npm run test:unreal:build` builds the export with a real Unreal Engine and Inkpot;
// `npm run test:unreal` checks the condition evaluator and the Ink boundary against stand-in headers.

/** The runtime module's name: the same for every story. (The editor module is NarrativeBridgeEditor.) */
const MODULE = 'NarrativeBridge';

/** Where the story's runtime files (the look, the translation sheet, pictures) are, under Content/. Staged with the game. */
const DATA = 'NarrativeBridge/Data/';

export const unrealAdapter: EngineAdapter = {
  id: 'unreal',
  label: 'Unreal Engine',
  defaultEngineVersion: '5.7',
  integration: {
    name: 'Inkpot',
    repository: 'https://github.com/The-Chinese-Room/Inkpot.git',
    defaultRef: 'v1.42.21-release',
  },
  requirements: (o) => [
    { id: 'unreal', label: `Unreal Engine ${o.engineVersion}`, detail: 'Built and tested with Unreal Engine 5.7; Inkpot documents 5.7 and 5.8. Newer engines (5.9) may need a fix in Inkpot. Install via the Epic Games Launcher.', probe: { paths: ['/Users/Shared/Epic Games', 'C:\\Program Files\\Epic Games'] } },
    { id: 'toolchain', label: 'C++ toolchain', detail: 'Visual Studio 2022 with "Game development with C++" on Windows, or Xcode on macOS. It builds Inkpot, which comes as source code, and the Narrative Bridge plugin unless the export carries a prebuilt one (the CLI\'s --plugin).', probe: { command: 'xcodebuild -version' } },
    { id: 'dotnet', label: '.NET runtime (optional)', detail: 'Only for Inkpot importing .ink through Inklecate. Without it, the editor makes the story asset from MainStory.compiled.json instead, and the story plays the same.', probe: { command: 'dotnet --list-runtimes' }, optional: true },
    { id: 'git', label: 'Git on PATH', detail: 'The setup script clones Inkpot at the pinned ref.', probe: { command: 'git --version' } },
  ],
  async export(story, options) {
    assertExportable(story);
    const name = pascalCase(options.projectName);
    const root = `${name}/`;
    // The project is Blueprint-only (no Source/): all the code is in the NarrativeBridge plugin, with a runtime and an editor
    // module. The plugin is the same for every story (its code never depends on it), so a prebuilt copy can replace it:
    // the story itself is data (StorySource/StoryInfo.json) and content (Content/NarrativeBridge/).
    const plugin = `${root}Plugins/${MODULE}/`;
    const src = `${plugin}Source/${MODULE}/`;
    const ed = `${plugin}Source/${MODULE}Editor/`;
    const manifest = await buildManifest(story, options, this);
    const theme = normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity);
    // Voice clips and cue sounds are imported as Sound Waves by the editor module (into Content/NarrativeBridge/Audio).
    const voice = audioFiles(story, options.audio, `${root}StorySource/VoiceClips/`);
    // Pictures are decoded at run time from their PNG/JPEG bytes (as in the Unity package): no import settings needed.
    const pictures = imageFiles(story, options.images, `${root}Content/${DATA}Images/`);
    // Playthrough routes for the tests; not for Ink with randomness, which needn't replay the same way.
    const routes = /RANDOM\(|\{~/.test(story.generated.ink) ? [] : storyRoutes(story.compile.json!, story.project);
    const fill = (template: string) => fillUnreal(template, MODULE);
    const info = storyInfoData(story, name);
    const files: ExportFile[] = [
      { path: `${root}${name}.uproject`, content: json(uproject(options)) },
      { path: `${root}StorySource/MainStory.ink`, content: story.generated.ink },
      { path: `${root}StorySource/MainStory.compiled.json`, content: story.compile.json! },
      // The story's passages, lines, cues and the conditions of its locked choices, as data; the runtime reads it through a UNarrativeStoryData asset.
      { path: `${root}StorySource/StoryInfo.json`, content: json(info) },
      { path: `${root}StorySource/ConditionChecks.json`, content: json({ about: 'What each locked choice\'s conditions give for sample variable values, worked out by Narrative Bridge. The NarrativeBridge.StoryData automation test checks the C++ evaluator agrees.', checks: conditionChecks(info) }) },
      ...(routes.length ? [{ path: `${root}StorySource/PlaythroughRoutes.json`, content: json({ about: 'Choices (by their text) that play from the start to each ending. The NarrativeBridge.Playthrough automation tests replay them.', routes }) }] : []),
      ...voice.files,
      // The story panel's look and the translation sheet, read at run time (see NarrativeTheme and NarrativeLocalization).
      { path: `${root}Content/${DATA}Theme.json`, content: json(unrealThemeJson(theme)) },
      { path: `${root}Content/${DATA}Translations.csv`, content: translationSheet(story.project, theme, options.translationLanguages ?? []) },
      ...pictures.files,
      { path: `${root}Config/DefaultGame.ini`, content: defaultGameIni(story) },
      { path: `${root}Config/DefaultEngine.ini`, content: defaultEngineIni(name, theme, options.includeDemo) },
      { path: `${plugin}${MODULE}.uplugin`, content: json(uplugin()) },
      { path: `${src}${MODULE}.Build.cs`, content: buildCs(MODULE) },
      { path: `${src}${MODULE}.cpp`, content: `#include "Modules/ModuleManager.h"\n\nIMPLEMENT_MODULE(FDefaultGameModuleImpl, ${MODULE});\n` },
      { path: `${src}NarrativeBridgeCondition.h`, content: fill(CONDITION_H) },
      { path: `${src}NarrativeBridgeStoryData.h`, content: fill(STORY_DATA_H) },
      { path: `${src}NarrativeBridgeStoryData.cpp`, content: fill(STORY_DATA_CPP) },
      { path: `${src}NarrativeBridgeTypes.h`, content: fill(TYPES_H) },
      // The only files that call the Ink runtime (see NarrativeBridgeInk.h); scripts/unreal-check.ts enforces it.
      { path: `${src}NarrativeBridgeInk.h`, content: fill(INK_H) },
      { path: `${src}NarrativeBridgeInk.cpp`, content: fill(INK_CPP) },
      { path: `${src}NarrativeBridgeInkObserver.h`, content: fill(INK_OBSERVER_H) },
      { path: `${src}NarrativeBridgeInkCompat.h`, content: fill(INK_COMPAT_H) },
      { path: `${src}NarrativeBridgeInkCompat.cpp`, content: fill(INK_COMPAT_CPP) },
      { path: `${src}NarrativeInventoryAuthority.h`, content: fill(INVENTORY_H) },
      { path: `${src}NarrativeSaveStorage.h`, content: fill(SAVE_STORAGE_H) },
      { path: `${src}NarrativeLocalization.h`, content: fill(LOCALIZATION_H) },
      { path: `${src}NarrativeLocalization.cpp`, content: fill(LOCALIZATION_CPP) },
      { path: `${src}NarrativeSettings.h`, content: fill(SETTINGS_H) },
      { path: `${src}NarrativeSettings.cpp`, content: fill(SETTINGS_CPP) },
      { path: `${src}NarrativeBridgeComponent.h`, content: fill(COMPONENT_H) },
      { path: `${src}NarrativeBridgeComponent.cpp`, content: fill(COMPONENT_CPP) },
      { path: `${src}NarrativeCuePlayer.h`, content: fill(CUE_PLAYER_H) },
      { path: `${src}NarrativeCuePlayer.cpp`, content: fill(CUE_PLAYER_CPP) },
      { path: `${src}NarrativeStoryTrigger.h`, content: fill(TRIGGER_H) },
      { path: `${src}NarrativeStoryTrigger.cpp`, content: fill(TRIGGER_CPP) },
      { path: `${src}NarrativeEnterDialogueTrigger.h`, content: fill(ENTER_DIALOGUE_TRIGGER_H) },
      { path: `${src}NarrativeEnterDialogueTrigger.cpp`, content: fill(ENTER_DIALOGUE_TRIGGER_CPP) },
      { path: `${src}NarrativeSimpleInventory.h`, content: fill(INVENTORY_COMPONENT_H) },
      // The look comes only from Content/NarrativeBridge/Data/Theme.json; these defaults are the same for every story.
      { path: `${src}NarrativeTheme.h`, content: fill(themeH(normaliseUnityTheme(undefined))) },
      { path: `${src}NarrativeTheme.cpp`, content: fill(THEME_CPP) },
      { path: `${src}NarrativeStoryWidget.h`, content: fill(WIDGET_H) },
      { path: `${src}NarrativeStoryWidget.cpp`, content: fill(WIDGET_CPP) },
      { path: `${src}NarrativeStoryPanel.h`, content: fill(PANEL_H) },
      { path: `${src}NarrativeStoryPanel.cpp`, content: fill(PANEL_CPP) },
      // The demo game mode is always in the plugin, so the plugin never depends on the options; Config/DefaultEngine.ini turns it on.
      { path: `${src}NarrativeDemoGameMode.h`, content: fill(DEMO_H) },
      { path: `${src}NarrativeDemoGameMode.cpp`, content: fill(DEMO_CPP) },
      { path: `${ed}${MODULE}Editor.Build.cs`, content: editorBuildCs(MODULE) },
      { path: `${ed}${MODULE}Editor.cpp`, content: fill(EDITOR_MODULE_CPP) },
      { path: `${ed}NarrativeBridgeInkImport.h`, content: fill(EDITOR_INK_IMPORT_H) },
      { path: `${ed}NarrativeBridgeInkImport.cpp`, content: fill(EDITOR_INK_IMPORT_CPP) },
      { path: `${ed}NarrativeBridgeStoryDataTests.cpp`, content: fill(EDITOR_STORY_DATA_TESTS_CPP) },
      // The tests read StorySource/*.json, so they're the same for every story.
      { path: `${ed}NarrativeBridgeTests.cpp`, content: fill(EDITOR_TESTS_CPP) },
      { path: `${root}StorySource/TestData.json`, content: json({ about: 'Translation keys worked out by Narrative Bridge, which the NarrativeBridge.TranslationKeys automation test checks the C++ against.', translationKeys: keySamples(story.project.passages.flatMap((p) => p.choices.map((c) => c.text)).slice(0, 3)).map(([text, key]) => ({ text, key })) }) },
      { path: `${root}Plugins/README.md`, content: `Run ../Scripts/setup_inkpot.sh (macOS/Linux) or ..\\Scripts\\setup_inkpot.ps1 (Windows) to install Inkpot @ ${options.integrationRef} into Plugins/Inkpot/.\n` },
      { path: `${root}Scripts/setup_inkpot.sh`, content: setupSh(options) },
      { path: `${root}Scripts/setup_inkpot.ps1`, content: setupPs1(options) },
      { path: `${root}Content/NarrativeBridge/README.md`, content: 'The editor imports ../../StorySource/MainStory.ink here (as the Inkpot story asset MainStory) and the voice clips into Audio/ the first time the project opens; Tools → Narrative Bridge → Re-import Story Files does it again. Data/ holds the story panel\'s look, the translation sheet and the scene pictures, read while the game runs.\n' },
      { path: `${root}README.md`, content: readme(story, options, name) },
      ...commonFiles(story, manifest, `${root}NarrativeBridge/`),
      ...sourceFiles(story, `${root}NarrativeBridge/`, options.originals),
    ];
    const result: ExportResult = {
      engine: 'unreal',
      rootName: name,
      files,
      manifest,
      report: {
        exportPath: root,
        engine: 'Unreal Engine',
        engineVersion: options.engineVersion,
        integration: `Inkpot @ ${options.integrationRef}`,
        filesCreated: files.map((f) => f.path),
        warnings: [],
        errors: [],
        setupInstructions: setupSteps(options, name),
        diagnostics: [],
      },
    };
    for (const n of voice.missing) result.report.warnings.push(`Voice clip "${n}" is missing from this browser, so it was left out of the package.`);
    for (const n of pictures.missing) result.report.warnings.push(`Scene picture "${n}" is missing from this browser, so it was left out of the package.`);
    finalize(result, story, [`${root}${name}.uproject`, `${root}StorySource/MainStory.ink`, `${src}${MODULE}.Build.cs`]);
    return result;
  },
};

function uproject(o: ExportOptions) {
  return {
    FileVersion: 3,
    EngineAssociation: o.engineVersion,
    Category: '',
    Description: 'Generated by Narrative Bridge',
    Plugins: [
      { Name: MODULE, Enabled: true },
      { Name: 'Inkpot', Enabled: true },
    ],
  };
}

/** The plugin that holds all the export's code: the same for every story. */
function uplugin() {
  return {
    FileVersion: 3,
    Version: 1,
    VersionName: GENERATOR_VERSION,
    FriendlyName: 'Narrative Bridge',
    Description: 'Plays a story written in Narrative Bridge: a story component, a themed story panel, cues, translations and saves. The story itself is data in the project (StorySource/ and Content/NarrativeBridge/).',
    Category: 'Narrative',
    CreatedBy: 'Narrative Bridge',
    CanContainContent: false,
    Installed: false,
    Modules: [
      { Name: MODULE, Type: 'Runtime', LoadingPhase: 'Default' },
      { Name: `${MODULE}Editor`, Type: 'Editor', LoadingPhase: 'Default' },
    ],
    Plugins: [{ Name: 'Inkpot', Enabled: true }],
  };
}

/** The runtime module (the same for every story). */
function buildCs(name: string) {
  return `using UnrealBuildTool;

public class ${name} : ModuleRules
{
    public ${name}(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        // The editor module (and your own) include the story's headers.
        PublicIncludePaths.Add(ModuleDirectory);
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore", "UMG", "Json", "JsonUtilities", "Inkpot", "InkPlusPlus" });
    }
}
`;
}

function defaultGameIni(story: ProcessedStory): string {
  return `[/Script/EngineSettings.GeneralProjectSettings]
ProjectName=${story.project.project.title.replace(/\n/g, ' ')}

[/Script/UnrealEd.ProjectPackagingSettings]
; The story asset and its sounds are loaded by path, so cook them; the look, the translations and the pictures are read as files.
+DirectoriesToAlwaysCook=(Path="/Game/NarrativeBridge")
+DirectoriesToAlwaysStageAsUFS=(Path="${DATA.replace(/\/$/, '')}")
`;
}

function defaultEngineIni(name: string, theme: ReturnType<typeof normaliseUnityTheme>, demo: boolean): string {
  // Scale the UI with the screen as the theme was designed (its reference resolution, matched by width, height or both).
  const rule = theme.matchWidthOrHeight <= 0.25 ? 'Horizontal' : theme.matchWidthOrHeight >= 0.75 ? 'Vertical' : 'ShortestSide';
  const reference = rule === 'Horizontal' ? theme.referenceWidth : theme.referenceHeight;
  return `[/Script/Engine.UserInterfaceSettings]
UIScaleRule=${rule}
UIScaleCurve=(EditorCurveData=(Keys=((Time=0.000000,Value=0.000000),(Time=${(reference * 8).toFixed(6)},Value=8.000000))),ExternalCurve=None)
${demo ? `
[/Script/EngineSettings.GameMapsSettings]
; Press Play: the demo game mode puts the story on screen in any level.
GlobalDefaultGameMode=/Script/${MODULE}.NarrativeDemoGameMode
EditorStartupMap=/Engine/Maps/Entry
GameDefaultMap=/Engine/Maps/Entry
` : ''}
; Blueprints and assets saved by an earlier export of this project refer to its types as /Script/${name}.<Name>, which moved to the plugin.
${coreRedirectsIni(name)}`;
}

function setupSh(o: ExportOptions) {
  return `#!/usr/bin/env bash
# Installs Inkpot at the ref recorded in NarrativeBridge/narrative-bridge.manifest.json.
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${o.integrationRef}"
if [ -d Plugins/Inkpot/.git ]; then
  git -C Plugins/Inkpot fetch --tags origin
else
  git clone ${unrealAdapter.integration.repository} Plugins/Inkpot
fi
git -C Plugins/Inkpot checkout "$REF"
echo "Inkpot $(git -C Plugins/Inkpot rev-parse --short HEAD) installed. Record this SHA as the integration ref for reproducible builds."
`;
}

function setupPs1(o: ExportOptions) {
  return `# Installs Inkpot at the ref recorded in NarrativeBridge/narrative-bridge.manifest.json.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$Ref = "${o.integrationRef}"
if (Test-Path "Plugins/Inkpot/.git") { git -C Plugins/Inkpot fetch --tags origin }
else { git clone ${unrealAdapter.integration.repository} Plugins/Inkpot }
git -C Plugins/Inkpot checkout $Ref
Write-Host "Inkpot $(git -C Plugins/Inkpot rev-parse --short HEAD) installed."
`;
}

function setupSteps(o: ExportOptions, name: string): string[] {
  return [
    `Use Unreal Engine 5.7 or 5.8: the project is built and tested with 5.7, and Inkpot @ ${o.integrationRef} documents 5.7 and 5.8. On 5.9 that Inkpot release may not compile until one line is fixed (see the README's integration notes).`,
    `Run Scripts/setup_inkpot.sh (or .ps1 on Windows) to clone Inkpot @ ${o.integrationRef} into Plugins/Inkpot.`,
    `Open ${name}.uproject and accept the rebuild prompt: the project has no code of its own, only the Narrative Bridge plugin in Plugins/NarrativeBridge and Inkpot in Plugins/Inkpot. A C++ toolchain builds them once (the Narrative Bridge plugin needs none when the export carries a prebuilt one; Inkpot comes as source code, so it always does).`,
    'Open the project: the first time, the editor imports StorySource/MainStory.ink (as an Inkpot story asset) and the voice clips into Content/NarrativeBridge.',
    o.includeDemo
      ? 'Press Play: the story runs in its themed story panel. To put it in your own level, use Tools → Narrative Bridge → Add … to the Level.'
      : 'Tools → Narrative Bridge → Add … to the Level adds an actor with the story, its story panel and its cue player; or add a "Narrative Bridge" component to any actor and bind its events in Blueprint.',
    `Optional: run the story's automation tests (Tools → Session Frontend → Automation, filter "NarrativeBridge").`,
  ];
}

function readme(story: ProcessedStory, o: ExportOptions, name: string) {
  return `# ${story.project.project.title} — Unreal Engine export

Generated by Narrative Bridge. Story version \`${storyVersion(story)}\`.

## Run it
${setupSteps(o, name).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Requirements
- Unreal Engine ${o.engineVersion} (Inkpot documents 5.7+), a C++ toolchain (Visual Studio 2022 "Game development with C++" on Windows, Xcode on macOS)
  to build Inkpot, which comes as source code, and Git for the setup script.
- Optional: a .NET runtime, for Inkpot's Inklecate-based import. Without one, the story asset is made from \`MainStory.compiled.json\`
  and plays the same.

## Use it in a game you already have
1. Copy \`Plugins/NarrativeBridge/\` (and install Inkpot with the setup script) into your project's \`Plugins/\`.
2. Open the project, then choose *Tools → Narrative Bridge → Import Pen to Ink Story…* and pick this exported folder. It copies
   \`StorySource/\` and \`Content/NarrativeBridge/Data/\` in and imports the story. Export the story again later and import again:
   the assets are replaced in place, so Blueprints that refer to them keep working.
3. A project that used an earlier export of this story (when its code was a module called \`${name}\`) keeps its Blueprints
   working through the \`[CoreRedirects]\` in \`Config/DefaultEngine.ini\`: copy that section into your project's.
4. To skip compiling the Narrative Bridge plugin, export with a prebuilt one: \`narrative-bridge export … --engine unreal --plugin NarrativeBridge-<version>-UE<engine>.zip\`.
   Inkpot still comes as source code, so the project needs a C++ toolchain once for Inkpot until it is prebuilt too.

## Layout
- \`StorySource/MainStory.ink\` — canonical validated Ink; the editor imports it as the Inkpot story asset \`Content/NarrativeBridge/MainStory\`.
- \`StorySource/MainStory.compiled.json\` — the compiled story, which the automation tests play.
- \`StorySource/StoryInfo.json\` — the story's passages, lines, acts, cues and the conditions of its locked choices, as data (the editor imports it as \`Content/NarrativeBridge/StoryData\`).
- \`StorySource/ConditionChecks.json\` — what those conditions give for sample variable values; an automation test checks the C++ agrees.
- \`StorySource/PlaythroughRoutes.json\` — choices (by their text) that play from the start to every ending.
- \`StorySource/VoiceClips/\` — recorded dialogue and cue sounds; imported into \`Content/NarrativeBridge/Audio\`.
- \`Content/NarrativeBridge/Data/\` — the story panel's look (\`Theme.json\`), the translation sheet (\`Translations.csv\`) and the scene
  pictures, read while the game runs (\`Config/DefaultGame.ini\` stages them with the game).
- \`Plugins/NarrativeBridge/\` — all the code, as a plugin that is the same for every story. \`Source/NarrativeBridge/\` is the runtime module (the story component, story panel, cue player, translations, settings, the story data reader and the demo game mode). The project itself has no \`Source/\`: it is Blueprint-only, and you can copy the plugin into your own project.
- \`Plugins/NarrativeBridge/Source/NarrativeBridgeEditor/\` — the editor module: importing the story files, *Tools → Narrative Bridge*, and the automation tests.
- \`NarrativeBridge/\` — manifest, validation report, ISR, source map and original sources.

## The story component
Add a **Narrative Bridge** component to any actor (or use *Tools → Narrative Bridge → Add ${story.project.project.title} to the Level*, which also adds
the story panel and the cue player). It plays \`Content/NarrativeBridge/MainStory\` unless you set *Story Asset*.
- **Start it where you want.** Turn off *Start On Begin Play* and call \`StartStory\`, or \`StartAt("passage")\` to begin at a scene
  (\`GetPassages\` lists them). The **Narrative Story Trigger** component starts it when the player walks in.
- **Pick a conversation up partway.** Every line of dialogue can be a starting point too: \`StartAt("passage.line_…")\` (listed in
  \`GetLines\`). \`EnterAt(name)\` does the same but keeps what the story
  knows (its variables and items) when it has already run. Without code, add a **Narrative Enter Dialogue Trigger** component to the
  actor, pick the *Passage* and the *Line* the player picks up on, and, if you like, the *Required Item*: talk about flowers, go and
  get them, come back, and the conversation goes on at "You found them!" instead of from the top.
- **Events** (bind them in Blueprint): \`OnLine\` (speaker, text, tags) and \`OnLineShown\` (an \`FNarrativeLine\` with the scene, stage direction,
  picture and voice clip), \`OnChoices\` → \`Choose(index)\`, \`OnContinue\` → \`Continue\`, \`OnEnded\`, \`OnRestarted\`, \`OnStatusChanged\`,
  \`OnRuntimeError\`, \`OnCue\` / \`OnTag\` for the writer's cues, and \`OnVariableChanged\` for every story variable and item.
- **Exits to the game**: \`OnExit\` fires (with the exit's name, one of \`GetExits\`) instead of \`OnChoices\`, and the story
  panel steps aside. When the gameplay is done, call \`Resume\` to go on from there, or \`ResumeAt("passage")\` to go on somewhere else (after a
  lost fight, say); set variables or items first to tell the story what happened.
- **Variables**: \`GetBool\` / \`GetInt\` / \`GetFloat\` / \`GetString\` (or \`GetStoryValue\`, \`GetVariableAsString\`) and the matching \`Set…\` functions for the story's own variables (\`variables\` in \`StoryInfo.json\`). \`GetVariable\`, \`SetVariable\` and \`GetInkpotStory\` still work but are deprecated.
- **Inventory**: items are Ink Booleans \`has_<item>\`. Implement **Narrative Inventory Authority** (\`HasItem\`, \`GiveItem\`, \`TakeItem\`) on an
  actor or component, in C++ or Blueprint, and your inventory becomes the one source of truth: the story asks it before every step and sends it
  the gains and losses. **Narrative Simple Inventory** is a ready-made one. Or call \`SetItemOwned\` yourself.
- **Locked choices**: a choice that needs an item or a value the player doesn't have is left out by Ink. \`GetLockedChoices\` lists the ones in
  the current passage with what they need in words (the story panel shows them greyed out), and \`GetCurrentPassage\` says where the reader is.
- **Forced choices**: while a forced choice's condition holds, Ink offers only that choice in its passage, and \`GetLockedChoices\` stays empty.
- **Cutscenes**: only a cutscene's dialogue reaches the game, each line with \`bIsCutscene\` set (and a \`cutscene\` tag in \`OnLine\`'s Tags). The story
  panel shows its lines one at a time, each for long enough to read (1.2 s + 0.055 s a letter, 2 to 9 s), with a Skip button; a player who
  set *Go on by itself* to Off skips each line themselves.
- **Choices taken before**: the story panel greys out a choice the player has taken before (in this read or an earlier one; still
  clickable). \`WasChosen(Index)\` says so for your own UI and \`ForgetChosen\` clears it; it's kept in Saved/SaveGames/NarrativeBridge.
- **Pictures and portraits**: \`LoadPicture(file)\`, \`LoadPortrait(speakerId)\` and \`GetCurrentPicture\` give textures for your own UI.
- **Voice**: lines with a recorded clip play it (in order, scaled by the player's *Voice volume*); \`LoadVoiceClip\` gives the Sound Wave.

## The story panel
The **Narrative Story Panel** component puts a **Narrative Story Widget** on screen for the story on its actor: story text (everything so far,
the current scene, or one line at a time) typed out letter by letter, the speaking character's portrait, the scene picture behind, choices,
the Continue button, the ending, and a toolbar with Restart, Save, Load and Settings. Keys: 1-9 choose, Space or Return continues (or finishes
the line being typed), Escape closes a menu. Its look is the one chosen in Narrative Bridge (\`Content/NarrativeBridge/Data/Theme.json\`, about
70 settings in groups: colours, panel, text, speakers and scenes, typing and pacing, choices and buttons, toolbar, scene pictures, character
portraits, screen and sound). To change it in the editor, make a **Narrative Theme** data asset and set it on the story panel. *Font Family*
uses your own font. The UI scales with the screen from the theme's reference resolution (\`Config/DefaultEngine.ini\`). To design your own UI,
leave the story panel out and use the component's events.

## Italics and bold
Lines keep the script's emphasis as \`<i>…</i>\`, \`<b>…</b>\` and \`<u>…</u>\`. The story panel shows them. In your own UI, pass a line through
\`PlainText\` for a plain Text Block, or through \`RichText\` for a Rich Text Block whose text style set has rows named \`i\`, \`b\` and \`u\`.

## Cues
Writers add cues in Narrative Bridge: music, a sound, an ambience, a camera shake, or a name of their own, with an optional value
(\`#music:calm\`, \`#sound:door_creak\`, \`#shake:0.5\`), listed in \`StoryInfo.json\` (\`cues\` and \`cueTags\`). The **Narrative Cue Player**
component plays them without code: it lists every cue with a likely action (play or stop music, play a sound, loop an ambience, shake the camera
with your *Shake Class*, or only raise \`OnAnyCue\`). **Sounds the writer attached to cues come with the project and play by themselves**
(\`CueSoundTags\`; turn off *Play Story Sounds* to use only yours). To use your own sound for a value, add one named after it to the cue
(a sound called *calm* for \`music:calm\`). A music or ambience cue with no value stops it.

## Saves
The story panel's *Save* and *Load* open a menu of slots (*Save Slots* on the component, 3 by default), each showing the passage and when it was
saved, and an **autosave** is kept each time the reader reaches a new passage (*Autosave*). From Blueprint: \`SaveToSlot\`, \`LoadFromSlot\` (0 is
the autosave), \`GetSlots\`, \`DeleteSlot\` and \`OnSaved\`. Slots are small JSON files in \`Saved/SaveGames/NarrativeBridge/${name}/\`; to keep them
in your game's own saves, give *Save Storage* an object implementing **Narrative Save Storage**. Set *Save Slots* to 0 for the single quick save.

\`SaveState\` returns text you can keep in your own save system, and \`TryLoadState\` restores it. A save from an earlier version of the story is
carried over: the new version is replayed with the same choices, so revising the story doesn't break players' saves. \`GetLoadNote\` says what happened.

## Translations
\`Content/NarrativeBridge/Data/Translations.csv\` lists every piece of text the player sees (lines, choices, speaker names, scene headings, stage
directions, what locked choices need, and the story panel's own words), one per row, with a key made from its text. Translators add a column per
language (\`fr\`, \`de\`…) and fill it in; put their sheet in its place (or call \`UNarrativeLocalization::UseSheet\`). \`SetLanguage\` picks the
language (\`""\` for the story as written; the first time, the player's system language if the sheet has it), and the Settings menu gains a
*Language* row. Lines are found by their text, so revising the story keeps every translation whose line didn't change. \`FNarrativeLine\`'s
\`SourceText\` (and \`SourceSpeaker\`…) keep the original words.

## Player settings
The panel's *Settings* button opens a menu where the player sets the text size, typing speed (slow, normal, fast or instant), whether it goes on
by itself, high contrast and the voice volume. They're kept in GameUserSettings and shared by every Narrative Bridge story in the game. Your own
options menu can set the same things through **Narrative Settings** (\`SetTextScale\`, \`SetTypingSpeed\`, \`SetAutoAdvance\`, \`SetHighContrast\`,
\`SetVoiceVolume\`, \`ResetSettings\`); the menu's words are in the widget's *Words*.

## Automation tests
*Tools → Session Frontend → Automation*, filter \`NarrativeBridge\`, or headless:
\`UnrealEditor-Cmd ${name}.uproject -ExecCmds="Automation RunTests NarrativeBridge; Quit" -unattended -nullrhi\`. They replay every playthrough
route (each must offer the same choices, reach the same ending and finish on the same line as when it was exported), start at every passage,
save and load (and carry a save over from an earlier version), and check the translation keys and the story panel's look.

## Integration notes
- Inkpot is not vendored. \`Scripts/setup_inkpot.*\` clones it at \`${o.integrationRef}\`.${isPinnedRef(o.integrationRef) ? '' : ' **This is a branch — pin a tested tag or commit SHA.**'}
- **Engine versions:** built and tested with Unreal Engine 5.7 (\`npm run test:unreal:build\` in Narrative Bridge); Inkpot documents 5.7 and 5.8.
  Unreal 5.9 is newer than this Inkpot release promises: there its \`NativeFunctionCall.cpp\` (line 133) fails to compile because a log
  argument must now be an integer. Casting it, \`(int32)coercedType\`, gets the build through, and the story then plays; a newer Inkpot
  release may make that unnecessary. 5.6 and earlier aren't supported.
- The C++ targets Inkpot's \`UInkpot::BeginStory\` / \`UInkpotStory\` API and InkPlusPlus's \`Ink::FStory\`. Header paths and method names can
  change between Inkpot releases; if the build fails, compare against \`Plugins/Inkpot/Source\`.
- Exporting again replaces \`Plugins/NarrativeBridge/\`, \`StorySource/\`, \`Config/\` and \`Content/NarrativeBridge/Data/\`; run *Tools → Narrative Bridge →
  Re-import Story Files* afterwards. Your own Narrative Theme assets and levels are kept.
`;
}
