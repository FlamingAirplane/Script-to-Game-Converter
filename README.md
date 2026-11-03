<p align="center"><a href="https://flamingairplane.github.io/Script-to-Game-Converter/"><img src="public/og.png" alt="Narrative Bridge — turn a script into a playable story" width="720"></a></p>

<p align="center"><b><a href="https://flamingairplane.github.io/Script-to-Game-Converter/">Open Narrative Bridge</a></b> · <a href="https://github.com/FlamingAirplane/Script-to-Game-Converter/releases">Download the offline edition</a> · <a href="WRITERS.md">Guide for writers</a></p>

# Narrative Bridge

Turn screenplays and prose into validated [Ink](https://github.com/inkle/ink) stories, then package them for **Unity**
(via [Ink Unity Integration](https://github.com/inkle/ink-unity-integration)) or **Unreal Engine**
(via [Inkpot](https://github.com/The-Chinese-Room/Inkpot)).

One source-processing pipeline → one canonical story model (ISR) → one generated Ink story → engine-specific export adapters.

Everything runs locally. Scripts never leave your machine.

**Try it online:** https://flamingairplane.github.io/Script-to-Game-Converter/ (the page runs entirely in your browser;
nothing is uploaded). After one visit it also works with no connection, and browsers offer to install it as an app
(see [`scripts/offline-site.ts`](scripts/offline-site.ts)); when a new version is deployed, the app offers to reload into it.
The site also offers the offline single-file edition for writers. It is rebuilt and redeployed by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`.

## Quick start

```bash
npm install
npm run dev        # web app at http://localhost:5173
npm test           # unit, golden-file, compiler, runtime and export tests
```

### For writers: a single file, no install

```bash
npm run build:single   # → release/Narrative-Bridge.html
```

This produces one self-contained HTML file (~0.6 MB) with all scripts and styles inlined. Writers double-click it to run the
whole app offline in any modern browser. Nothing is installed and nothing is uploaded. Send it together with
[WRITERS.md](WRITERS.md), or attach it to a GitHub release. The `release/` folder is git-ignored, so rebuild the file for each release.

CLI:

```bash
npm run cli -- convert script.fountain --mode faithful --out story.ink
npm run cli -- validate story.md
npm run cli -- export script.fountain --mode adaptation --approve-all --engine unity --out ./build
npm run cli -- export story.nbproj.json --engine unreal --out ./build --ref <inkpot-tag-or-sha>
npm run cli -- export story.md --engine web --out ./share      # one playable .html page for readers
npm run cli -- export script.fountain --engine twine --out ./share   # Twee 3 / SugarCube for Twine 2
npm run cli -- doctor              # checks Unity/Unreal, git, .NET and C++ toolchain
```

Exit codes: `0` success, `1` validation errors or export blocked, `2` usage error.

Browser end-to-end test of the writer file (opens it from disk in WebKit and Chromium, converts and plays a sample,
exports a Unity zip and a playable story, then plays that story):

```bash
npx playwright-core install webkit chromium   # once
npm run test:e2e
npm run test:overflow   # no chapter scrolls sideways at 360–1920 px (WIDTHS=… to choose)
npm run test:offline    # the website opens, converts, plays and exports offline after one visit
```

## The workflow (web app)

| Tab | What it does |
| --- | --- |
| **Import** | Drop Fountain, Final Draft (`.fdx`), Word (`.docx`), plain text, Markdown or Ink files (or paste), choose a conversion mode, or start from a sample. |
| **Review** | Every passage with its content, provenance (`source` / `transformed` / `generated` / `edited`) and the original source lines side by side. Edit text, choices, conditions, effects, items and variables; approve or reject proposed branches; find & replace, merge duplicate characters, reorder passages. Give characters voices, and record or attach a clip for any line. *Dialogue only* (D) hides everything but spoken lines. **Story settings** shows the story at a glance (words, reading time, choices, endings, spoken minutes and lines per character) and keeps **drafts**. |
| **Graph** | The story as an old map: start, endings, unreachable passages, conditional and proposed routes. Drag passages to arrange them (saved with the project), search, minimap; click a passage to edit it. *Save map* downloads the whole map as SVG or PNG. |
| **Ink** | The deterministic generated Ink, compiled live with the pinned inkjs compiler; compile errors are mapped back to passages. |
| **Playtest** | Play the compiled story, undo choices, toggle inventory to simulate the host game, save/load with story-version checks, hear the dialogue (recorded clips or character voices), and see the automated playthrough report. |
| **Export** | A playable web page, a Twine file, a recording script (.csv) for voice sessions, or a verified Unity / Unreal package (.zip) with manifest, validation report, ISR, source map, voice clips and the original sources. |

**Drafts** are named copies of a story kept in this browser: keep one before a big change and restore it later
(restoring can be undone). A draft is also kept automatically before a story is replaced by a new conversion or an opened
project file, and the Import page lists earlier stories to pick up again. The cover band shows whether the project is
autosaved, and warns if the browser has run out of room.

Press **?** for keyboard shortcuts. Book sounds (page turns, a bell at endings) and the light/dark theme switch
are on the cover band.

The **Diagnostics** panel lists every issue with a stable code, severity, stage, remediation, and whether it blocks export. Click one to jump to it.

## Conversion modes

- **Faithful conversion** — scenes become passages in source order; nothing is invented. Every dialogue line, action, parenthetical, transition and note is preserved (notes and unsupported constructs become Ink comments).
- **Interactive adaptation** — deterministic, local heuristics propose branches grounded in the text (e.g. an optional item pickup and a later item-gated path with a way back). Proposals are marked `generated` and are **not emitted to Ink until approved**.
- **Structured import** — explicit markers drive the structure. They also work in the other modes.

### Structured markers

```text
@passage archive_entry Archive Entrance     start a passage (id + optional title)
@start archive_entry                         choose the start passage
@item archive_key "Archive Key" consumable   declare an inventory item
@var trust = 0                               declare a variable (bool / int / "string")
@give archive_key   @take archive_key        item effects
@set trust = 2      @add trust 1             variable effects
* [Choice text] -> target                    once-only choice
+ {has archive_key} [Open it] -> vault @take archive_key
+ {trust >= 2 and not has lamp} [Trust her] -> ally
- [Markdown link choice](#target)
-> target   /   @end                         divert / ending
## Heading {#custom_id}                      Markdown heading as a passage
```

See [`src/samples.ts`](src/samples.ts) for complete examples.

## Ink conventions

- Items are Booleans: `VAR has_<item> = false`. Conditions compile from an expression tree (never raw strings).
- Dialogue: `NAME: text #speaker:<id>`; parentheticals add `#paren:…`; the first line of a scene carries `#scene:<heading>`; transitions carry `#transition`.
- Choices are sticky (`+`) unless marked once-only (`*`). A passage's divert becomes an invisible fallback choice when the passage also has choices, so players never get stuck.
- Output is deterministic: the same ISR always produces byte-identical Ink.

## Logging

Every stage logs a structured entry (level, scope, message, counts and timings) through `src/core/log.ts`, the same
logger in the page, the background worker and the CLI. Logs never contain story text, only ids, counts, sizes and
durations, so they are safe to attach to bug reports.

- **Web app:** the **Logbook** tab beside Diagnostics (⌘L / Ctrl+L) shows entries live, including the worker's.
  You can filter by level, search, copy, download or clear. Uncaught errors are logged, and a crashed view shows a
  recovery page with a log download instead of a blank screen.
- **CLI:** entries go to stderr (warn and up by default): `--verbose` for everything, `--quiet` for errors only, and
  `--log-file run.jsonl` to save every entry as JSON lines.

## Validation

1. ISR schema validation.
2. Graph analysis: missing destinations, duplicate ids, unreachable passages, dead ends, undeclared items/variables, type mismatches, item gates that can never open, unused declarations, unapproved proposals.
3. Compilation with the pinned inkjs compiler (Ink format v21); errors mapped back via the source map.
4. Runtime smoke test: 120 seeded playthroughs (half random, half novelty-seeking) report endings reached, passage coverage, conditional choices that were never available, and runtime errors. This is state-dependent, unlike the graph checks.
5. Export verification: required files exist, shipped `.ink` is byte-identical to what was validated, JSON parses, paths are safe, and the integration ref is pinned.

Fatal errors block export. The manifest records engine import and in-engine smoke tests as `pending` until you run them; it never marks something as passed that wasn't checked.

## Sharing without a game engine

- **Playable story** (Export → *Share without a game engine*, or `--engine web`): one self-contained HTML page with the
  Ink runtime, the compiled story and a book-style reader. It works offline and on phones, saves each reader's progress in
  their browser, and offers undo and start over. Saves are tied to the story version.
- **Twine** (`--engine twine`): a Twee 3 file for SugarCube 2.37, generated from the story model. Items become
  `$has_<item>` variables set in `StoryInit`, conditions wrap links in `<<if>>`, effects become link setters, once-only
  choices track `$once_<choice>` flags, and the Ink fallback becomes a conditional "Continue" link. Prose is wrapped in
  SugarCube's verbatim markup so script text is never read as code. Stories imported as raw Ink can't be exported to Twine.

## Engine exports

**Unity** (2022.3 LTS+): `Packages/manifest.json` references Ink Unity Integration `2.0.0` as a UPM git dependency. On first open the
editor creates a `NarrativeDemo` scene whose `NarrativeController` uses the `InkFile` the integration imports from
`MainStory.ink`. Press Play. The controller handles text, choices, approved variables, a host-authoritative inventory bridge
(`IInventoryAuthority`) and version-checked save/load. Headless check:
`Unity -batchmode -projectPath <dir> -executeMethod NarrativeBridge.EditorTools.NarrativeBridgeEditor.RunSmokeTestBatch`.

**Unreal** (5.7+): a C++ project with Inkpot enabled, `Scripts/setup_inkpot.sh|ps1` to clone Inkpot at the pinned ref,
`StorySource/MainStory.ink` for Inkpot to import, and a Blueprint-friendly `UNarrativeBridgeComponent`. The component targets
Inkpot's `UInkpot::BeginStory` / `UInkpotStory` API. Check it against your pinned Inkpot release (see the generated README).

## Repository layout

```
src/core/            engine-independent pipeline (no UI or Node dependencies)
  isr.ts             Intermediate Story Representation (schema 1.0)
  parsing/           independent parsers: fountain, plaintext, markdown, ink + shared markers
  builder.ts         parsed documents → ISR (passage boundaries, characters, items, provenance)
  adapt.ts           interactive-adaptation proposals
  analyzer.ts        graph + semantic diagnostics
  inkgen.ts          deterministic Ink generator + source map
  validate.ts        inkjs compile + seeded runtime smoke tests
  export/            IEngineAdapter, Unity and Unreal adapters, manifest, verifier, zip
  pipeline.ts        conversion states and orchestration
src/ui/              React web app
src/cli/             command-line interface
schemas/             JSON Schema for the ISR
tests/               unit, golden-file, compiler, runtime and export tests
```

## Not yet supported

PDF import (export the script as Final Draft, Word, Fountain or text instead); AI-assisted adaptation (would require explicit consent before sending scripts anywhere);
save migration between story versions (incompatible saves are rejected with a clear message instead).
