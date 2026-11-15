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
  - [x] A linter (oxlint) in CI, with a clean run (`npm run lint`)
  - [ ] A formatter (Prettier is installed and `npm run format:check` exists, but the code hasn't been reformatted:
        do it in one PR when no other PR is open, since it touches most files)
  - [x] Split `tests/pipeline.test.ts` (about 160 KB) by area (#65)
  - [x] Keep the C# and C++ in real template files that tools can check (#64): `unity.ts` went from 3,700 lines to
        600
  - [ ] Split the largest UI files (`ReviewView.tsx`, `App.tsx`, `GraphView.tsx`)
- [x] Easier moving between devices: a small story as a link (#62)
- [ ] Prove the engine packages automatically: add a Unity licence secret so `.github/workflows/unity.yml` runs
      (owner only); a short clip of a story running in each engine
- [x] Feedback button (#62). **Not done:** watching five writers use it (owner).
- [ ] Help search engines: one name, a fuller About page, repository description and topics. The sitemap is done
      (#61).

## Bigger bets

- [ ] Optional AI suggestions with consent (an on-device model is on the command line already; see
      `src/suggest/`)
- [ ] A complete mini-game web export (pictures, sound and saved progress are partly there in the playable story)
- [x] More engines: Ren'Py (#62). **Still open:** Godot. It needs a Godot install to test against (there was none on
      the development machine); `src/core/export/renpy.ts` is the model to follow.
- [ ] Reading scanned PDFs (OCR in the browser)
- [ ] Sharing for feedback: a read-only link where an editor can play and comment
- [ ] A desktop edition
- [ ] Translate the tool's own screens

## Housekeeping done along the way

- The browser checks had been failing since the top bar Menu and folded Passage settings arrived (#61); fixed in #62,
  and the e2e scripts now also run on Windows.
- Dependabot's React 19 and Vite 8 upgrades (#44, #45) were blocked; they're done together in #63.
- #52 (Enter Dialogue Trigger) was brought up to date with main and merged.
