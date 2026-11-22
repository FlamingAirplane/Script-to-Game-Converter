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
  - [ ] Split the largest UI files: `ReviewView.tsx` is done (#68, 1,370 → 570 lines); `App.tsx` and
        `GraphView.tsx` are left
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
- [ ] One typed TypeScript reader shared by Playtest and the playable page (flaws 1 and 9)
- [ ] Stable ids for lines and choices (flaw 2)
- [ ] Ink as the single source for locks and story info (flaw 4)
- [ ] Display names vs compatibility names for "Narrative Bridge" (flaw 6)
- [ ] Rename `presentation.unity`; merge or redefine faithful/structured (flaw 8)
- [x] Real Unreal build on 5.7 (flaw 7): it found two compile errors in the plugin (an include-order rule in
      `InkCompat.cpp` and a shadowed `Line` in the Enter Dialogue Trigger), now fixed; the archive sample builds and all
      10 automation tests pass (`npm run test:unreal:build -- --test`). Tried 5.9: the only compile error is in Inkpot's own `NativeFunctionCall.cpp` (line 133, a `%d` log format), as the export's README already says, so it is not ours to fix here. 5.6 not tried.
