// The Unreal export's editor module (NarrativeBridgeEditor): it imports the story files into Content/NarrativeBridge the first
// time the project opens (the story through Inkpot's .ink importer, the voice clips and cue sounds as Sound Waves), adds
// Tools → Narrative Bridge menu entries, and holds the automation tests: the playthrough routes, starting at every
// passage, saves and their carry-over to a revised story, locked choices and translation keys. They take the place of
// the Unity package's playthrough runner and smoke test. Filled with fillUnreal (unrealRuntime.ts).

import { translationKey } from './translations';
import { EDITOR_INK_IMPORT_CPP, EDITOR_INK_IMPORT_H, EDITOR_MODULE_CPP, EDITOR_STORY_DATA_TESTS_CPP, EDITOR_TESTS_CPP } from './templates.generated';
export { EDITOR_INK_IMPORT_CPP, EDITOR_INK_IMPORT_H, EDITOR_MODULE_CPP, EDITOR_STORY_DATA_TESTS_CPP, EDITOR_TESTS_CPP };

export function editorBuildCs(module: string): string {
  return `using UnrealBuildTool;

public class ${module}Editor : ModuleRules
{
    public ${module}Editor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UnrealEd", "AssetTools", "AssetRegistry", "ToolMenus", "Slate", "SlateCore", "Json", "DesktopPlatform", "Projects", "ApplicationCore", "Inkpot", "InkPlusPlus", "${module}" });
        // Only NarrativeBridgeInkImport.cpp uses Inkpot and InkPlusPlus; the rest of this module reaches the story through ${module}.
    }
}
`;
}

/** A few texts and their translation keys, worked out here, so a test proves the C++ key matches Narrative Bridge's. */
export function keySamples(texts: string[]): [string, string][] {
  const base = ['The lamp is out.', '  Spaces   tidied\tup  ', 'Café — naïve “quotes”'];
  return [...new Set([...base, ...texts])].slice(0, 6).map((t) => [t, translationKey(t)]);
}
