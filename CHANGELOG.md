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
- Error messages: an unknown `claim.metric` lists the judged names and the refused names separately (and says which name was meant when only the case is wrong); the refused names (`F1`, `AUC`, `WER`, ...) are recognized in any case; a `display` that disagrees with `value` names both figures and the allowance.
- New reason code `agreement-sample-too-small`; `AgreementInput` accepts an optional `n`.
- The result carries `checks` (`retractions`, `scope`, `age`, `agreement`, `strata`, each `applied` or `not-supplied`) so a check that was left out is visible. New exported types `GateChecks` and `GateStatus`.
- First version: `wilsonInterval`, `zForConfidence`, `percentAgreement`, `cohenKappa`, `gwetAC1`, `assessAccuracyClaim`, `maxDisplayDecimals`.
- Verdicts `supported`, `overstated`, `contradicted` and `refused`, with reason codes and a cautious suggested statement.
- Reference vectors generated by an independent standard-library Python script (`test/fixtures/generate_vectors.py`).

### Fixes before release
- The benchmark name matcher is linear in the claim text. A 2,000-character text that expands to 36,000 characters under compatibility folding took about 4 seconds of CPU; it now takes a few milliseconds.
- Curly quotes and apostrophes, every dash variant, the minus sign and the soft hyphen are folded before names and populations are compared, so text copied from the web that names the benchmark is no longer refused.
- A name followed by `+`, or by `-`, `_`, `/` or `.` and then a letter or digit, is a longer name: `MMLU` is not found in `MMLU-Pro` and `HumanEval` is not found in `HumanEval+` (refused with `claim-not-scoped-to-benchmark`). The same joiners before the match count too. A variant set off by a space cannot be detected; declare the full name.
- `benchmark.name` and `population` strings need a letter or a digit (`RangeError` otherwise), so `.`, `%` or an invisible character no longer matches any text.
- Agreement labels and stratum names over 1000 characters throw `RangeError` (very long equal-length strings made the label and name tables quadratic).
- A value built as `printedPercent / 100` (`82.7 / 100`) or `printedPercent * 0.01` is the printed figure. It used to flip an honest report to `overstated` on the sample path and to `contradicted` (`claim-differs-from-count`) on the complete-set path whenever floating-point noise put it one ulp above the figure. A value one ulp from a shorter decimal is read as that decimal, and one ulp apart is never "more favorable".

### Fixes after review
- A Proxy reporting an infinite, NaN or huge `length` for pairs or strata no longer hangs or returns NaN counts; lengths are validated (0 to 10,000,000).
- The printed `display` is judged, not only `value`: the more favorable of the two is compared with the interval and returned as `assessedValue`.
- An undefined agreement statistic must carry `value: null`; malformed values throw.
- `zForConfidence` keeps its digits for tiny confidence levels (computed from the displacement `c/2`).
- Formatted bounds are rounded exactly outward; an all-correct sample of 1e14 no longer prints 100%.
- Confidence labels round down and never print 100%.
- A printed point figure must match the observed rate to its own precision even when a coarser `value` does (86,000 of 100,000 with `value: 0.9` and `display: '89.99999999999999%'` is now `contradicted`).
- A strict printed floor (`over 98%`) no longer makes a `value` that equals the conservative bound `overstated`; the value and the printed bound are judged separately.
- The benchmark name must appear in `claim.text` as its own word or phrase, not inside another word.
- A non-string `claim.display` throws `TypeError` for unsupported metrics too.

### Final review round
- A display is compared with `value` exactly (BigInt, half a unit of the display's last digit plus one ulp of the value, so representation error never throws); `COMPARISON_TOLERANCE` no longer softens that check.
- A display above 100% or with a sign is rejected from its decimal digits before conversion.
- A refused result reports the selected `assessedValue`.
- `zForConfidence` returns `c * sqrt(pi/2)` below 1e-9, so `Number.MIN_VALUE` gives `Number.MIN_VALUE`, not 0.

### Learning-driven round (field-trial findings)
- `sampling: 'stratified'` without `strata` is refused (`stratified-without-strata`); it used to pass as a simple random sample.
- `sampling: 'complete'` with `benchmark.name` and `claim.text`: a claim about a whole fixed set is compared with the exact count (`census-matches-count`, `claim-differs-from-count`), and refused when its wording does not name the set. `basis` reports `census`, `wilson-interval` or `none`.
- `claim-worse-than-counts` (informational) flags figures far less favorable than the counts, the stale-number pattern. Verdicts are unchanged; it appears in `reasons`.
- `options.maxAgeDays` with `options.now` and `evaluatedAt` refuse stale evaluations; no clock is read.
- `population: { claimed, evaluated }` and `options.requireScope` refuse scope mismatches.
- `provenance.source: 'automated'` for deterministic ground truth (test suites, exact search).
- The suggested statement uses one precision for the headline bound and the interval it quotes (it used to print 1.3% beside 1.22%). Existing statements change accordingly.
- README opening rewritten; added "Claims about a fixed benchmark", "Age and scope" and "Preparing a real claim".

### Complete-set review fixes
- A complete-set claim must match the count in both its `value` and its `display` (a more favorable value no longer hides behind a display that rounds correctly).
- 0 and 1 (and `0%` / `100%`) are exact claims on a complete set; no rounding allowance.
- Claim digits come from the shortest round-trip text (mantissa and exponent), never from `toFixed`; `5e-7` on 5 of 10,000,000 is supported.
- A value computed as `correct / n` matches its own count (one ulp of allowance).
- Added a 1,050-row grid of values (exponent forms, 0, 1, thirds) and counts checked against exact rational references from the Python generator.

### Usability round (prevalence-audit findings)
- An undisclosed sample is a refusal: omit `sample` (or its counts) and the result is `refused` with `n-undisclosed`; `n` is `null` in the result. Half-given counts still throw.
- Metrics: `precision`, `recall`, `false-positive-rate`, `false-negative-rate` join `accuracy` and `error-rate`. F1, AUC, WER, BLEU and similar names are refused (`metric-not-supported`) instead of throwing. Unknown metric names still throw.
- Display forms: floors (`99%+`, `over 99%`, `>=`), ceilings (`<1%`, `no more than 1%`), approximate words (`~`, `about`), ranges (`95-98%`, judged at the favorable end) and `1 in N` are parsed. The parsed form is returned as `parsedDisplay`. Unparseable text still throws.
- Default verdict model: a claim equal to the observed rate to its printed precision is `supported` with `matches-observed-rate`; the interval is still in the statement. `overstated` stays for claims above the observed rate and for `precision-too-fine`; `contradicted` for claims outside the interval. Bounds and absolute claims (0, 1) never use the allowance. `options.conservative: true` restores the old rule. Changed verdicts: a point claim equal to the observed rate used to be `overstated` (`claim-beyond-conservative-bound`); it is now `supported` unless printed too finely, in which case the reasons are now `['precision-too-fine']` alone.
- Label source `by-construction`; sampling `held-out-split` (complete-set path) and `cross-validation` (judged as random, with a caveat).

### Precision is informational by default
- `precision-too-fine` no longer turns a `supported` claim into `overstated`. It stays in `reasons` and `explanation`, and the suggested statement ends with "; print it to at most N decimal place(s)". `options.strictPrecision: true` restores the old effect, and `options.conservative` implies it.
- Changed verdicts (default mode): 499/500 claimed "99.8%" overstated -> supported (`matches-observed-rate`, `precision-too-fine`); 499/500 claimed "98.5%" overstated -> supported (`claim-within-bound`, `precision-too-fine`); error rate 1/500 claimed "0.2%" overstated -> supported (`matches-observed-rate`, `precision-too-fine`); 9,980/10,000 claimed "99.60%" overstated -> supported; a complete-set 79.9000% on 39,950 of 50,000 overstated -> supported. Each remains `overstated` with `strictPrecision: true`.

### Printed-form review fixes
- On complete sets and held-out splits, a range is judged at its favorable end and a value more favorable than the printed figure is judged as its own point figure; a value of 0.98 printed as "95-98%" on 950 of 1000 is now contradicted, as is 0.994 printed as "99%+" on 990 of 1000.
- Strict bounds ("over", "above", "more than", ">", "under", "below", "less than", "fewer than", "<") exclude equality; inclusive ones ("at least", "at most", "no more than", "up to", "99%+", the "or equal" symbols) keep it. Counts are compared exactly. Impossible bounds (over 100%, under 0%) throw RangeError.
- The observed-rate exception is applied before contradiction, so a rounded rate that lands just outside its own interval is `supported` (`matches-observed-rate`). Bounds, 0 and 1, and `conservative` mode are excluded.
- A range requires the value inside it, with exact endpoint comparison and one ulp of slack.
- A 1,800-row exact-rational grid covers floors, ceilings, ranges and "1 in N" on both paths.
