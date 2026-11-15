import { SETTINGS_CS, THEME_CS, VIEW_CS } from './templates.generated';
export { SETTINGS_CS, THEME_CS, VIEW_CS };
// The Unity story UI: a theme asset the developer edits in the Inspector (NarrativeTheme) and a uGUI
// view built from it at runtime (NarrativeView). The writer's choices from the Export page arrive as
// the package's Theme.json (StoryInfo.ThemeResource; see unityTheme.ts, whose UNITY_THEME_FIELDS has
// the same fields). These are C# sources inside template literals: keep backslashes out of them (none
// are needed), and don't use `${`. __TOKENS__ are filled per story by fillTemplate (unityPackage.ts).

