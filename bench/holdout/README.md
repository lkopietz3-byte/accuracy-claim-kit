# Holdout: 103 public accuracy claims from a family the FDA corpus does not cover

The FDA corpus (`../fda/`) has one source family and an oracle written from the README. This holdout tests the kit on claims from other places, with verdicts decided by hand from the README's rules and written down before the kit was run on them.

## What is in here

| File | What |
| --- | --- |
| `claims.jsonl` | 103 claims: the printed figure, the counts, the metric, and the declarations read from each source (who labeled, how items were picked, whether the sentence names the set), with the source URL. |
| `labels.jsonl` | The verdict and reason codes each claim should get under the README rules, written before the kit ran. |
| `hand_labels.py` | Applies the README rules to `claims.jsonl` to write `labels.jsonl` (`--check` confirms the file is current). The kit is not imported. |
| `run.mjs` | Runs the kit on every claim and reports agreement with `labels.jsonl` (`node bench/holdout/run.mjs`). |
| `results.jsonl` | The kit's verdicts next to the labels (written by `run.mjs --write`). |

## The claims

- 59 `llm-exam-paper` claims: accuracy of a language model on exam or case questions, from 16 open-access papers. Each is a score over a fixed, named set, so it is declared `complete` and checked against the exact count.
- 33 `ml-paper` claims: classifier results from 14 open-access papers, declared as a held-out test split (checked against the exact count), a random sample (judged with the interval), or a convenience sample.
- 11 `vendor-benchmark` claims from one AI-text-detector benchmark page that prints error counts. 8 have counts; 3 print an error count without a denominator.

Every claim has counts printed in its source, except the 3 vendor claims noted above, which test the refusal when counts are missing. `../SOURCES.json` lists each paper, its license and how it was found.

## How the labels were made

1. Each source was read for what it says about the labels (an answer key, expert review, software, nothing) and about how items were picked (a whole fixed set, a random sample, whatever was handy, not stated). Where a source says nothing, the declaration is `unknown`, as the README tells claimants to do.
2. The README's rules were applied in its order: counts present, label source, sampling, minimum sample size, then the figure against the exact count (fixed sets) or against the interval and the observed-rate allowance (samples).
3. `labels.jsonl` was committed before the kit was run on `claims.jsonl`.

## Result

The kit's verdict equals the hand label on 103 of 103 claims (llm-exam-paper 59 of 59, ml-paper 33 of 33, vendor-benchmark 11 of 11), and the reason codes match on all 103. There are no disagreements to list.

| Hand label | Kit | Claims | What they are |
| --- | --- | --- | --- |
| supported | supported | 73 | 71 figures that match their exact counts (`census-matches-count`), 2 sample estimates that equal the observed rate (`matches-observed-rate`) |
| refused | refused | 24 | 14 `unknown-label-source` (the paper does not say who labeled), 5 `convenience-sample`, 3 `n-undisclosed` (the vendor page prints errors without a denominator), 1 `sample-too-small` (6 of 15), 1 `no-human-labels` (GPT-3 as the checker) |
| contradicted | contradicted | 4 | 36.7% for 64 of 175 (the count gives 36.6%), 79.80% for 328 of 411 (79.81%), 56.29% for 219 of 389 (56.30%), and a vendor sentence, "only 1 in 1000", for 1 error in 1,992 texts |
| overstated | overstated | 2 | 70% for 70 of 99 (70.7%) and 95.23% for 3,000 of 3,150 (95.24%), each printed lower than its own count gives, so not the observed rate to its printed precision, and above the interval's lower end |

The 6 contradicted or overstated rows are the informative ones: four of the five printed percentages were truncated instead of rounded (79.80, 56.29, 70 and 95.23), one is mistyped (36.7), and the sixth is a vendor sentence that does not match its own count. The kit gives each a stated reason, and its suggested statement quotes the rate the counts support.

## What this does and does not show

- Agreement is high partly because the kit and the labels apply the same README. The labels are independent of the kit's code, but not of its rules. Where the rules are wrong (for example, whether an exam question set a team assembled is a "complete set"), both are wrong together.
- The declarations are my reading of each source. A different reader could declare a claim differently, and the verdict would change with it. The kit cannot check them.
- Most claims are honest reports of what was measured, so most labels are `supported` or a refusal.
- Claims were picked for having printed counts, which most accuracy claims do not have. Of the six vendor, blog and model-card pages opened for counts, one printed any. This is not a sample of all accuracy claims and says nothing about how common overstated claims are.
- 71 of 103 are scores over a fixed set, where the kit compares the figure with the exact count and an interval plays no part. Only 6 claims (2 judged `supported`, 2 `overstated`, 1 `sample-too-small`, 1 `no-human-labels`) went through the interval path.
