# Acting on the November 2026 review

The review *Script to Game Converter: How It Works and How to Improve It* (14 November 2026) listed quick wins,
medium projects and bigger bets. This page tracks what has been done, so work can carry on from where it stopped.
Tick items off here in the same pull request that does them.

## Quick wins

- [x] Upload box at the top of the first page, beside "try a sample" (#61)
- [x] Story text first in Review; settings fold into *Passage settings* (#61)
- [x] Ribbon no longer covers a line's buttons (#61)
- [x] About page agrees that Structured is recommended (#61)
- [x] Slimmer top bar: Undo, Redo, Save, and a Menu (#61)
- [x] Words instead of code for conditions and effects; "from your script" badge (#61)
- [x] One-line promise used everywhere (#61)
- [x] Version 0.5.0 in package.json and the footer (#61). **Not done:** tagging the 0.5.0 release on GitHub, which
      the owner should do (it publishes the offline download).
- [ ] Tidy the owner's local folder (scratch `.mts` files, old worktrees, stale `release/` file): only the owner can
      do this, on their computer.
- [x] Unity: TextMeshPro essentials imported on first open; no more "Needs no X" (#61)
- [x] Unreal: the story panel keeps the newest line in view (#61)
- [x] The tested Unreal version (5.7) and the 5.9 Inkpot fix are named (#61). **Not done:** reporting the fix to
      Inkpot upstream.

## Medium projects

- [x] Point-and-click branching: ⑂ turns a line into a choice (#62)
- [x] Live preview and insert buttons for markers on the Import page (#62)
- [x] Decisions and more replies in Interactive adaptation (#66): the app finds 12 of 36 marked moments (was 4),
      44% of its suggestions right. **Still open:** nothing improved on the five held-out scripts (1 of 15), and the
      question rule is too noisy to turn on; see `tests/adaptation-eval/BASELINE.md`.
- [x] Prose: quoted speech and speech tags, section and chapter breaks (#61)
- [x] Lighter first load: 262 KB → 127 KB compressed (#62)
- [ ] Make the code easier to change:
  - [x] A linter (oxlint) in CI, with a clean run (`npm run lint`) (#67)
  - [ ] A formatter (Prettier is installed and `npm run format:check` exists, but the code hasn't been reformatted:
        do it in one PR when no other PR is open, since it touches most files)
  - [x] Split `tests/pipeline.test.ts` (about 160 KB) by area (#65)
  - [x] Keep the C# and C++ in real template files that tools can check (#64): `unity.ts` went from 3,700 lines to
        600
  - [x] Split the largest UI files: `ReviewView.tsx` (#68, 1,370 → 570 lines), `App.tsx` (hooks, 1,060 → 740),
        `PlaytestView.tsx` (809 → 540: toolbar, transcript, choices, inspector, smoke report and a pure `state.ts` in
        `src/ui/playtest/`), `GraphView.tsx` (807 → 490: pointer gestures, routes, cards, minimap and toolbar in
        `src/ui/graph/`) and `ExportView.tsx` (704 → 390: the share cards, package contents, reader-notes and
        translations panels in `src/ui/export/`). Nothing over 750 lines is left in `src/ui`
- [x] Easier moving between devices: a small story as a link (#62)
- [ ] Prove the engine packages automatically: add a Unity licence secret so `.github/workflows/unity.yml` runs
      (owner only); a short clip of a story running in each engine
- [x] Feedback button (#62). **Not done:** watching five writers use it (owner).
- [x] Help search engines: both names in the title, description and structured data, a canonical link (#69); the
      sitemap (#61). **Owner only:** the repository description and topics, and submitting the sitemap to Google
      Search Console.

## Bigger bets

- [ ] Optional AI suggestions with consent (an on-device model is on the command line already; see
      `src/suggest/`)
- [x] A complete mini-game web export (#71): the playable story has pictures, sound, saved progress, an "Endings
      found" tally and a text size setting, and downloads as a .zip ready for itch.io or any web host.
- [x] More engines: Ren'Py (#62). **Still open:** Godot. It needs a Godot install to test against (there was none on
      the development machine); `src/core/export/renpy.ts` is the model to follow.
- [ ] Reading scanned PDFs (OCR in the browser)
- [x] Sharing for feedback (#70): a play link opens just the story with a Note button; readers download their notes,
      and the writer brings them into Review beside the lines they are about.
- [ ] A desktop edition
- [ ] Translate the tool's own screens

## Housekeeping done along the way

- The browser checks had been failing since the top bar Menu and folded Passage settings arrived (#61); fixed in #62,
  and the e2e scripts now also run on Windows.
- Dependabot's React 19 and Vite 8 upgrades (#44, #45) were blocked; they're done together in #63.
- #52 (Enter Dialogue Trigger) was brought up to date with main and merged.

## The structure review (20 November 2026)

The second review, *Pen to Ink: How It Works and Where Its Structure Is Weak*, lists ten structural flaws and an order
for fixing them.

- [x] "This week" fixes (#85): lighter saving, a media sweep, clean line labels, accurate Unreal requirements
- [x] Whole-story Ink round-trip test over every sample (flaw 5)
- [x] Cross-reader conformance fixtures (flaw 1): five fixtures in `tests/fixtures/conformance` hold Playtest
      (`tests/conformance.test.ts`), the playable page (`npm run test:conformance:playable`) and Unreal
      (`NarrativeBridge.Conformance`) to the same transcripts. **Still open:** Unity's runner; fixtures for
      translations, saves, chosen-before and locked choices.
- [x] One typed TypeScript reader shared by Playtest and the playable page (flaws 1 and 9): the reader's own rules
      (exit and Continue detection, cue kinds and cues, "chosen before" keys, cutscene timing, ending keys, splitting a spoken line) live in
      `src/core/readerCore.ts`; the exports import it and the page has it compiled in (`npm run reader-core`).
      **Not done:** the page's rendering and choice handling is still its own code; Unity and Unreal keep their
      own copies, checked by the fixtures.
- [x] Stable ids for lines and choices, web side (flaw 2): lines get `id` in the model (`src/core/ids.ts`), every
      line carries `#id:…` in the Ink and every choice `[text #id:…]`; the importer reads them back; Playtest and the
      playable page remember chosen choices and replay saves by id, falling back to the words; a reworded line or choice
      keeps its translation (`carryTranslations`). Unreal ignores `#id` (not a cue) but still matches by text. The Unity controller now matches too: a save's choice
      path records each choice's id and text, so a revised story with reworded choices still replays it; a choice
      taken before is remembered by id (older marks are upgraded the first time they show); saves and marks from before
      ids keep working. The Unity smoke test checks all three cases.
      **Not done:** the Unreal reader matching by id (no Unreal Engine here, and Inkpot's choice-tag API is unchecked), the translation sheet keyed by id, reader notes and recording
      matching by id, and showing ids to writers.
- [x] Story info comes from the Ink pass (flaw 4): `generateInk` returns `info` (locked choices, passages with titles
      and acts, acts, line entries, item and story variables, exits, cues) from the same loop that writes the Ink; the
      playable page, Playtest, the Unity `StoryInfo.cs` and the Unreal `StoryInfo.json` read it instead of working it
      out from the model again (and no longer read the Ink back with a regular expression to find its passages), and
      the page matches offered choices to it by id. Tests check it describes exactly what the Ink has. Kept Ink reports
      no line entries, since none were added to it. **Not done:** portraits and cue sounds (attached files, not Ink)
      still come from the model, and Twine and Ren'Py are still built from the model, not from the Ink output.
- [x] Display names vs compatibility names for "Narrative Bridge" (flaw 6): everything people read (Unity and Unreal
      menus, Blueprint categories, plugin descriptions, exported READMEs and comments, the Gist description) now says
      Pen to Ink; the names code depends on (`NarrativeBridge` namespace, module and folders, `com.narrativebridge.*`,
      `narrative-bridge.*` keys, `.nbproj.json`) stay, and the README says which and why. Old Gists are still listed.
      `tests/names.test.ts` fails if an export shows the old name with a space. **Not done:** a real Unreal build (only
      strings changed; the stand-in compile and the Unity run pass).
- [x] `presentation.unity` is now `presentation.panel` (flaw 8, first part): the editor writes the new key and drops the
      old one, and everything reads either (`panelThemeOf`), so older projects and files still open. A test keeps the
      panel words in the Unity panel, the Unreal panel and the translation sheet's list from drifting apart.
- [x] `App.tsx` split into hooks (flaw 9, part): undo and redo (`editHistory.ts`), autosave (`useAutosave.ts`) and
      keyboard shortcuts (`useShortcuts.ts`) are their own files, with their pure parts tested (`tests/app-hooks.test.ts`),
      and `App.tsx` is about 140 lines shorter. It also fixes undo and redo in development, where React ran each state
      update twice and left a stray redo step. Opening and saving are `useProjectFiles.ts` too: the project file (open from disk,
      the cloud or a story link; Save and Save as), the "only in this browser" reminder and files the system opens with
      the installed app. `App.tsx` is now about 740 lines (it was 1,060). **Not done:** drafts (`restoreDraft`) and
      converting a script are still in `App.tsx`; `GraphView.tsx` and `PlaytestView.tsx` are still large.
- [x] Faithful merged into structured (flaw 8, second part): the two converted exactly alike (tested), so there are now
      two modes, Structured import and Interactive adaptation. `conversionMode()` reads the retired "faithful" as
      structured, so older project files, drafts, autosaves and `--mode faithful` still work.
- [x] Real Unreal build on 5.7 (flaw 7): it found two compile errors in the plugin (an include-order rule in
      `InkCompat.cpp` and a shadowed `Line` in the Enter Dialogue Trigger), now fixed; the archive sample builds and all
      10 automation tests pass (`npm run test:unreal:build -- --test`). Tried 5.9: the only compile error is in Inkpot's own `NativeFunctionCall.cpp` (line 133, a `%d` log format), as the export's README already says, so it is not ours to fix here. 5.6 not tried.
- [x] Twine and Ren'Py share the Ink's flow rules (flaw 4, the last part): which choices a passage offers, the extra
      conditions a forced choice gives the others, where the story goes when none can be taken, and whether that
      fallback can ever be reached are decided once in `src/core/flow.ts` (`passageFlow`); `inkgen.ts`, `twine.ts` and
      `renpy.ts` only write the answer in their own language. The output is byte-identical to before for the samples and
      for forced-choice, fallback, Continue-break and exit stories, and `tests/flow.test.ts` checks, for every sample, that
      the Ink, the SugarCube file and the Ren'Py script end each passage the way the flow says. **Not done, on purpose:**
      translating the *Ink* into Twine and Ren'Py. They need the story's structure (speakers, scene headings, once-only
      flags, cutscene timing, Twine's passage names and positions), which the Ink flattens or drops, so they still render
      from the model; the shared flow and the test keep them from drifting.
- [x] Unity: loading a save no longer shows an empty extra choice (found by the Lighthouse Keeper smoke test, which
      failed on main): ink's saved state leaves out which choice is the invisible fallback, so the controller puts the flag
      back after every load (`LoadInkState`). **Not checked:** the Unreal plugin's Inkpot port may do the same; there is no
      Unreal Engine here to try it.
- [x] Small quirks (flaw 10): emphasis tags are out of line labels (earlier); Fountain and plain-text scripts already
      parse transitions alike (checked: both give the same passages for `FADE IN:`, `CUT TO:`, `FADE OUT.` and
      `THE END`); and Review now says why a passage goes where it does when the conversion decided it
      (`Passage.flowDefault`: scripts flow on to the next passage, Ink and Twine end a passage that says nowhere to go),
      until the writer sets "Then". Browser-only storage is a privacy strength and stays as it is.
