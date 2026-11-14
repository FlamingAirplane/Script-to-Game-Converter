# Baseline: the heuristics on the evaluation set

Produced by `npm run eval:adapt` on 13 November 2026, at the start of the model-assisted adaptation work
(commit after 4ea90d7, version 0.4.0). Re-run it and replace this table whenever a suggester or the set changes.

6 scripts, 1,414 words, 7 marked moments. None held out yet: the set is still the built-in samples and the test
fixtures (two of them negative controls). The plan's targets assume 20 to 30 scripts, five of them held out.

| Suggester         | Scripts | Raw | Valid | Valid % | Accepted | Accept % | Moments | Recall | Per script | Completable | Time |
| ----------------- | ------: | --: | ----: | ------: | -------: | -------: | ------: | -----: | ---------: | ----------: | ---: |
| heuristic         |       6 |   3 |     3 |    100% |        2 |      67% |       7 |    29% |        0.3 |         6/6 | 0.0s |
| heuristic + rules |       6 |   4 |     4 |    100% |        3 |      75% |       7 |    43% |        0.5 |         6/6 | 0.0s |

By kind (valid → accepted):

| Suggester         | pickup | gate | reply | decision |
| ----------------- | -----: | ---: | ----: | -------: |
| heuristic         |    2→1 |  1→1 |   0→0 |      0→0 |
| heuristic + rules |    2→1 |  1→1 |   1→1 |      0→0 |

What the numbers say:

- The heuristics find the Lighthouse pickup and gate, and nothing else. Their one miss in accuracy is
  "lifts a lantern & squints" in the Final Draft fixture, taken as a pickup.
- The question rule finds the reply in the PDF fixture. It cannot find "Who's there?" at the end of Lighthouse
  scene 4 (no answer follows in the scene), nor the reply in the Final Draft fixture, whose passage the lantern
  pickup claims first.
- No rule finds the two moments in *Room Six* (a decision at the ringing phone, a reply to the clerk). Those are
  the kind of moment the model is for.

A model has to beat the second row: at least a 90% valid rate, an accept rate of 60% or more and not below 75%,
and at least double the coverage (1.0 or more accepted suggestions per script), with every story still completable.

## Phase 2: SmolLM2 360M Instruct (does not pass)

Produced by `npm run eval:adapt -- --suggest model` on 13 November 2026 with `HuggingFaceTB/SmolLM2-360M-Instruct`
(`q4`, Node, CPU), after the prompt gained worked examples and the schema began to require each kind's fields and to
limit line numbers and gate items to those shown.

| Suggester                    | Raw | Valid | Valid % | Accepted | Accept % | Recall | Per script | Completable |  Time |
| ---------------------------- | --: | ----: | ------: | -------: | -------: | -----: | ---------: | ----------: | ----: |
| heuristic                    |   3 |     3 |    100% |        2 |      67% |    29% |        0.3 |         6/6 |  0.0s |
| heuristic + rules            |   4 |     4 |    100% |        3 |      75% |    43% |        0.5 |         6/6 |  0.0s |
| SmolLM2 360M alone           |  10 |     8 |     80% |        0 |       0% |     0% |        0.0 |         6/6 | 60.3s |
| heuristic + SmolLM2 360M     |  11 |     8 |     73% |        2 |      25% |    29% |        0.3 |         6/6 | 54.0s |

Against the targets: valid rate 80% (target 90%), accept rate 0% (target 60% and not below the heuristics), coverage
0.0 per script (target at least double the heuristics). It adds nothing the heuristics do not already find.

What it did:

- It called almost every scene a **decision** (7 of 8 valid proposals), usually on the wrong line, and never found a
  reply. It missed the brass key pickup that a regex finds.
- It suggested choices in both negative controls, including "Take the silver locket" in the prose fixture: the locket
  is from the prompt's own worked example, not the script.
- One group had the same label twice ("Call him / Call him"); check 1 dropped it. Every story stayed completable, so
  the checks held.
- About 4 to 6 seconds per scene on CPU: a 10,000-word script of some 60 scenes would take roughly 5 minutes, over
  the 2-minute target.
- Before the schema required each kind's fields, the constrained reply was always `{"line": 1, "kind": "pickup"}` with
  no item; unconstrained, the model copied the reply template. The structured-output processor also threw once
  mid-generation ("Token 0 does not satisfy the constraint"); the suggester now falls back to free text for that call.

## Phase 2: all four candidates (none passes)

The other three candidates, measured the same way on the same day (`q4`, Node, CPU, model downloaded from
`onnx-community`). "Alone" is the model with no heuristics; "with heuristics" runs it after them, as `--suggest all`.

| Suggester                     | Raw | Valid | Valid % | Accepted | Accept % | Recall | Per script | Completable |   Time |
| ----------------------------- | --: | ----: | ------: | -------: | -------: | -----: | ---------: | ----------: | -----: |
| heuristic                     |   3 |     3 |    100% |        2 |      67% |    29% |        0.3 |         6/6 |   0.0s |
| heuristic + rules             |   4 |     4 |    100% |        3 |      75% |    43% |        0.5 |         6/6 |   0.0s |
| SmolLM2 360M alone            |  10 |     8 |     80% |        0 |       0% |     0% |        0.0 |         6/6 |  60.3s |
| SmolLM2 360M with heuristics  |  11 |     8 |     73% |        2 |      25% |    29% |        0.3 |         6/6 |  54.0s |
| Qwen3 0.6B alone              |   9 |     8 |     89% |        2 |      25% |    29% |        0.3 |         6/6 | 343.0s |
| Qwen3 0.6B with heuristics    |  10 |     7 |     70% |        3 |      43% |    43% |        0.5 |         6/6 | 329.6s |
| LFM2.5 350M alone             |  11 |    11 |    100% |        3 |      27% |    43% |        0.5 |         6/6 |  71.0s |
| LFM2.5 350M with heuristics   |  11 |    10 |     91% |        5 |      50% |    71% |        0.8 |         6/6 |  34.1s |
| Gemma 3 1B alone              |  11 |    11 |    100% |        0 |       0% |     0% |        0.0 |         6/6 | 520.3s |
| Gemma 3 1B with heuristics    |  11 |    11 |    100% |        2 |      18% |    29% |        0.3 |         6/6 | 272.7s |

Targets: valid 90% or more; accept 60% or more and not below the heuristics (75% with the rules); coverage at least
double the heuristics (1.0 per script against 0.5); under 2 minutes for a 10,000-word script (this set is 1,414 words).

- **LFM2.5 350M** comes closest and is the only one that adds to the heuristics: with them it finds 5 of the 7 moments
  (the rules find 3), at a 91% valid rate. It still misses on accept rate (50%) and coverage (0.8), and it suggests a
  choice in nearly every scene, both negative controls included. Its labels are poor even where the moment is right:
  "Mira / Tomás", "Wave / Metal", and "Call for room six / Leave it sealed", whose second half is copied from the
  prompt's worked example. It would not meet the 80% label-quality target.
- **Qwen3 0.6B** found the brass key and one reply, but invented objects ("Take the mistletoe", "Take the fade", from
  FADE IN) and took almost six minutes for 1,414 words.
- **Gemma 3 1B** wrote the most sensible labels ("Take the phone / Ignore it", "Investigate the noise / Stay away") and
  every proposal passed the checks, but it called everything a decision on line 1, so nothing matched a marked moment,
  and it was the slowest at nearly nine minutes. Its result says as much about the scoring as the model: a decision
  cited two lines from the marked one does not count.
- **Every model over-suggests.** None answered "no moment" for the prose fixture or the already-structured sample.
- **Completable 6/6 throughout**: the six checks did their job whatever the model said.

By the plan's Phase 2 gate, no candidate proceeds to Phase 3. The plan's choice is to stop with Phases 0 and 1 kept
(the cheap rules already lift recall from 29% to 43% for free), or to go to Phase 4 and fine-tune. Before either, the
set needs to grow: seven moments in six scripts is too few to separate a 50% accept rate from a 60% one.
