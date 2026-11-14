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

The other candidates (Qwen3 0.6B, LFM2.5 350M, Gemma 3 1B) have not been measured.
