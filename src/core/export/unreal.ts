import { audioFileName } from '../audio';
import { cueSounds } from '../cues';
import { describeCondition } from '../gating';
import { portraitFiles } from '../images';
import { CONTINUE_TEXT, cueName, cueTag, EXIT_PREFIX, exitName, isActive, itemVar, RESERVED_TAGS, type Condition } from '../isr';
import { isForcing } from '../forced';
import type { ProcessedStory } from '../pipeline';
import { storyRoutes } from './routes';
import { translationSheet } from './translations';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, isPinnedRef, itemVarNames, json, pascalCase, sourceFiles, storyVersion } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { finalize } from './unity';
import { normaliseUnityTheme } from './unityTheme';
import { COMPONENT_CPP, COMPONENT_H } from './unrealComponent';
import { CUE_PLAYER_CPP, CUE_PLAYER_H, INVENTORY_COMPONENT_H, TRIGGER_CPP, TRIGGER_H } from './unrealCues';
import { EDITOR_MODULE_CPP, editorBuildCs, keySamples, routesH, testsCpp } from './unrealEditor';
import { fillUnreal, INVENTORY_H, LOCALIZATION_CPP, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_CPP, SETTINGS_H, TYPES_H } from './unrealRuntime';
import { DEMO_CPP, DEMO_H, PANEL_CPP, PANEL_H, THEME_CPP, themeH, unrealThemeJson, WIDGET_CPP, WIDGET_H } from './unrealUi';

// Unreal adapter. Uses The Chinese Room's Inkpot plugin, provisioned at a pinned ref by the included setup script (never
// vendored). The export is a complete Unreal project with two C++ modules:
// - the game module: the story component (a port of the Unity package's NarrativeController), its translations, the
//   player's reading settings, the cue player, a themed story panel (UMG, built in C++ from the same look as the Unity
//   story panel), and helpers for hooking the story into a game (see unrealRuntime.ts, unrealComponent.ts, unrealCues.ts,
//   unrealUi.ts);
// - the editor module: it imports the story files the first time the project opens, adds Tools → Narrative Bridge, and
//   holds the automation tests (see unrealEditor.ts).
// The canonical .ink lives in StorySource/ and Inkpot imports it as a native story asset. `npm run test:unreal:build`
// builds the export with a real Unreal Engine and Inkpot; `npm run test:unreal` checks its C++ against stand-in headers.

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
    { id: 'unreal', label: `Unreal Engine ${o.engineVersion}`, detail: 'Inkpot documents UE 5.7 or later. Install via the Epic Games Launcher.', probe: { paths: ['/Users/Shared/Epic Games', 'C:\\Program Files\\Epic Games'] } },
    { id: 'toolchain', label: 'C++ toolchain', detail: 'Visual Studio 2022 with "Game development with C++" on Windows, or Xcode on macOS.', probe: { command: 'xcodebuild -version' } },
    { id: 'dotnet', label: '.NET runtime (for Inklecate-based import)', detail: 'Inkpot imports .ink through Inklecate, which needs a .NET runtime. Without it the story is imported from its compiled JSON instead.', probe: { command: 'dotnet --list-runtimes' } },
    { id: 'git', label: 'Git on PATH', detail: 'The setup script clones Inkpot at the pinned ref.', probe: { command: 'git --version' } },
  ],
  async export(story, options) {
    assertExportable(story);
    const name = pascalCase(options.projectName);
    const root = `${name}/`;
    const src = `${root}Source/${name}/`;
    const ed = `${root}Source/${name}Editor/`;
    const manifest = await buildManifest(story, options, this);
    const theme = normaliseUnityTheme(options.unityTheme ?? story.project.presentation?.unity);
    // Voice clips and cue sounds are imported as Sound Waves by the editor module (into Content/NarrativeBridge/Audio).
    const voice = audioFiles(story, options.audio, `${root}StorySource/VoiceClips/`);
    // Pictures are decoded at run time from their PNG/JPEG bytes (as in the Unity package): no import settings needed.
    const pictures = imageFiles(story, options.images, `${root}Content/${DATA}Images/`);
    // Playthrough routes for the tests; not for Ink with randomness, which needn't replay the same way.
    const routes = /RANDOM\(|\{~/.test(story.generated.ink) ? [] : storyRoutes(story.compile.json!, story.project);
    const fill = (template: string) => fillUnreal(template, name);
    const files: ExportFile[] = [
      { path: `${root}${name}.uproject`, content: json(uproject(name, options)) },
      { path: `${root}StorySource/MainStory.ink`, content: story.generated.ink },
      { path: `${root}StorySource/MainStory.compiled.json`, content: story.compile.json! },
      ...(routes.length ? [{ path: `${root}StorySource/PlaythroughRoutes.json`, content: json({ about: 'Choices (by their text) that play from the start to each ending. The NarrativeBridge.Playthrough automation tests replay them.', routes }) }] : []),
      ...voice.files,
      // The story panel's look and the translation sheet, read at run time (see NarrativeTheme and NarrativeLocalization).
      { path: `${root}Content/${DATA}Theme.json`, content: json(unrealThemeJson(theme)) },
      { path: `${root}Content/${DATA}Translations.csv`, content: translationSheet(story.project, theme, options.translationLanguages ?? []) },
      ...pictures.files,
      { path: `${root}Config/DefaultGame.ini`, content: defaultGameIni(story) },
      { path: `${root}Config/DefaultEngine.ini`, content: defaultEngineIni(name, theme, options.includeDemo) },
      { path: `${root}Source/${name}.Target.cs`, content: target(name, 'Game') },
      { path: `${root}Source/${name}Editor.Target.cs`, content: target(name, 'Editor') },
      { path: `${src}${name}.Build.cs`, content: buildCs(name) },
      { path: `${src}${name}.cpp`, content: `#include "Modules/ModuleManager.h"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ${name}, "${name}");\n` },
      { path: `${src}NarrativeBridgeStoryInfo.h`, content: storyInfoH(story, name) },
      { path: `${src}NarrativeBridgeTypes.h`, content: fill(TYPES_H) },
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
      { path: `${src}NarrativeSimpleInventory.h`, content: fill(INVENTORY_COMPONENT_H) },
      { path: `${src}NarrativeTheme.h`, content: fill(themeH(theme)) },
      { path: `${src}NarrativeTheme.cpp`, content: fill(THEME_CPP) },
      { path: `${src}NarrativeStoryWidget.h`, content: fill(WIDGET_H) },
      { path: `${src}NarrativeStoryWidget.cpp`, content: fill(WIDGET_CPP) },
      { path: `${src}NarrativeStoryPanel.h`, content: fill(PANEL_H) },
      { path: `${src}NarrativeStoryPanel.cpp`, content: fill(PANEL_CPP) },
      ...(options.includeDemo
        ? [
            { path: `${src}NarrativeDemoGameMode.h`, content: fill(DEMO_H) },
            { path: `${src}NarrativeDemoGameMode.cpp`, content: fill(DEMO_CPP) },
          ]
        : []),
      { path: `${ed}${name}Editor.Build.cs`, content: editorBuildCs(name) },
      { path: `${ed}${name}Editor.cpp`, content: fill(EDITOR_MODULE_CPP) },
      { path: `${ed}NarrativeBridgeRoutes.h`, content: routesH(routes) },
      { path: `${ed}NarrativeBridgeTests.cpp`, content: testsCpp(keySamples(story.project.passages.flatMap((p) => p.choices.map((c) => c.text)).slice(0, 3))) },
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
    finalize(result, story, [`${root}${name}.uproject`, `${root}StorySource/MainStory.ink`, `${src}${name}.Build.cs`]);
    return result;
  },
};

function uproject(name: string, o: ExportOptions) {
  return {
    FileVersion: 3,
    EngineAssociation: o.engineVersion,
    Category: '',
    Description: 'Generated by Narrative Bridge',
    Modules: [
      { Name: name, Type: 'Runtime', LoadingPhase: 'Default', AdditionalDependencies: ['Engine', 'UMG'] },
      { Name: `${name}Editor`, Type: 'Editor', LoadingPhase: 'Default' },
    ],
    Plugins: [{ Name: 'Inkpot', Enabled: true }],
  };
}

function target(name: string, kind: 'Game' | 'Editor') {
  const cls = kind === 'Game' ? `${name}Target` : `${name}EditorTarget`;
  return `using UnrealBuildTool;

public class ${cls} : TargetRules
{
    public ${cls}(TargetInfo Target) : base(Target)
    {
        Type = TargetType.${kind};
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("${name}");${kind === 'Editor' ? `\n        ExtraModuleNames.Add("${name}Editor");` : ''}
    }
}
`;
}

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
  return `[/Script/Engine.Engine]
+ActiveGameNameRedirects=(OldGameName="TP_Blank",NewGameName="/Script/${name}")

[/Script/Engine.UserInterfaceSettings]
UIScaleRule=${rule}
UIScaleCurve=(EditorCurveData=(Keys=((Time=0.000000,Value=0.000000),(Time=${(reference * 8).toFixed(6)},Value=8.000000))),ExternalCurve=None)
${demo ? `
[/Script/EngineSettings.GameMapsSettings]
; Press Play: the demo game mode puts the story on screen in any level.
GlobalDefaultGameMode=/Script/${name}.NarrativeDemoGameMode
EditorStartupMap=/Engine/Maps/Entry
GameDefaultMap=/Engine/Maps/Entry
` : ''}`;
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
    `Run Scripts/setup_inkpot.sh (or .ps1 on Windows) to clone Inkpot @ ${o.integrationRef} into Plugins/Inkpot.`,
    `Right-click ${name}.uproject → Generate project files, then build the "${name}Editor" target (or open the .uproject and accept the rebuild prompt).`,
    'Open the project: the first time, the editor imports StorySource/MainStory.ink (as an Inkpot story asset) and the voice clips into Content/NarrativeBridge.',
    o.includeDemo
      ? 'Press Play: the story runs in its themed story panel. To put it in your own level, use Tools → Narrative Bridge → Add … to the Level.'
      : 'Tools → Narrative Bridge → Add … to the Level adds an actor with the story, its story panel and its cue player; or add a "Narrative Bridge" component to any actor and bind its events in Blueprint.',
    `Optional: run the story's automation tests (Tools → Session Frontend → Automation, filter "NarrativeBridge").`,
  ];
}

const q = (s: string) => `TEXT(${JSON.stringify(s)})`;

/** A choice's condition as C++, reading Ink variables through V (a NarrativeBridgeStoryInfo::FVariableReader). */
export function conditionCpp(c: Condition): string {
  switch (c.type) {
    case 'has_item':
      return `V.Has(${q(itemVar(c.itemId))})`;
    case 'not':
      return `!(${conditionCpp(c.condition)})`;
    case 'and':
      return `(${c.conditions.map(conditionCpp).join(' && ') || 'true'})`;
    case 'or':
      return `(${c.conditions.map(conditionCpp).join(' || ') || 'false'})`;
    case 'compare': {
      const v = c.value;
      if (typeof v === 'string') return `V.CompareText(${q(c.variableId)}, ${q(c.op)}, ${q(v)})`;
      if (typeof v === 'boolean') return `V.CompareBool(${q(c.variableId)}, ${q(c.op)}, ${v})`;
      return `V.CompareNumber(${q(c.variableId)}, ${q(c.op)}, ${Number.isInteger(v) ? `${v}.0` : String(v)})`;
    }
  }
}

function storyInfoH(story: ProcessedStory, module: string) {
  const items = itemVarNames(story);
  const list = (name: string, values: string[], about: string) =>
    `    /** ${about} */\n    static const TCHAR* ${name}[] = { ${values.length ? values.map(q).join(', ') : 'nullptr'} };\n    static const int32 Num${name} = ${values.length};`;
  const passages = [...story.generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]);
  const knots = new Set(passages);
  const blocks = story.project.passages.flatMap((p) => p.content);
  const exits = [...new Set(blocks.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : [])))];
  const cueBlocks = blocks.flatMap((b) => (b.type === 'cue' ? [b] : []));
  const cues = [...new Set(cueBlocks.map((b) => cueName(b.name)))];
  const cueTags = [...new Set(cueBlocks.map((b) => cueTag(b.name, b.value)))];
  const sounds = [...cueSounds(story.project)].map(([tag, ref]) => [tag, audioFileName(ref)] as const);
  const portraits = Object.entries(portraitFiles(story.project));
  const gated = story.project.passages.flatMap((p) => (knots.has(p.id) ? p.choices.filter((c) => isActive(c.review) && c.conditions.length).map((c) => ({ passage: p.id, choice: c })) : []));
  const requirements = gated.map(
    ({ choice }, i) =>
      `    static const FRequirement Requirements${i}[] = { ${choice.conditions.map((x) => `{ ${q(describeCondition(x, story.project))}, [](const FVariableReader& V) -> bool { return ${conditionCpp(x)}; } }`).join(', ')} };`,
  );
  const gatedRows = gated.map(
    ({ passage, choice }, i) =>
      `{ Requirements${i}, ${choice.conditions.length}, ${q(passage)}, ${q(choice.text.trim())}, ${q(choice.conditions.map((x) => describeCondition(x, story.project)).join(', '))}, ${isForcing(choice) ? 'true' : 'false'} }`,
  );
  return `// Auto-generated by Narrative Bridge. Regenerated on every export.
#pragma once

#include "CoreMinimal.h"

namespace NarrativeBridgeStoryInfo
{
    static const TCHAR* Title = ${q(story.project.project.title)};
    static const TCHAR* ProjectId = ${q(story.project.project.id)};
    /** Changes whenever the generated Ink changes. Saves from another version are carried over by replaying their choices. */
    static const TCHAR* StoryVersion = ${q(storyVersion(story))};
    /** The language the story is written in (the translation sheet's "source" column). */
    static const TCHAR* SourceLanguage = TEXT("en");

    /** The Inkpot story asset the editor imports from StorySource/MainStory.ink. */
    static const TCHAR* StoryAssetPath = TEXT("/Game/NarrativeBridge/MainStory.MainStory");
    /** Where the editor imports the voice clips and cue sounds (StorySource/VoiceClips). */
    static const TCHAR* AudioPackagePath = TEXT("/Game/NarrativeBridge/Audio/");
    /** The story's files read while the game runs, under Content/ (staged with the game; see Config/DefaultGame.ini). */
    static const TCHAR* ThemeFile = TEXT("${DATA}Theme.json");
    static const TCHAR* TranslationsFile = TEXT("${DATA}Translations.csv");
    static const TCHAR* ImageFolder = TEXT("${DATA}Images/");
    /** Save slots go in Saved/SaveGames/NarrativeBridge/<this>/. */
    static const TCHAR* SaveFolder = ${q(module)};

    /** The text of a Continue break's only choice, and the text before an exit's name (see the Ink conventions). */
    static const TCHAR* ContinueText = ${q(CONTINUE_TEXT)};
    static const TCHAR* ExitPrefix = ${q(EXIT_PREFIX)};

${list('Passages', passages, 'Every passage (Ink knot) the story can start at: UNarrativeBridgeComponent::StartAt.')}
    /** Each passage's title, in the same order as Passages (for save slots and menus). */
    static const TCHAR* PassageTitles[] = { ${passages.length ? passages.map((k) => q(story.project.passages.find((p) => p.id === k)?.title || k)).join(', ') : 'nullptr'} };
    static const TCHAR* ItemVariables[] = { ${items.length ? items.map(q).join(', ') : 'nullptr'} };
    static const int32 NumItemVariables = ${items.length};
${list('Variables', story.project.variables.map((v) => v.id), 'Story variables the game is allowed to read and write (GetVariable, SetVariable).')}
${list('Exits', exits, "The story's exits to the game (UNarrativeBridgeComponent::OnExit gives their names).")}
${list('Cues', cues, 'The cues the writer added (#music:calm → "music"); the Narrative Cue Player plays them.')}
${list('CueTags', cueTags, 'Every cue as it appears in the story, with its value (e.g. "music:calm"); OnCue broadcasts them.')}
${list('CueSoundTags', sounds.map(([tag]) => tag), 'Cues the writer attached a sound to, and (in CueSoundFiles, same order) the file in StorySource/VoiceClips/ to play.')}
${list('CueSoundFiles', sounds.map(([, f]) => f), 'The sound for each of CueSoundTags.')}
${list('PortraitSpeakers', portraits.map(([k]) => k), "Characters with a portrait (speaker ids, as in #speaker tags), and (in PortraitFiles) each one's picture in ImageFolder.")}
${list('PortraitFiles', portraits.map(([, f]) => f), 'The picture for each of PortraitSpeakers.')}
${list('ReservedTags', [...RESERVED_TAGS], "Narrative Bridge's own tags (speaker:, audio:, …): every other tag is a cue.")}

    /** Reads the story's variables for a locked choice's conditions (the story component gives one). */
    struct FVariableReader
    {
        virtual ~FVariableReader() = default;
        /** Whether a variable is true (items are Ink Booleans named has_<item>). */
        virtual bool Has(const TCHAR* Name) const = 0;
        virtual bool CompareNumber(const TCHAR* Name, const TCHAR* Op, double Value) const = 0;
        virtual bool CompareText(const TCHAR* Name, const TCHAR* Op, const TCHAR* Value) const = 0;
        virtual bool CompareBool(const TCHAR* Name, const TCHAR* Op, bool Value) const = 0;
    };

    /** One condition: in plain words ("Brass Key", "trust at least 2") and as a test of the story's variables. */
    struct FRequirement
    {
        const TCHAR* Words;
        bool (*Test)(const FVariableReader& V);
    };

${requirements.join('\n')}

    /** A choice that needs an item or a value: Ink leaves it out of the choices while it's locked (GetLockedChoices lists them). */
    struct FGatedChoice
    {
        const FRequirement* Requirements;
        int32 NumRequirements;
        const TCHAR* Passage;
        const TCHAR* Text;
        /** What it needs, in words (e.g. "Archive Key"). */
        const TCHAR* Needs;
        /** A forced choice: while it's on offer it's the only choice in its passage, so show nothing else as locked. */
        bool bForced;
    };
    static const FGatedChoice GatedChoices[] = { ${gatedRows.length ? gatedRows.join(',\n        ') : '{ nullptr, 0, nullptr, nullptr, nullptr, false }'} };
    static const int32 NumGatedChoices = ${gatedRows.length};
}
`;
}

function readme(story: ProcessedStory, o: ExportOptions, name: string) {
  return `# ${story.project.project.title} — Unreal Engine export

Generated by Narrative Bridge. Story version \`${storyVersion(story)}\`.

## Run it
${setupSteps(o, name).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Requirements
- Unreal Engine ${o.engineVersion} (Inkpot documents 5.7+), a C++ toolchain (Visual Studio 2022 "Game development with C++" on Windows, Xcode on macOS),
  and a .NET runtime for Inkpot's Inklecate-based import (without one, the story asset is made from \`MainStory.compiled.json\`).

## Layout
- \`StorySource/MainStory.ink\` — canonical validated Ink; the editor imports it as the Inkpot story asset \`Content/NarrativeBridge/MainStory\`.
- \`StorySource/MainStory.compiled.json\` — the compiled story, which the automation tests play.
- \`StorySource/PlaythroughRoutes.json\` — choices (by their text) that play from the start to every ending.
- \`StorySource/VoiceClips/\` — recorded dialogue and cue sounds; imported into \`Content/NarrativeBridge/Audio\`.
- \`Content/NarrativeBridge/Data/\` — the story panel's look (\`Theme.json\`), the translation sheet (\`Translations.csv\`) and the scene
  pictures, read while the game runs (\`Config/DefaultGame.ini\` stages them with the game).
- \`Source/${name}/\` — the game module: the story component, story panel, cue player, translations and settings.
- \`Source/${name}Editor/\` — the editor module: importing the story files, *Tools → Narrative Bridge*, and the automation tests.
- \`NarrativeBridge/\` — manifest, validation report, ISR, source map and original sources.

## The story component
Add a **Narrative Bridge** component to any actor (or use *Tools → Narrative Bridge → Add ${story.project.project.title} to the Level*, which also adds
the story panel and the cue player). It plays \`Content/NarrativeBridge/MainStory\` unless you set *Story Asset*.
- **Start it where you want.** Turn off *Start On Begin Play* and call \`StartStory\`, or \`StartAt("passage")\` to begin at a scene
  (the passages are in \`NarrativeBridgeStoryInfo::Passages\`). The **Narrative Story Trigger** component starts it when the player walks in.
- **Events** (bind them in Blueprint): \`OnLine\` (speaker, text, tags) and \`OnLineShown\` (an \`FNarrativeLine\` with the scene, stage direction,
  picture and voice clip), \`OnChoices\` → \`Choose(index)\`, \`OnContinue\` → \`Continue\`, \`OnEnded\`, \`OnRestarted\`, \`OnStatusChanged\`,
  \`OnRuntimeError\`, \`OnCue\` / \`OnTag\` for the writer's cues, and \`OnVariableChanged\` for every story variable and item.
- **Exits to the game**: \`OnExit\` fires (with the exit's name, one of \`NarrativeBridgeStoryInfo::Exits\`) instead of \`OnChoices\`, and the story
  panel steps aside. When the gameplay is done, call \`Resume\` to go on from there, or \`ResumeAt("passage")\` to go on somewhere else (after a
  lost fight, say); set variables or items first to tell the story what happened.
- **Variables**: \`GetVariable\` / \`GetVariableAsString\` and \`SetVariable\` for the story's own variables (\`NarrativeBridgeStoryInfo::Variables\`).
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
(\`#music:calm\`, \`#sound:door_creak\`, \`#shake:0.5\`), listed in \`NarrativeBridgeStoryInfo::Cues\` and \`CueTags\`. The **Narrative Cue Player**
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
- The C++ targets Inkpot's \`UInkpot::BeginStory\` / \`UInkpotStory\` API and InkPlusPlus's \`Ink::FStory\`. Header paths and method names can
  change between Inkpot releases; if the build fails, compare against \`Plugins/Inkpot/Source\`.
- Exporting again replaces \`Source/\`, \`StorySource/\`, \`Config/\` and \`Content/NarrativeBridge/Data/\`; run *Tools → Narrative Bridge →
  Re-import Story Files* afterwards. Your own Narrative Theme assets and levels are kept.
`;
}
