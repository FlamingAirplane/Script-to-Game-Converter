# Narrative Bridge

Turn screenplays and prose into validated [Ink](https://github.com/inkle/ink) stories, then package them for **Unity**
(via [Ink Unity Integration](https://github.com/inkle/ink-unity-integration)) or **Unreal Engine**
(via [Inkpot](https://github.com/The-Chinese-Room/Inkpot)).

One source-processing pipeline → one canonical story model (ISR) → one generated Ink story → engine-specific export adapters.

Everything runs locally. Scripts never leave your machine.

## Quick start

```bash
npm install
npm run dev        # web app at http://localhost:5173
npm test           # unit, golden-file, compiler, runtime and export tests
```

### For writers: a single file, no install

```bash
npm run build:single   # → release/Narrative Bridge.html
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
npm run cli -- doctor              # checks Unity/Unreal, git, .NET and C++ toolchain
```

Exit codes: `0` success, `1` validation errors or export blocked, `2` usage error.

## The workflow (web app)

| Tab | What it does |
| --- | --- |
| **Import** | Drop `.fountain`, `.txt`, `.md` or `.ink` files (or paste), choose a conversion mode, or start from a sample. |
| **Review** | Every passage with its content, provenance (`source` / `transformed` / `generated` / `edited`) and the original source lines side by side. Edit text, choices, conditions, effects, items and variables. Approve or reject proposed branches. |
| **Graph** | The story as a directed graph: start, endings, unreachable passages, conditional and proposed edges. Click a node to edit it. |
| **Ink** | The deterministic generated Ink, compiled live with the pinned inkjs compiler; compile errors are mapped back to passages. |
| **Playtest** | Play the compiled story, undo choices, toggle inventory to simulate the host game, save/load with story-version checks, and see the automated playthrough report. |
| **Export** | Build a verified Unity or Unreal package (.zip) with a manifest, validation report, ISR, source map and the original sources. |

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

## Validation

1. ISR schema validation.
2. Graph analysis: missing destinations, duplicate ids, unreachable passages, dead ends, undeclared items/variables, type mismatches, item gates that can never open, unused declarations, unapproved proposals.
3. Compilation with the pinned inkjs compiler (Ink format v21); errors mapped back via the source map.
4. Runtime smoke test: 120 seeded playthroughs (half random, half novelty-seeking) report endings reached, passage coverage, conditional choices that were never available, and runtime errors. This is state-dependent, unlike the graph checks.
5. Export verification: required files exist, shipped `.ink` is byte-identical to what was validated, JSON parses, paths are safe, and the integration ref is pinned.

Fatal errors block export. The manifest records engine import and in-engine smoke tests as `pending` until you run them; it never marks something as passed that wasn't checked.

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

DOCX, FDX and PDF import; AI-assisted adaptation (would require explicit consent before sending scripts anywhere);
save migration between story versions (incompatible saves are rejected with a clear message instead).
