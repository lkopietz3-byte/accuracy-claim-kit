# Changelog

## Unreleased

## [0.1.0] - unreleased

First version. The package is private and unlicensed and has not been published, so there is no earlier release to migrate from.

### Breaking changes
- None against a published version. If you used an earlier local checkout, these behaviors changed during development:
  - An undisclosed sample used to throw; it is now `refused` with `n-undisclosed`. Migration: handle the refused result, or supply `sample`. Half-given counts still throw.
  - A point claim equal to the observed rate used to be `overstated`; it is now `supported` (`matches-observed-rate`). Migration: pass `options.conservative: true` to keep the old rule.
  - Excess printed precision (`precision-too-fine`) used to make a claim `overstated`; it is now informational. Migration: pass `options.strictPrecision: true` to keep the old effect.
  - `sampling: 'stratified'` without `strata` used to pass as a simple random sample; it is now `refused`. Migration: supply `strata`, or use `random`.
  - Unknown metric names throw `RangeError`; names such as `f1` or `wer` are `refused` with `metric-not-supported`. Migration: catch the error or use a supported metric.
  - A `display` that is not a plain percent (bounds, ranges, `1 in N`) is parsed by form instead of being read as a point. Migration: pass `display` exactly as printed; unreadable text throws `RangeError`.
  - Suggested statements use one precision for the headline bound and the quoted interval. Migration: update any text that compares statements exactly.
  - The suggested statement for an interval now starts with its scope (`On this sample, at least 98.87% accurate (...)`, or `On this sample of <population.evaluated>, ...`) and says the interval covers sampling error only; a cross-validation estimate adds that it is optimistic. It used to start `At least 98.87% accurate (...)`, which read as a property of the system once pasted elsewhere. Migration: update any text or pattern that matches the statement's opening words.
  - `1 in N` reads N as exact (plus or minus one half). Trailing zeros used to be placeholders, so `1 in 100` covered 1 in 50 to 1 in 150 and passed for a true 1.5% error rate. Write `about 1 in 100` (also `around`, `roughly`, `approximately`, `~`, `≈`) for the old band. The explanation names the band that was applied. Migration: add `about` where the band was meant. The `1 in N` grid in `test/fixtures/vectors.json` was regenerated from `generate_vectors.py` for the new rule (two old rows changed, and 600 `about 1 in N` rows were added from a separate seed).
  - A control character (the horizontal tab excepted), a line or paragraph separator, or a bidirectional embedding, override or isolate character in `benchmark.name`, `population.claimed`, `population.evaluated`, `claim.text` or a stratum name throws `RangeError`. These strings are echoed into explanations and statements meant to be pasted, and a newline or override could make the text a reader sees differ from the text that was judged. Migration: remove the character.
  - An unknown key in the input, `claim`, `sample`, `provenance`, `provenance.agreement`, a stratum, `retractions`, `benchmark`, `population`, the assessment options, the `wilsonInterval` options or the `gwetAC1` options throws a `TypeError` naming the key and the nearest valid key. A misspelled optional key used to be ignored, which switched its check off and could return `supported`. Migration: remove extra keys (the kit does not read them) or fix the spelling. Own `toJSON` or `then` keys on a caller object are unknown keys too; they are still never called.
  - A bare `claim.value` (no `display`) is read as the shortest decimal within one ulp of it and never coarser than a whole percent, on both the sample and the complete-set path. `0.9` used to mean 90% plus or minus 5 points and passed for a true 85.1% on 1,000,000 items; it now means 90% within half a point and is `contradicted`. Migration: write `value` to the precision you mean (`0.851`), or pass `display`. The explanation no longer says "printed precision" when nothing was printed.
  - `assessAccuracyClaim` rejects `options.confidence` below 0.5 with `RangeError`. `0.05` typed for `0.95` used to give an "at least" statement from a 5% interval and could flip `overstated` to `supported`. Migration: pass a level from 0.5 up. `wilsonInterval` keeps the full range.
  - An agreement statistic that carries `n` below `options.minN` is `refused` with `agreement-sample-too-small` (a kappa or AC1 of 1.0 from 6 items used to clear `minAgreement` for a 10,000-item sample), and `provenance.raters` below 2 with an agreement block throws `RangeError`. A hand-written `{ statistic, value }` with no `n` is trusted as before. Migration: pass the agreement result from `percentAgreement`, `cohenKappa` or `gwetAC1` computed on at least `minN` items.

### Added
- `strata-not-reweighted` (informational): every stratified result carries it, and its statement says `stratified sample, unweighted pooled`. Verdicts are unchanged.
- `text-figure-differs` (informational): a percent, range, bound or `1 in N` in `claim.text` that is not the figure judged, or "perfect"-style wording when the figure is not 100%. Verdicts are unchanged.
- Metrics `specificity` and `npv`, and the diagnostic names `sensitivity` and `ppa` (recall), `ppv` (precision), `npa` (specificity) and `opa` (accuracy): each is judged as the metric it stands for and the statement uses the claimant's words ("specificity", "negative percent agreement") instead of "accurate". `ClaimMetric` gains the new members.
- More wordings are read as bounds: `greater than or equal to`, `not less than`, `no less than`, `minimum of` and `95% or higher` (also `or more`, `or above`, `or greater`) are inclusive floors, and `less than or equal to`, `not more than`, `maximum of` and `5% or lower` (also `or less`, `or below`) are inclusive ceilings. A bound before `1 in N` (`fewer than 1 in 1,000`) is a bound at 1/N. A bound after `1 in N` throws as ambiguous.
- A claim of exactly 0 or 1 never uses the comparison tolerance. A 0% error claim on zero errors, or a 100% accuracy claim on all correct, used to come back `supported` (`claim-within-bound`) above about 4e12 items, where the interval is narrower than the tolerance; it is now `overstated` at every size, and one error makes the 0% claim `contradicted`.
- Agreement functions throw `RangeError` ("pairs have more than 1000000 distinct labels") instead of grinding for about ten seconds into V8's bare "Map maximum size exceeded" when the pairs hold more than a million distinct labels.
- `options` that is a `Map`, a boxed primitive, a `Date` or a `Set` throws `TypeError`; it used to read as "no options" and switch every gate off.
- Messages: a claim of exactly 100% (or 0%) says a sample cannot show certainty and gives the bound that can be said, instead of "inside the interval but above its lower end"; a lower or upper bound printed rounded to the nearest digit that lands within one unit of its last digit past the interval end says which rounded figure to print; decimal places are counted as "whole percents", "1 decimal place", "2 decimal places" (the statement used to end "print it to at most 0 decimal place(s)"). Migration: update any text that matches those sentences.
- Error messages: an unknown `claim.metric` lists the judged names and the refused names separately (and says which name was meant when only the case is wrong); the refused names (`F1`, `AUC`, `WER`, ...) are recognized in any case; a `display` that disagrees with `value` names both figures and the allowance.
- New reason code `agreement-sample-too-small`; `AgreementInput` accepts an optional `n`.
- The result carries `checks` (`retractions`, `scope`, `age`, `agreement`, `strata`, each `applied` or `not-supplied`) so a check that was left out is visible. New exported types `GateChecks` and `GateStatus`.
- First version: `wilsonInterval`, `zForConfidence`, `percentAgreement`, `cohenKappa`, `gwetAC1`, `assessAccuracyClaim`, `maxDisplayDecimals`.

### What 0.1.0 does

Verdicts and refusals
- `supported`, `overstated`, `contradicted` and `refused`, each with reason codes, one plain sentence per code and a cautious suggested statement. A refusal outranks every verdict and returns no interval.
- A point claim equal to the observed rate to its printed precision is `supported` (`matches-observed-rate`); the interval is still in the statement. Bounds, 0 and 1 never use that allowance, and it is applied before `contradicted`, so a rounded rate that lands just outside its own interval is still an honest report. `options.conservative: true` restores the strict rule.
- Excess printed precision (`precision-too-fine`) is informational unless `options.strictPrecision` or `options.conservative` is set.
- `claim-worse-than-counts` (informational) flags a figure far less favorable than the counts, the stale-number pattern.
- An undisclosed sample is a refusal (`n-undisclosed`); `n` is `null`. Half-given counts throw. `sampling: 'stratified'` without `strata` is refused (`stratified-without-strata`).
- Label source `by-construction`, sampling `held-out-split` and `cross-validation` (judged as random, with the interval noted as optimistic).
- `options.maxAgeDays` with `options.now` and `evaluatedAt` refuse stale evaluations; `population: { claimed, evaluated }` and `options.requireScope` refuse scope mismatches. No clock is read.

Complete sets
- `sampling: 'complete'` with `benchmark.name` and `claim.text`: the claim is compared with the exact count (`census-matches-count`, `claim-differs-from-count`) and refused when its wording does not name the set. `basis` reports `census`, `wilson-interval` or `none`.
- The claim must match the count in both its `value` and its `display`; 0 and 1 (`0%`, `100%`) are exact; a value computed as `correct / n` matches its own count. Claim digits come from the shortest round-trip text, never from `toFixed`.
- The benchmark name must appear in `claim.text` as its own word or phrase, after folding quotes, dashes and the soft hyphen; the matcher reads only the characters next to a match, so it is linear in the text.

Printed forms
- `display` is parsed by form (point, approximate, floor, ceiling, range, `1 in N`) and the parsed form is returned as `parsedDisplay`. Strict bounds exclude equality, inclusive ones keep it, impossible bounds throw, and a range needs the value inside it. A range and a bound are judged at their favorable end on every path.
- The printed figure is judged, not only `value`: the more favorable of the two is compared with the interval and returned as `assessedValue`. The display is compared with `value` exactly (BigInt, half a unit of the last digit plus one ulp of the value).
- A value built as `printedPercent / 100` is the printed figure; a value one ulp from a shorter decimal is read as that decimal.
- A printed point figure must match the observed rate to its own precision even when a coarser `value` does.

Numerics
- Bounds are rounded exactly outward (BigInt on the double's mantissa and exponent), confidence labels round down and never print 100%, and the headline bound and the interval it quotes use one precision. `zForConfidence` keeps its digits for tiny levels.
- Array lengths (pairs, strata) are validated, 0 to 10,000,000; labels and stratum names are capped at 1000 characters. An undefined agreement statistic must carry `value: null`.

Tests
- A verdict table of honest inputs that must pass and bad inputs that must be flagged, regression rows named for the finding each pins, and reference vectors from an independent standard-library Python script (`test/fixtures/generate_vectors.py`): 60-digit decimal for Wilson, exact fractions for agreement and for the printed-form, census and noisy-value grids. Wilson's 1927 formula and Gwet's AC1 example could not be retrieved, so those statistics are checked against the independent reference implementation and against statsmodels, scipy, scikit-learn and irrCAC (below); the Cohen's kappa examples were read from the Wikipedia page. No fixture value is recalled from memory.
- Reference cross-check: `test/reference.test.ts` compares Wilson intervals (8,899 cases, n from 1 to 10^12, confidence 50% to 99.99%), z, percent agreement, Cohen's kappa and Gwet's AC1 (1,500 two-rater tables, including irrCAC's documentation tables) with statsmodels, scipy, scikit-learn and irrCAC to a maximum absolute difference of 1e-12 (largest seen: 4.9e-15 for Wilson, 6.7e-14 for kappa). The numbers are in `test/fixtures/reference.json`, written by `scripts/reference/gen.py` (developer tool, not shipped, library versions recorded in the file).
- Field benchmark: `bench/` holds 216 percentages with counts printed in 75 public FDA 510(k) summaries (derived numbers and source URLs only, licenses in `bench/SOURCES.json`) and an independent oracle written from the README. `npm run bench` reproduces the headline numbers: 0 of 957 claims the counts do not carry passed as `supported`, 726 of 726 carried claims were `supported`, and the verdict equals the oracle's on 2,001 of 2,001 judged claims. A 547-case slice runs in the test suite (`test/field-corpus.test.ts`). Not part of the npm package.
- Holdout: `bench/holdout/` has 103 public accuracy claims with printed counts from 30 open-access papers (language-model exam studies, classifier papers) and one detector vendor's benchmark page, none from the FDA corpus. Verdicts were decided by hand from the README rules and committed before the kit ran on them. The kit agrees on 103 of 103 (73 supported, 24 refused, 4 contradicted, 2 overstated), with identical reason codes. Of the six contradicted or overstated rows, five are printed percentages that are not the rate their own counts give (four truncated instead of rounded, one mistyped) and one is a vendor sentence ("only 1 in 1000") against 1 error in 1,992 texts.
