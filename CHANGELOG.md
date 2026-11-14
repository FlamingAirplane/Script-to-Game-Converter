# What's new in Narrative Bridge

## Unreleased

- **Reading on after a choice.** In Playtest and the playable story, a choice now scrolls to the first line of the
  text it led to (not the end of it), and that text fades in gently (not at all if the reader's system asks for less
  motion). Choices show the number key that takes them; Enter or Space goes on at a *Continue*, an exit or a cutscene.
  The playable story learns the keys too (1–9, Enter, Backspace to undo), keeps keyboard focus on the choices, shows
  the choices again after an undo, and *Continue* reopens at the reader's last choice rather than the top of the page.
- **Fixed:** Undo choice in Playtest could bring back the text from before the choice but the choices from after it.

- **Suggestions as data, and an on-device model on the command line.** Interactive adaptation's rules now return
  *proposals* (a group of choices for one passage, pointing at the line that prompted it) that pass six checks before
  they're written: shape, references, evidence, fit, one group per passage, and the story still completable with
  everything approved. What's set aside shows in Diagnostics as a note (*A suggestion was set aside because it wouldn't
  fit the story*); what passes arrives pending, exactly as before, and now says who suggested it and which line. Two
  cheap rules join the heuristics (a question another character answers becomes a reply; more ways of picking
  something up), and `--suggest model` on the command line adds a small language model that runs on your machine and
  suggests replies, decisions and pickups the rules miss. `--approve-all` leaves a model's suggestions pending unless
  you also pass `--approve-model`. `npm run eval:adapt` scores every suggester against hand-marked scripts
  (`tests/adaptation-eval/`); the model comes to the web app only once it beats the heuristics there.
- **A larger evaluation set for suggestions:** sixteen scene-length excerpts from public-domain plays (Ibsen, Wilde,
  Shaw, Chekhov, Synge, Glaspell, Shakespeare, and Molière in French) join the samples, with their choice moments
  marked; five are held out. `node scripts/play-excerpts.mjs` rebuilds them from Project Gutenberg's texts.

- **Choices you've taken before are greyed out:** coming back to a choice, on a later read or a passage you loop
  back to, players see which ways they've already tried (still clickable, with a ✓). It's remembered through Restart,
  in Playtest, the playable story, and the Unity and Unreal story panels. Playtest's **Forget chosen** clears it.
- **Rename a story from the top bar:** click its title, type, and press Enter (Escape keeps the old one).
- **Structured import is now the default.** The Import page starts on *Structured import* (marked recommended), and the
  command line uses `--mode structured` unless told otherwise. Markers you type into the script (`@passage`, choices like
  `+ [Open the door] -> vault`, `@item`, `@exit`…) build the story as you mark it, and a script without any markers still
  converts scene by scene, exactly as before. Faithful conversion and Interactive adaptation are one click away.
- **A full guide to the markers:** [docs/STRUCTURED_MARKERS.md](docs/STRUCTURED_MARKERS.md) covers every marker with an
  example, how passages end and flow on, conditions, `@cue` (which wasn't documented before), a worked example with the
  exact Ink it becomes, and what each export does with each marker. Diagrams show the path from script to Ink to Unity,
  Unreal and Twine, how passages, choices and exits connect, and how items unlock choices. The README and the user
  guide now lead with the markers.
- **Cutscenes:** tick **🎬 Cutscene** on a passage in Review, or put `@cutscene` in it in a script. Players then see
  only its dialogue, one line at a time and centred like subtitles, with each line moving on by itself once there's
  been time to read it. **Skip** shows the rest at once, and the passage's choices come after. It works in Playtest,
  the playable story, Twine (SugarCube), and the Unity and Unreal story panels.
- **The Unreal export catches up with Unity:** the Unreal project now has a themed **story panel** (the Story UI look
  on the Export page, with typing, portraits, scene pictures, locked choices greyed out, and Settings and save-slot
  menus). It also gets **save slots and an autosave** that carry over to a revised story, **translations** from the
  translation sheet, a **cue player** that plays the sounds you attached, starting at any passage, going on elsewhere
  after an exit (`ResumeAt`), story variables, and a game-owned inventory. Opened in Unreal, the project brings the story
  in by itself; press Play to see it. **Automation tests** replay every ending.
- **Fixed:** the Unreal export didn't build against the real Inkpot plugin (a wrong `SetBool` call). It's now built and
  tested with Unreal Engine 5.7 and Inkpot (`npm run test:unreal:build`).
- **Players see only the dialogue:** a new box in Story settings (and on the Export page). When it's ticked, players
  get only the spoken lines and the choices. Narration, transitions, scene headings and parentheticals are left out of
  Playtest, the playable story, Twine, Unity, Unreal and the translation sheet, and the Ink keeps them as comments.
  Your script itself is unchanged.
- **Forced choices:** tick **forced** on a choice with a condition (or add `@forced` to the choice line in a script),
  and once the condition holds it's the only choice in its passage. For example, a player who has the brass key must
  use it. It works in plain Ink (the other choices get an extra condition), so Playtest, the playable story, Twine,
  Unity and Unreal all follow it. Locked choices aren't shown while a forced choice applies, the Graph marks forced
  routes with **!**, and Diagnostics warns about a forced choice with no condition.
- **Large story maps are easier to follow:**
  - Passages are placed after everything that leads into them, so routes read left to right. On a 58-passage test
    story, crossings went from 77 to 25, and no route runs backwards.
  - Routes that skip columns thread through the gaps between cards. Loops back to an earlier passage are short
    *↩ name* stubs you can click.
  - **◎ Focus** dims everything but the selected passage's routes. **Trace the ways to…** lights every route to an
    ending. **Faint straight-on routes** lets the choices stand out.
  - **Scenes** can be folded into one card each.
- **Outline view** on the Graph tab: the story as an indented, branching list, with branches meeting again at the same
  level and "joins" links to passages already listed.
- **Add scenes from the story map:** **+ New scene** on the Graph (or N, or double-click the map) adds a scene to a
  converted script, straight after a passage, as a new choice in one, or on its own to connect later. A passage's panel
  has **+ Scene after this** and **+ Choice to a new scene**. The same form is in Review (**+ New scene**, and
  **+ A new scene…** as a choice's destination or a passage's Then), Playtest (**+ New scene after it**, and **+ Add a
  scene here** at the end), and Diagnostics: a choice leading to a passage that doesn't exist offers to create it (also
  by clicking *⚠ Missing* on the Graph), and a dead end offers a scene after it.
- **Italics, bold and underlining are kept** from Fountain, Final Draft, Word, Markdown and Twine scripts. They show in
  Playtest, the playable story and the Unity panel (which types them out letter by letter); in Review they're written as
  `<i>…</i>`, `<b>…</b>` and `<u>…</u>`, which you can type too. Recording scripts mark them the Fountain way.
- **Compare a draft with now:** in Story settings, *Compare* lists the passages added, removed or renamed since a draft,
  and every line and choice that changed.
- **Unreal export catches up:** cues (`OnCue`), exits to the game (`OnExit` and `Resume`), the locked choices with what
  they need, the cue sounds, and helpers for showing italics.
- **Unity checks on GitHub:** a workflow that runs the Unity package's tests for every sample, once a Unity licence is
  added as a repository secret (`npm run test:unity -- --export-only` writes the projects it tests). Without one, the
  Unity jobs show as skipped, not passed.
- **Unreal C++ checked on every pull request:** `npm run test:unreal` compiles the generated component against
  stand-in Unreal and Inkpot headers, so mistakes in the generated code fail CI.
- **Fixed: lines starting with VAR, CONST, LIST, EXTERNAL or INCLUDE** stopped the story building and every export.
  They're now shown as written. When the story can't be built, the message says what's wrong in plain words and quotes
  the line.
- **V.O., O.S. and O.C. are kept:** "PORTER (V.O.)" stays in the Ink (with an `#ext:V.O.` tag), Playtest, the playable
  story, Unity, the recording script's Direction column and Twine. Review has a picker for it.
- **Fixed: "THE END" twice.** A script's own THE END at the end of the story is the ending (kept as a note), so readers
  see the ending mark once.
- **Names:** underscores inside words (not_a_knot) are kept in titles; accented titles (Café) keep their letters in
  package and project names; titles in other scripts (東京の夜) get a short code instead of a blank.
- **One naming pattern for downloads:** the-last-train.html, the-last-train-recording-script.csv, the-last-train.twee,
  the-last-train.ink, the-last-train-unity.zip, the-last-train-unreal.zip, the-last-train.nbproj.json.
- **Recording script clips are numbered without gaps** (hall_001, hall_002…); files named from an older script still match.
- **Export:** after building a package, the page goes to the download and says what was built. "Package verified" is now
  "files checked", next to "not yet opened in Unity/Unreal", with what was and wasn't checked. The Unreal description no
  longer claims variables and saves.
- **Interactive adaptation says when it found nothing to suggest**, and what makes it suggest a choice.
- **Privacy wording** now says that a project leaves the browser only if you choose cloud sync, and that the app asks
  GitHub about new versions and the site's look (with none of your writing). A live design can no longer load files
  from other sites.
- **For contributors:** CONTRIBUTING.md, SECURITY.md, issue forms and weekly Dependabot updates.

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
