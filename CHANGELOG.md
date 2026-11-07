# What's new in Narrative Bridge

## Unreleased

- **Italics, bold and underlining are kept** from Fountain, Final Draft, Word, Markdown and Twine scripts. They show in
  Playtest, the playable story and the Unity panel (which types them out letter by letter); in Review they're written as
  `<i>…</i>`, `<b>…</b>` and `<u>…</u>`, which you can type too. Recording scripts mark them the Fountain way.
- **Compare a draft with now:** in Story settings, *Compare* lists the passages added, removed or renamed since a draft,
  and every line and choice that changed.
- **Unreal export catches up:** cues (`OnCue`), exits to the game (`OnExit` and `Resume`), the locked choices with what
  they need, the cue sounds, and helpers for showing italics.
- **Unity checks on GitHub:** a workflow that runs the Unity package's tests for every sample, once a Unity licence is
  added as a repository secret (`npm run test:unity -- --export-only` writes the projects it tests).

## 0.4.0 — 2026-11-06

- **Translations back in:** bring a filled-in translation sheet back on the Export page and see how much of each
  language is done. Playtest and the playable story then have a language picker, and the Unity and Unreal exports include
  the translations.
- **Locked choices in the playable story:** greyed out, with what they need, as in Playtest and Unity.
- **Cue warnings:** cues with no sound attached, and cue names that look like a typo of another.
- **Unreal export:** the translation sheet and playthrough routes for the game's own tests.
- **Unity Play Mode tests** in the package, and `npm run test:unity` to check the Unity export in a local Unity.
- **Easier first visit:** try a sample story first, a picture of a finished game, shorter getting-started steps,
  and advice on which conversion mode to pick.
- **What was understood:** after converting, a summary of passages, characters, choices and endings, plus what to check.
- **Saving you can see:** the toolbar says when you last saved a copy to a file, and a gentle reminder appears
  after a while of unsaved work.
- **Clearer labels:** the toolbar and tabs say what they do; book sounds are off until you turn them on.
- **What your developer gets:** the Export page lists what's in the package, what's left for them, and the versions it needs.
- **Install as an app** where the browser supports it, a known-limits note on the Import page, and an About & FAQ page.
- **Projects across browsers:** save a complete project file, or keep projects in your own private GitHub Gists.
- **Live design publishing** for the site owner, without a rebuild.
- **Audio regions and clip edits** (trim, fade, gain) kept in the browser without changing the original recording.
- **Word and PDF originals** are kept with the story.
- **Unity 6.3 and TextMeshPro** support in the Unity package.
- **Exits to gameplay:** a story can hand control to the game and resume afterwards.
- **Cues:** add music, sounds, ambience or a camera shake in Review (+ Cue); the Unity package plays them without code.
- **Cue sounds:** attach a sound file to a cue in Review. Every cue with the same name and value plays it: in Playtest
  (which also marks where each cue fires), in the playable web page, and in the Unity package with nothing to set up.
- **Unity package additions:**
  - **Locked choices:** shown greyed out with what they need.
  - **A Settings menu for players:** text size, typing speed, auto-advance, high contrast, voice volume and language.
  - **Saves:** save slots with an autosave.
  - **Story Debugger:** an editor window.
  - **Playthrough tests:** for the Test Runner, or run headless.
  - **Loading on demand:** voice clips and pictures can load with Addressables.
  - **Translations:** a translation sheet (also from the Export page), with Unity Localization tables built from it.

## 0.3.0 — 2026-11-03

- Unity export as a package that drops into an existing game, with portraits for the speaking character
  and many more settings (each with a reset to its default).
- Voice sessions: link lines to timestamps in one long recording.
- Files added to a story can be downloaded again.
- Tidier graph arrows that avoid overlapping.
- Import from Twine and Ink, real files on disk, keyboard shortcuts.

## 0.2.0

- The book-style edition, dark mode, logging, a user guide and fit-to-screen graph.

## 0.1.0 — 2026-10-26

- First release: screenplays and prose into Ink, a story graph, a playtest and Unity/Unreal export.
