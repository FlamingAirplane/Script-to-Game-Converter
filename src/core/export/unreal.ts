import { audioFileName } from '../audio';
import { cueSounds } from '../cues';
import { describeCondition } from '../gating';
import { cueTag, EXIT_PREFIX, exitName, isActive, RESERVED_TAGS } from '../isr';
import { isForcing } from '../forced';
import type { ProcessedStory } from '../pipeline';
import { storyRoutes } from './routes';
import { translationSheet } from './translations';
import { assertExportable, audioFiles, buildManifest, imageFiles, commonFiles, isPinnedRef, itemVarNames, json, pascalCase, sourceFiles, storyVersion } from './common';
import type { EngineAdapter, ExportFile, ExportOptions, ExportResult } from './types';
import { finalize } from './unity';

// Unreal adapter. Uses The Chinese Room's Inkpot plugin, provisioned at a pinned ref by the
// included setup script (never vendored). The canonical .ink lives in StorySource/ and is imported
// by Inkpot into a native story asset. The C++ component targets Inkpot's documented
// subsystem/story API — verify it against the pinned Inkpot release (see README).

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
    { id: 'dotnet', label: '.NET runtime (for Inklecate-based import)', detail: 'Inkpot imports .ink through Inklecate, which needs a .NET runtime.', probe: { command: 'dotnet --list-runtimes' } },
    { id: 'git', label: 'Git on PATH', detail: 'The setup script clones Inkpot at the pinned ref.', probe: { command: 'git --version' } },
  ],
  async export(story, options) {
    assertExportable(story);
    const name = pascalCase(options.projectName);
    const root = `${name}/`;
    const manifest = await buildManifest(story, options, this);
    // Unreal imports audio through the editor, so clips ship next to the story source to drag in.
    const voice = audioFiles(story, options.audio, `${root}StorySource/VoiceClips/`);
    // Pictures too: drag them into the Content Browser; the #image tag names the file.
    const pictures = imageFiles(story, options.images, `${root}StorySource/Images/`);
    const files: ExportFile[] = [
      { path: `${root}${name}.uproject`, content: json(uproject(name, options)) },
      { path: `${root}StorySource/MainStory.ink`, content: story.generated.ink },
      { path: `${root}StorySource/MainStory.compiled.json`, content: story.compile.json! },
      // Every piece of text the player sees, keyed by its text, with any translations brought in (see translations.ts).
      { path: `${root}StorySource/Translations.csv`, content: translationSheet(story.project) },
      // Choice routes that reach every ending, for the game's own tests (see routes.ts).
      ...(/RANDOM\(|\{~/.test(story.generated.ink) ? [] : [{ path: `${root}StorySource/PlaythroughRoutes.json`, content: json({ about: 'Choices (by their text) that play from the start to each ending. Replay them through the story component and check each ending passage is reached and the last line matches.', routes: storyRoutes(story.compile.json!, story.project) }) }]),
      ...voice.files,
      ...pictures.files,
      { path: `${root}Config/DefaultGame.ini`, content: `[/Script/EngineSettings.GeneralProjectSettings]\nProjectName=${story.project.project.title.replace(/\n/g, ' ')}\n` },
      { path: `${root}Config/DefaultEngine.ini`, content: '[/Script/Engine.Engine]\n+ActiveGameNameRedirects=(OldGameName="TP_Blank",NewGameName="/Script/' + name + '")\n' },
      { path: `${root}Source/${name}.Target.cs`, content: target(name, 'Game') },
      { path: `${root}Source/${name}Editor.Target.cs`, content: target(name, 'Editor') },
      { path: `${root}Source/${name}/${name}.Build.cs`, content: buildCs(name) },
      { path: `${root}Source/${name}/${name}.cpp`, content: `#include "Modules/ModuleManager.h"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ${name}, "${name}");\n` },
      { path: `${root}Source/${name}/NarrativeBridgeStoryInfo.h`, content: storyInfoH(story) },
      ...(options.includeDemo
        ? [
            { path: `${root}Source/${name}/NarrativeBridgeComponent.h`, content: componentH(name) },
            { path: `${root}Source/${name}/NarrativeBridgeComponent.cpp`, content: COMPONENT_CPP },
          ]
        : []),
      { path: `${root}Plugins/README.md`, content: `Run ../Scripts/setup_inkpot.sh (macOS/Linux) or ..\\Scripts\\setup_inkpot.ps1 (Windows) to install Inkpot @ ${options.integrationRef} into Plugins/Inkpot/.\n` },
      { path: `${root}Scripts/setup_inkpot.sh`, content: setupSh(options) },
      { path: `${root}Scripts/setup_inkpot.ps1`, content: setupPs1(options) },
      { path: `${root}Content/NarrativeBridge/README.md`, content: 'Import ../../StorySource/MainStory.ink here (drag into the Content Browser) to create the Inkpot story asset.\n' },
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
    finalize(result, story, [`${root}${name}.uproject`, `${root}StorySource/MainStory.ink`, `${root}Source/${name}/${name}.Build.cs`]);
    return result;
  },
};

function uproject(name: string, o: ExportOptions) {
  return {
    FileVersion: 3,
    EngineAssociation: o.engineVersion,
    Category: '',
    Description: 'Generated by Narrative Bridge',
    Modules: [{ Name: name, Type: 'Runtime', LoadingPhase: 'Default', AdditionalDependencies: ['Engine'] }],
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
        ExtraModuleNames.Add("${name}");
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
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "Inkpot" });
    }
}
`;
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
    'In the editor, drag StorySource/MainStory.ink into Content/NarrativeBridge to let Inkpot import it as a story asset.',
    o.includeDemo
      ? 'Add a "Narrative Bridge" component to any actor, set its Story Asset, and bind OnLine / OnChoices in Blueprint (or call Choose).'
      : 'Use Inkpot\'s Blueprint nodes (Begin Story, Continue, Choose Choice) to run the story.',
  ];
}

function storyInfoH(story: ProcessedStory) {
  const items = itemVarNames(story);
  const q = (s: string) => `TEXT(${JSON.stringify(s)})`;
  const list = (name: string, values: string[], about: string) =>
    `    /** ${about} */\n    static const TCHAR* ${name}[] = { ${values.length ? values.map(q).join(', ') : 'nullptr'} };\n    static const int32 Num${name} = ${values.length};`;
  const passages = [...story.generated.ink.matchAll(/^=== (\w+) ===$/gm)].map((m) => m[1]);
  const knots = new Set(passages);
  const blocks = story.project.passages.flatMap((p) => p.content);
  const exits = [...new Set(blocks.flatMap((b) => (b.type === 'exit' ? [exitName(b.name)] : [])))];
  const cueTags = [...new Set(blocks.flatMap((b) => (b.type === 'cue' ? [cueTag(b.name, b.value)] : [])))];
  const sounds = [...cueSounds(story.project)].map(([tag, ref]) => [tag, audioFileName(ref)] as const);
  const gated = story.project.passages.flatMap((p) =>
    knots.has(p.id) ? p.choices.filter((c) => isActive(c.review) && c.conditions.length).map((c) => `{ ${q(p.id)}, ${q(c.text.trim())}, ${q(c.conditions.map((x) => describeCondition(x, story.project)).join(', '))}, ${isForcing(c) ? 'true' : 'false'} }`) : [],
  );
  return `// Auto-generated by Narrative Bridge. Regenerated on every export.
#pragma once

#include "CoreMinimal.h"

namespace NarrativeBridgeStoryInfo
{
    static const TCHAR* Title = ${q(story.project.project.title)};
    /** Changes whenever the generated Ink changes. Saves from another version must be rejected. */
    static const TCHAR* StoryVersion = ${q(storyVersion(story))};
    static const TCHAR* ItemVariables[] = { ${items.length ? items.map(q).join(', ') : 'nullptr'} };
    static const int32 NumItemVariables = ${items.length};
${list('Passages', passages, 'Every passage (Ink knot) the story can start at.')}
${list('Exits', exits, "The story's exits to the game (UNarrativeBridgeComponent::OnExit gives their names).")}
${list('CueTags', cueTags, 'Every cue as it appears in the story, with its value (e.g. "music:calm"); OnCue broadcasts them.')}
${list('CueSoundTags', sounds.map(([tag]) => tag), 'Cues the writer attached a sound to, and (in CueSoundFiles, same order) the file in StorySource/VoiceClips/ to play.')}
${list('CueSoundFiles', sounds.map(([, f]) => f), 'The sound for each of CueSoundTags.')}
${list('ReservedTags', [...RESERVED_TAGS], "Narrative Bridge's own tags (speaker:, audio:, …): every other tag is a cue.")}

    /** A choice that needs an item or a value: Ink leaves it out of the choices while it's locked. Show it greyed out if you like. */
    struct FGatedChoice
    {
        const TCHAR* Passage;
        const TCHAR* Text;
        /** What it needs, in words (e.g. "Archive Key"). */
        const TCHAR* Needs;
        /** A forced choice: while it's on offer it's the only choice in its passage, so show nothing else as locked. */
        bool bForced;
    };
    static const FGatedChoice GatedChoices[] = { ${gated.length ? gated.join(', ') : '{ nullptr, nullptr, nullptr, false }'} };
    static const int32 NumGatedChoices = ${gated.length};
}
`;
}

function componentH(name: string) {
  const api = `${name.toUpperCase()}_API`;
  return `// Generated by Narrative Bridge. Thin Blueprint-friendly wrapper around Inkpot.
// Written against Inkpot's UInkpot subsystem / UInkpotStory API; verify against your pinned Inkpot release.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "NarrativeBridgeComponent.generated.h"

class UInkpotStory;
class UInkpotStoryAsset;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FNarrativeLine, const FString&, Speaker, const FString&, Text, const TArray<FString>&, Tags);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FNarrativeChoices, const TArray<FString>&, Choices);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FNarrativeEnded);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FNarrativeCue, const FString&, Name, const FString&, Value);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FNarrativeExit, const FString&, ExitName);

UCLASS(ClassGroup = (NarrativeBridge), meta = (BlueprintSpawnableComponent, DisplayName = "Narrative Bridge"))
class ${api} UNarrativeBridgeComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Narrative Bridge")
    TObjectPtr<UInkpotStoryAsset> StoryAsset;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Narrative Bridge")
    bool bStartOnBeginPlay = true;

    UPROPERTY(BlueprintAssignable, Category = "Narrative Bridge")
    FNarrativeLine OnLine;

    UPROPERTY(BlueprintAssignable, Category = "Narrative Bridge")
    FNarrativeChoices OnChoices;

    UPROPERTY(BlueprintAssignable, Category = "Narrative Bridge")
    FNarrativeEnded OnEnded;

    /** A cue the writer added (#music:calm gives "music", "calm"): play music or a sound, shake the camera… See NarrativeBridgeStoryInfo::CueSoundTags for the sounds attached in Narrative Bridge. */
    UPROPERTY(BlueprintAssignable, Category = "Narrative Bridge")
    FNarrativeCue OnCue;

    /** An exit to the game: the dialogue stops here and the game plays (a fight, a puzzle…) until it calls Resume. */
    UPROPERTY(BlueprintAssignable, Category = "Narrative Bridge")
    FNarrativeExit OnExit;

    /** Goes on with the story after an exit to the game. */
    UFUNCTION(BlueprintCallable, Category = "Narrative Bridge")
    void Resume();

    UFUNCTION(BlueprintPure, Category = "Narrative Bridge")
    bool IsAtExit() const { return bAtExit; }

    /** A line without its emphasis tags (<i>, <b>, <u>), for a plain Text Block. */
    UFUNCTION(BlueprintPure, Category = "Narrative Bridge")
    static FString PlainText(const FString& Text);

    /** A line for a Rich Text Block whose text style set has rows named i, b and u (closing tags become </>). */
    UFUNCTION(BlueprintPure, Category = "Narrative Bridge")
    static FString RichText(const FString& Text);

    UFUNCTION(BlueprintCallable, Category = "Narrative Bridge")
    void StartStory();

    UFUNCTION(BlueprintCallable, Category = "Narrative Bridge")
    void Choose(int32 Index);

    UFUNCTION(BlueprintPure, Category = "Narrative Bridge")
    FString GetStoryVersion() const;

    /** Host-authoritative inventory: push the game's item state into Ink before continuing. */
    UFUNCTION(BlueprintCallable, Category = "Narrative Bridge")
    void SetItemOwned(const FString& ItemId, bool bOwned);

protected:
    virtual void BeginPlay() override;

private:
    void Advance();
    void BroadcastCues(const TArray<FString>& Tags);

    bool bAtExit = false;

    UPROPERTY(Transient)
    TObjectPtr<UInkpotStory> Story;
};
`;
}

const COMPONENT_CPP = `// Generated by Narrative Bridge.
#include "NarrativeBridgeComponent.h"
#include "NarrativeBridgeStoryInfo.h"
#include "Engine/Engine.h"
#include "Inkpot/Inkpot.h"
#include "Inkpot/InkpotStory.h"
#include "Inkpot/InkpotChoice.h"
#include "Asset/InkpotStoryAsset.h"

void UNarrativeBridgeComponent::BeginPlay()
{
    Super::BeginPlay();
    if (bStartOnBeginPlay) StartStory();
}

void UNarrativeBridgeComponent::StartStory()
{
    if (!StoryAsset)
    {
        UE_LOG(LogTemp, Error, TEXT("[NarrativeBridge] No StoryAsset assigned. Import StorySource/MainStory.ink first."));
        return;
    }
    UInkpot* Inkpot = GEngine->GetEngineSubsystem<UInkpot>();
    Story = Inkpot->BeginStory(StoryAsset);
    Advance();
}

void UNarrativeBridgeComponent::Choose(int32 Index)
{
    if (!Story) return;
    bAtExit = false;
    Story->ChooseChoiceIndex(Index);
    Advance();
}

void UNarrativeBridgeComponent::Resume()
{
    // An exit is a lone choice in Ink: taking it goes on with the story.
    if (bAtExit) Choose(0);
}

FString UNarrativeBridgeComponent::PlainText(const FString& Text)
{
    static const TCHAR* EmphasisTags[] = { TEXT("<i>"), TEXT("</i>"), TEXT("<b>"), TEXT("</b>"), TEXT("<u>"), TEXT("</u>") };
    FString Out = Text;
    for (const TCHAR* Tag : EmphasisTags) Out.ReplaceInline(Tag, TEXT(""), ESearchCase::CaseSensitive);
    return Out;
}

FString UNarrativeBridgeComponent::RichText(const FString& Text)
{
    static const TCHAR* Closing[] = { TEXT("</i>"), TEXT("</b>"), TEXT("</u>") };
    FString Out = Text;
    for (const TCHAR* Tag : Closing) Out.ReplaceInline(Tag, TEXT("</>"), ESearchCase::CaseSensitive);
    return Out;
}

void UNarrativeBridgeComponent::BroadcastCues(const TArray<FString>& Tags)
{
    for (const FString& Raw : Tags)
    {
        const FString Tag = Raw.TrimStartAndEnd();
        FString Name = Tag;
        FString Value;
        int32 Colon = INDEX_NONE;
        if (Tag.FindChar(TEXT(':'), Colon))
        {
            Name = Tag.Left(Colon).TrimStartAndEnd();
            Value = Tag.Mid(Colon + 1).TrimStartAndEnd();
        }
        if (Name.IsEmpty()) continue;
        bool bReserved = false;
        for (int32 i = 0; i < NarrativeBridgeStoryInfo::NumReservedTags; ++i)
            if (Name == NarrativeBridgeStoryInfo::ReservedTags[i]) { bReserved = true; break; }
        if (!bReserved) OnCue.Broadcast(Name, Value);
    }
}

void UNarrativeBridgeComponent::SetItemOwned(const FString& ItemId, bool bOwned)
{
    if (Story) Story->SetBool(FString(TEXT("has_")) + ItemId, bOwned);
}

FString UNarrativeBridgeComponent::GetStoryVersion() const
{
    return NarrativeBridgeStoryInfo::StoryVersion;
}

void UNarrativeBridgeComponent::Advance()
{
    while (Story->CanContinue())
    {
        const FString Raw = Story->Continue().TrimStartAndEnd();
        const TArray<FString> Tags = Story->GetCurrentTags();
        BroadcastCues(Tags);
        if (Raw.IsEmpty()) continue;
        FString Speaker;
        FString Text = Raw;
        for (const FString& Tag : Tags)
        {
            if (Tag.StartsWith(TEXT("speaker:")))
            {
                Raw.Split(TEXT(": "), &Speaker, &Text);
                break;
            }
        }
        OnLine.Broadcast(Speaker, Text, Tags);
    }
    TArray<FString> Labels;
    for (UInkpotChoice* Choice : Story->GetCurrentChoices()) Labels.Add(Choice->GetString());
    const FString ExitPrefix = TEXT("${EXIT_PREFIX}");
    if (Labels.Num() == 1 && Labels[0].StartsWith(ExitPrefix))
    {
        bAtExit = true;
        OnExit.Broadcast(Labels[0].Mid(ExitPrefix.Len()));
        return;
    }
    if (Labels.Num() > 0) OnChoices.Broadcast(Labels);
    else OnEnded.Broadcast();
}
`;

function readme(story: ProcessedStory, o: ExportOptions, name: string) {
  return `# ${story.project.project.title} — Unreal Engine export

Generated by Narrative Bridge. Story version \`${storyVersion(story)}\`.

## Run it
${setupSteps(o, name).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Requirements
- Unreal Engine ${o.engineVersion} (Inkpot documents 5.7+), a C++ toolchain (Visual Studio 2022 "Game development with C++" on Windows, Xcode on macOS),
  and a .NET runtime for Inkpot's Inklecate-based import.

## Layout
- \`StorySource/MainStory.ink\` — canonical validated Ink (a Narrative Bridge convention, not a required Inkpot folder).
- \`StorySource/MainStory.compiled.json\` — preflight output, for reference/testing only; Inkpot owns native asset generation.
- \`StorySource/Translations.csv\` — every line, choice and name the player sees, keyed by its text, with a column per language
  translators fill in (and any translations already brought in). Look a line up by its key (FNV-1a of its words; see the sheet's
  source column) to show it in another language.
- \`StorySource/PlaythroughRoutes.json\` — choices (by their text) that play from the start to every ending, with the ending
  passage and last line, to replay in your own automation tests after wiring the story in.
- \`Source/${name}/NarrativeBridgeComponent.*\` — Blueprint-friendly wrapper (OnLine, OnChoices, OnEnded, OnCue, OnExit, Choose, Resume).
- \`NarrativeBridge/\` — manifest, validation report, ISR, source map and original sources.

## Integration notes
- Inkpot is not vendored. \`Scripts/setup_inkpot.*\` clones it at \`${o.integrationRef}\`.${isPinnedRef(o.integrationRef) ? '' : ' **This is a branch — pin a tested tag or commit SHA.**'}
- The component targets Inkpot's \`UInkpot::BeginStory\` / \`UInkpotStory\` API. Header paths and method names can change between
  Inkpot releases; if the build fails, compare against \`Plugins/Inkpot/Source\` and the InkpotDemo project.
- Engine import and in-editor smoke tests are recorded as \`pending\` in the manifest until run.

## Italics and bold
Lines keep the script's emphasis as \`<i>…</i>\`, \`<b>…</b>\` and \`<u>…</u>\`. For a plain Text Block, pass a line through
\`PlainText\`; for a Rich Text Block, add rows named \`i\`, \`b\` and \`u\` to its text style set and pass it through \`RichText\`.

## Cues, exits and locked choices
- **Cues** (\`#music:calm\`, \`#shake\`): \`OnCue\` gives each one's name and value as the story reaches it. The sounds the writer
  attached are listed in \`NarrativeBridgeStoryInfo::CueSoundTags\` / \`CueSoundFiles\` and ship in \`StorySource/VoiceClips/\`.
- **Exits to the game**: \`OnExit\` fires instead of \`OnChoices\`; let the game play, then call \`Resume\`. The names are in
  \`NarrativeBridgeStoryInfo::Exits\`.
- **Locked choices**: Ink leaves a choice out while its condition fails. \`NarrativeBridgeStoryInfo::GatedChoices\` lists each one
  with its passage and what it needs in words, to show it greyed out.
- **Forced choices**: while a forced choice's condition holds, Ink offers only that choice in its passage (the others carry
  an extra condition). Its \`GatedChoices\` entry has \`bForced\` set: when it's on offer, show nothing else as locked.

## Voice clips
Recorded dialogue ships in \`StorySource/VoiceClips/\`. Drag the folder into \`Content/NarrativeBridge/Audio\` to import the clips as
Sound Waves. Lines with a clip carry an \`audio:<file>\` tag in \`OnLine\`'s Tags; play the matching Sound Wave from Blueprint.

## Inventory and saves
Items are Ink Booleans \`has_<item>\`. Keep the game inventory authoritative and call \`SetItemOwned\` before continuing.
Persist \`GetStoryVersion()\` with save data and restart the narrative if it differs.
`;
}
