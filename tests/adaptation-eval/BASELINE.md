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
