import { CONDITION_H, INK_COMPAT_CPP, INK_COMPAT_H, INK_CPP, INK_H, INK_OBSERVER_H, INVENTORY_H, LOCALIZATION_CPP, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_CPP, SETTINGS_H, STORY_DATA_CPP, STORY_DATA_H, TYPES_H } from './templates.generated';
export { CONDITION_H, INK_COMPAT_CPP, INK_COMPAT_H, INK_CPP, INK_H, INK_OBSERVER_H, INVENTORY_H, LOCALIZATION_CPP, LOCALIZATION_H, SAVE_STORAGE_H, SETTINGS_CPP, SETTINGS_H, STORY_DATA_CPP, STORY_DATA_H, TYPES_H };
// The Unreal export's runtime C++ (the game module): the story component, its types and interfaces, translations,
// the player's reading settings, the cue player, and two small helpers for hooking the story into a game. The
// story panel is in unrealUi.ts and the editor module (import, tests) in unrealEditor.ts. Written against Inkpot's
// UInkpot / UInkpotStory API and InkPlusPlus's Ink::FStory, at the pinned release; `npm run test:unreal:build`
// builds it with a real Unreal Engine.
//
// __API__ is the module's export macro (e.g. ARCHIVE_API) and __MODULE__ its name; see fillUnreal.

/** Fills the module's name and export macro into a C++ template. */
export function fillUnreal(template: string, module: string): string {
  return template.replace(/__API__/g, `${module.toUpperCase()}_API`).replace(/__MODULE__/g, module);
}

