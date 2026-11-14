# Adaptation evaluation set

Hand-marked *choice moments* in linear scripts, used by `npm run eval:adapt` (`scripts/adapt-eval.ts`) to score any
suggester (the heuristics in `src/core/adapt.ts`, the cheap rules in `src/core/rules.ts`, an on-device model in
`src/suggest/`) the same way. A model ships only if it beats the heuristics here; see `BASELINE.md` for the numbers
and `CONTRIBUTING.md` for when to run it.

## One file per script

```json
{
  "script": "src/samples.ts#lighthouse",
  "heldOut": false,
  "notes": "anything the next annotator should know",
  "moments": [
    { "passage": "scene_02", "line": 1, "kind": "pickup", "note": "brass key" },
    { "passage": "scene_04", "line": 1, "kind": "gate", "note": "the iron door needs the key" },
    { "passage": "scene_04", "line": 2, "kind": "reply", "note": "Who's there?" }
  ]
}
```

- `script`: a built-in sample (`src/samples.ts#<id>`) or a file path from the repository root. Anything the app
  imports works (Fountain, plain text, Markdown, Final Draft, Word, PDF).
- `passage`: the passage's id **or** its scene id (`sourceId`, `scene_01`…) after conversion. `npm run eval:adapt -- --dump`
  prints every script's passages with numbered lines, which is the easiest way to write a file.
- `line`: the line that prompts the moment, counted from 1 over the passage's action and dialogue lines as the dump
  prints them (the same numbering the model prompt uses). For a **gate**, that is the line where the item is
  *used*; the choices themselves go in the passage before it.
- `kind`: `pickup`, `gate`, `reply` or `decision` (see `ProposalKind` in `src/core/proposals.ts`).
- `heldOut`: true for scripts never looked at while prompts are tuned. They are left out unless the script is run
  with `--held-out`, which is for a final measurement only. Once the set reaches 20 scripts, five should be held out.

A script with an empty `moments` list is a negative control: it checks that a suggester does not invent choices.

## Scoring

A proposal counts as **accepted** when its passage and kind match a marked moment and its line is within one line
of it. Label wording cannot be matched automatically: a person rates a sample of labels by hand (the **label
quality** measure in the plan). The report has one row per suggester set, with the raw count, how many passed the
six checks in `applyProposals` (valid), how many of those matched a moment (accepted), how many marked moments were
found (recall), suggestions per script (coverage) and the time taken.

## Growing the set

The plan calls for 20 to 30 linear scripts the project may redistribute: the built-in samples, the test fixtures,
and public-domain plays and screenplays, including at least one not in English. Add the script under
`tests/fixtures/` (or point `script` at it), write its file here, and re-run `npm run eval:adapt` to refresh
`BASELINE.md`.
