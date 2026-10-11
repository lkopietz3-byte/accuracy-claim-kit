# Accuracy Claim Kit

Substantiation for a published accuracy or error-rate number. You give it the counts behind the figure, who labeled the items, how they were chosen, and optionally what the claim covers and when it was measured. It tells you whether those counts can carry the figure, and writes the most the evidence supports as a plain statement you can publish instead.

It is for people who publish a figure from their own evaluation: an AI-eval author, a team with a model or detector in production, a maintainer writing a benchmark README or a methodology page. It does one job: checking one number against its own evidence. Most real claims fail on a missing declaration (nobody wrote down who labeled, how items were picked, or what was measured), so expect "refused" often and read it as "write this down", not "false".

What it does not do: it does not judge whether labels are correct, detect a sample that was quietly filtered, compare systems, or make any legal or regulatory determination. A `supported` verdict means the claim is no more favorable than the evidence you supplied; it is not proof the system is accurate. See "What it does not do".

Zero runtime dependencies, TypeScript, ESM, Node 20 or newer, no `node:` imports in the source. It reads no clock and uses no randomness: the same input gives the same output (dates are passed in, never read).

Status: private and unlicensed (`"private": true`, `"license": "UNLICENSED"`). It is not published anywhere.

## What it checks

A claim like "99.8% accurate" or "0.2% error" is only as good as the evidence under it. The kit refuses to judge when any of these hold, and lists every one that applies:

| Reason code | Refused because |
| --- | --- |
| `no-human-labels` | The labels came from a model, so there is no human ground truth. (Use `automated` only for a deterministic procedure with known answers, such as a test suite or an exact search; never for a model's judgment.) |
| `unknown-label-source` | Nobody can say where the labels came from. |
| `mixed-label-source` | Some labels are from a model and the counts are not split. Assess only the human-labeled items. |
| `ranked-sample` | The sample was picked by rank (for example the top-scored items). |
| `convenience-sample` | The sample is whatever was easy to collect. |
| `unknown-sampling` | Nobody can say how the sample was picked. |
| `sample-too-small` | `n` is below `options.minN` (default 30). |
| `merged-strata-differ` | Strata were given, and two of them have intervals that do not overlap, so one combined number hides a real difference. |
| `stratified-without-strata` | `sampling` is `stratified` but no `strata` were supplied, so the pooled counts are not the population rate. |
| `claim-not-scoped-to-benchmark`, `benchmark-unnamed` | A `complete` (whole fixed set) claim whose wording does not name the benchmark, or that names none. See "Claims about a fixed benchmark". |
| `evaluation-stale`, `evaluation-date-missing` | `options.maxAgeDays` is set and the evaluation is older than that, or has no date. |
| `scope-mismatch`, `scope-undeclared` | The claimed population differs from the evaluated one, or (with `options.requireScope`) neither was declared. |
| `retractions-not-included` | Retracted items are known (`count > 0`) but are not in the counts. |
| `agreement-missing`, `agreement-undefined`, `agreement-below-minimum` | `options.minAgreement` is set and the supplied agreement statistic is absent, undefined, or lower than the minimum. |

If nothing blocks it, the claim is compared with the Wilson interval (or, for a whole fixed set, with the exact count):

| Verdict | Accuracy claim | Error-rate claim |
| --- | --- | --- |
| `contradicted` | above the top of the interval | below the bottom of the interval |
| `overstated` | inside the interval but above its lower end, or printed with more decimals than the interval supports | inside the interval but below its upper end, or printed with more decimals than the interval supports |
| `supported` | at or below the lower end | at or above the upper end |

One more code never changes a verdict: `claim-worse-than-counts` is added when a figure is far *less* favorable than the counts support (outside the 99.9% interval on the pessimistic side). That pattern is what a stale or mistyped number looks like (a published 44% error rate against 56 errors in 189 items, which is 29.6%), so the explanation says it may be stale or wrong. The verdict stays `supported`, because an understated claim is not an overstatement.

The "conservative bound" is the end of the interval a claim should not beat: the lower end for accuracy, the upper end for error rate. A supported claim is no more favorable than that bound. A claim that is more cautious than the evidence (say "90%" when the lower end is 98%) is supported.

## Worked example

499 of 500 items were right, labeled by two people, drawn at random. The claim is "99.8% accurate".

```ts
import { assessAccuracyClaim } from 'accuracy-claim-kit'

const result = assessAccuracyClaim({
  claim: { metric: 'accuracy', value: 0.998, display: '99.8%' },
  sample: { n: 500, correct: 499 },
  provenance: { source: 'human', raters: 2 },
  sampling: 'random',
})

result.verdict // 'overstated'
result.reasons // ['claim-beyond-conservative-bound', 'precision-too-fine']
result.explanation[0]
// 'The claimed 99.800% is inside the 95% Wilson interval but above its lower end (98.875%), which is the most the evidence supports.'
result.interval // { low: 0.98875..., high: 0.99964..., point: 0.998, confidence: 0.95, z: 1.95996..., successes: 499, n: 500 }
result.suggestedStatement
// 'At least 98.87% accurate (95% Wilson interval 98.87% to 99.97%, n = 500, human labels, random sample)'
```

Two things are wrong with "99.8%": the data cannot rule out that the true rate is as low as 98.88%, and a figure printed to a tenth of a percent implies far more precision than an interval 1.09 points wide supports. The suggested statement describes the evidence and rounds the lower end down (98.8759 prints as 98.87, never 98.88). The headline bound and the interval it quotes always use the same precision.

Other results from the same style of input:

- 990 of 1000 right, claimed "98%": `supported`. The lower end is 98.17%.
- 900 of 1000 right, claimed 95%: `contradicted`. The top of the interval is 91.71%.
- A 0.2% error claim where a model did the labeling: `refused`, reason `no-human-labels`, no interval returned.
- 980 of 1000 right in one stratum and 10 of 30 in another, claimed 95% overall: `refused`, reason `merged-strata-differ`.

## Claims about a fixed benchmark

Many real claims are not estimates from a sample: they are a score over the whole of a fixed, named set (a published validation set, a full test split). There is nothing to infer, so an interval is the wrong tool. Declare it with `sampling: 'complete'`, the set's name, and claim wording that names it:

```ts
assessAccuracyClaim({
  claim: { metric: 'accuracy', value: 0.799, display: '79.9%', text: 'Reaches 79.9% top-1 accuracy on the Ridgeview validation set' },
  sample: { n: 50000, correct: 39950 },
  provenance: { source: 'human' },
  sampling: 'complete',
  benchmark: { name: 'Ridgeview validation set' },
})
// verdict 'supported', reasons ['census-matches-count'], basis 'census', interval null
// suggestedStatement: '39950 of 50000 correct on Ridgeview validation set (complete set, human labels): 79.90% accuracy. This describes that set only; it is not an estimate for other data'
```

What is checked for a complete set:

- **The figure against the exact count**, in exact arithmetic, to the precision it is printed at (`79.9%` matches 39950 of 50000; `80%` also matches, as a rounding; `81%` does not). A figure that does not match is `contradicted` (`claim-differs-from-count`) in either direction, which catches stale and mistyped numbers. With no `display`, the value is read at the precision it was written with.
- **Precision**: digits beyond what `n` resolves (more than `d` percent decimals when `10^(d+2)` exceeds `10 n`) are `precision-too-fine`.
- **Scope wording**: `claim.text` must mention `benchmark.name` (compared after Unicode compatibility folding, lower-casing and collapsing whitespace; look-alike letters from other scripts are not folded). A score on a fixed set worded as a general claim ("our model is 79.9% accurate") is refused as `claim-not-scoped-to-benchmark`. To make a general claim, use a random sample and the interval.
- There is no minimum `n` for a complete set, and strata are not checked for heterogeneity. Label source, retractions, agreement gates, evaluation age and population scope apply as usual.
- `benchmark` is rejected (`RangeError`) with any other `sampling`.

## Age and scope

- **Age**: set `options.maxAgeDays` and `options.now` (a `YYYY-MM-DD` string; the kit never reads a clock) and pass `evaluatedAt` (`YYYY-MM-DD`). An evaluation older than the limit is refused (`evaluation-stale`); a missing `evaluatedAt` is `evaluation-date-missing`. Both must be real calendar dates, `evaluatedAt` may not be after `now`, and `maxAgeDays` without `now` throws `TypeError`.
- **Scope**: pass `population: { claimed, evaluated }`, short identifiers for what the claim says it covers and what was actually measured. They are compared after Unicode compatibility folding, lower-casing and whitespace collapsing; different identifiers are refused as `scope-mismatch`. This catches a number tuned on one domain and published for another, but only as far as you declare it: the kit cannot see the data. `options.requireScope: true` refuses a claim with no `population`.

## Preparing a real claim

Real claims come as prose. Pull out these declarations first, and write "unknown" where the source does not say; do not guess:

| From the claim | Becomes |
| --- | --- |
| "99.8% accurate", "error rate 0.2%" | `claim.metric` and `claim.value` (a proportion), plus `display` exactly as printed |
| the number of items checked and how many were right or wrong | `sample.n` and `correct` or `errors` |
| who decided what was right (people, a test suite, a model) | `provenance.source`: `human`, `automated`, `model`, `mixed`, `unknown` |
| how items were chosen (all of a named set, a random draw, by score, whatever was handy) | `sampling`: `complete`, `random`, `stratified`, `ranked`, `convenience`, `unknown` |

`display` accepts only a plain percent such as `99.8%`. Approximate and range prose (`~5%`, `<2%`, `30-50%`, `1.8.`, a bare `1.8`) must be cleaned before it goes in, or `display` left out; leaving it out skips the precision check, and the claim is judged on `value` alone. The kit throws on a display it cannot read rather than guessing.

## Install

The package is private and not on a registry. From a clone, `npm run build && npm pack` produces a tarball that another project can install by path. The examples import it as `accuracy-claim-kit`.

## API

```ts
wilsonInterval(successes, n, { confidence = 0.95 }): WilsonInterval
zForConfidence(confidence): number
percentAgreement(pairs): AgreementResult
cohenKappa(pairs): AgreementResult
gwetAC1(pairs, { categories? }): AgreementResult
assessAccuracyClaim(input, options?): AccuracyAssessment
maxDisplayDecimals(width): number
DEFAULT_CONFIDENCE (0.95), DEFAULT_MIN_N (30), COMPARISON_TOLERANCE (1e-12)
```

### wilsonInterval

Returns `{ low, high, point, confidence, z, successes, n }`. `point` is `successes / n`, and `low <= point <= high` within `[0, 1]`.

- `successes = 0` gives `low` exactly 0. `successes = n` gives `high` exactly 1.
- Swapping `successes` and `n - successes` swaps the limits (`low` becomes `1 - high`) to within 1e-15.
- `n` up to `Number.MAX_SAFE_INTEGER` stays finite; limits near 0 keep their relative accuracy.
- Throws `TypeError` if an argument is not a number. Throws `RangeError` if `n` is not a whole number from 1 to `Number.MAX_SAFE_INTEGER`, if `successes` is not a whole number from 0 to `n`, or if `confidence` is not strictly between 0 and 1. `-0` is read as `0`.

### Agreement statistics

`pairs` is an array of `[labelA, labelB]`, one pair per item, for two raters. Labels are strings, booleans or finite numbers, compared exactly (`1` and `"1"` differ; nothing is trimmed or normalized). Each function returns one of two shapes:

```ts
{ statistic, status: 'defined',   value: number, n, agreements, categories }
{ statistic, status: 'undefined', value: null, reason, n, agreements, categories }
```

`value` is never `NaN`. Undefined cases:

| Statistic | Undefined when | `reason` |
| --- | --- | --- |
| all three | there are no pairs | `no-pairs` |
| `cohenKappa` | chance agreement is exactly 1: both raters used one and the same single label for every item | `expected-agreement-is-1` |
| `gwetAC1` | fewer than two categories (pass `{ categories: Q }` if the scale allows more than were used) | `single-category` |

`categories` is the number of distinct labels seen (for `gwetAC1`, the Q used). Kappa and AC1 are computed from integer counts with `BigInt`, so there is no subtraction error. Malformed pairs throw (`TypeError` for a wrong type, `RangeError` for a wrong length or a non-finite number). An array's `length` is validated before it is used (a whole number from 0 to 10,000,000), so a Proxy that reports `Infinity`, `NaN` or a huge length throws instead of looping; the same limit applies to `strata`.

Pass a result straight into `provenance.agreement`.

### assessAccuracyClaim

```ts
assessAccuracyClaim({
  claim: { metric: 'accuracy' | 'error-rate', value, display?, text? },   // value in 0..1; display like "99.8%"; text for 'complete'
  sample: { n, correct? , errors? },                               // give correct or errors (or both, adding to n)
  provenance: { source: 'human' | 'automated' | 'model' | 'mixed' | 'unknown', raters?, agreement? },
  sampling: 'random' | 'stratified' | 'ranked' | 'convenience' | 'unknown' | 'complete',
  strata?: [{ name, n, correct? , errors? }],                      // required with 'stratified'; must add up to the sample
  retractions?: { count, includedInSample },
  benchmark?: { name },                                            // required with 'complete', rejected otherwise
  population?: { claimed, evaluated },
  evaluatedAt?: 'YYYY-MM-DD',
}, { confidence?, minN?, minAgreement?, maxAgeDays?, now?, requireScope? })
```

Returns `{ verdict, reasons, explanation, metric, claimed, assessedValue, n, basis, interval, conservativeBound, suggestedStatement }`. `reasons` has at least one code and `explanation` has one plain sentence per code. When refused, `interval` and `conservativeBound` are `null` so no number is there to quote, and `suggestedStatement` says why no figure can be given.

Rules you can rely on:

- **Malformed input throws and never returns a verdict.** Wrong runtime type: `TypeError`. Right type, unusable value (NaN, fractional counts, `correct > n`, a figure outside 0..1, an unknown enum string, a `display` that is not a percent or does not match `value`, strata that do not add up to the sample, duplicate stratum names, more included retractions than items): `RangeError`.
- **Every property is read once**, in a fixed order, before any judgment. Proxies, getters, class instances, inherited fields and null-prototype objects all work. A getter that throws propagates its own error. No key listing, `toJSON` or `then` is ever used.
- **`sampling: 'stratified'` needs `strata`.** Without them the pooled counts are not the population rate, so the claim is refused (`stratified-without-strata`). With them, the combined number is refused if strata clearly differ.
- **A refusal outranks a verdict.** A ranked sample with a plainly false claim is refused, not contradicted.
- **`display`** is optional. Readers see the printed figure, so when it is given the verdict judges the **more favorable of `value` and the parsed display** (the higher for accuracy, the lower for error rate). That figure is returned as `assessedValue`, and the explanation says "printed figure" when it came from the display. A `value` of 0.996 printed as "100%" on 1000 of 1000 correct is judged as 100% and comes out `overstated`, not `supported`. A display that disagrees with `value` by more than the allowance throws `RangeError`, so the two can never quietly diverge. The comparison is exact (the double's exact value against the display's decimal digits, no float tolerance) and the allowance is half a unit of the display's last digit plus one ulp of the value. A figure a person rounded by hand (0.985 printed as `99%`) is therefore never rejected for the double's own representation error, while `98.00000000009%` for 0.98 still is. The display must be a percent from 0 to 100 (its decimal digits are checked before conversion, so `100.000000000000001%` is rejected rather than rounded to 100%; signs are not accepted). `assessedValue` is computed before any refusal, so a refused result reports the same selected figure. The number of decimals is also checked against the interval (see below); whole-percent figures are never flagged.
- **`provenance.agreement`**: a defined statistic needs a finite `value` from -1 to 1. An undefined one (`status: 'undefined'`, as `cohenKappa` and `gwetAC1` return) must carry `value: null`; `NaN`, numbers, text or objects in its place throw. An undefined statistic is accepted as input but can never pass a gate (`agreement-undefined`).
- **`options.minAgreement`** (from -1 to 1) turns agreement into a gate. Equal to the minimum passes. Without it, a supplied agreement statistic is only echoed in the statement.
- **Strata**: if two strata have non-overlapping intervals the combined number is refused. The intervals use a Bonferroni split of the error budget across strata (`k` strata use confidence `1 - (1 - confidence) / k`), so many strata do not cause refusals by chance. One stratum never triggers it.

### Floating point and boundaries

Comparisons between a claim and an interval limit use an absolute tolerance of `COMPARISON_TOLERANCE = 1e-12`, always in the claimant's favor. A claim within 1e-12 of a limit counts as being at it: for accuracy, exactly at the lower end is `supported`, and exactly at the upper end is `overstated` (not `contradicted`). The tolerance is far below the width of any interval met in practice. It can matter only above about 1e15 items with a rate within about 1e-12 of 0 or 1, where the interval itself is narrower than the tolerance. Agreement gates use the same tolerance. The test table has rows exactly at each boundary and 1e-9 on either side.

### Precision of a displayed figure

A figure printed with `D` decimals has a last digit worth `10^-D` percentage points. It is accepted while `10^-D` is at least one tenth of the interval width in percentage points; otherwise the last digits are noise and the result carries `precision-too-fine`. `maxDisplayDecimals(width)` returns the largest accepted `D` for an interval width given as a proportion. For 499 of 500 the width is 1.09 points, so only whole percents pass and "99.8%" is flagged. This is a rule of thumb stated here, not a standard. A claim that is otherwise supported becomes `overstated` when it is printed too finely; a contradicted claim stays contradicted and also lists the precision reason.

### Suggested statements

For non-refused results: `At least X% accurate (95% Wilson interval L% to H%, n = N, human labels, random sample)`, or `At most X% error rate (...)`, with `automated labels` and `evaluated YYYY-MM-DD` shown when they apply. For a complete set it reads like `39950 of 50000 correct on <set> (complete set, human labels): 79.90% accuracy. This describes that set only; it is not an estimate for other data`. Bounds always round in the cautious direction (lower end down, upper end up), exactly: the double is split into mantissa and exponent and rounded with integer arithmetic, so a printed bound is never on the favorable side of the number it describes (an all-correct sample of 1e14 prints `At least 99.9999...%`, never 100%). The confidence level is labeled from its shortest decimal text, rounded down, and never prints as 100% (`0.95` reads `95%`). The statement describes the evidence; it never says the system is accurate.

## Formulas

With `z` the two-sided normal quantile for the confidence level (`z = 1.95996...` at 0.95), `s` successes in `n` trials:

```
centre = (s + z^2/2) / (n + z^2)
margin = z * sqrt( s(n - s)/n + z^2/4 ) / (n + z^2)
Wilson interval = [centre - margin, centre + margin]
```

The code evaluates the lower limit as `s^2 / (n * (A + B))` with `A = s + z^2/2` and `B = z * sqrt(s(n - s)/n + z^2/4)`, which is the same number without cancellation when `s` is small. Above the midpoint the upper limit is `1 - (lower limit for n - s)`.

`z` comes from an inverse normal CDF: Acklam's rational approximation followed by one Halley refinement step against an `erf`/`erfc` written out in the source. It matches Python's `NormalDist().inv_cdf` to about 2e-15 relative on the reference points. For confidence levels up to 0.5 the quantile is solved from the displacement `c/2` from the median rather than from `0.5 + c/2`, which would round away every digit of a tiny `c` (`zForConfidence(1e-16)` is about 1.2533e-16, not 0); below 1e-9 it is `c * sqrt(pi/2)`, which also keeps `Number.MIN_VALUE` from underflowing to 0; the Python generator checks that range with a Newton solve of the erf Taylor series in 60-digit decimal because `NormalDist` has the same cancellation there. Below p of about 1e-300 the refinement is skipped and the answer is good to about 1e-9.

For two raters over `N` items, `a_k` and `b_k` the counts of label `k` from each rater, `agree` the items with equal labels:

```
po       = agree / N
Cohen    pe = sum_k (a_k/N)(b_k/N)
         kappa = (po - pe) / (1 - pe)                 undefined if pe = 1
Gwet     pi_k = (a_k + b_k) / (2N)
         pe = sum_k pi_k (1 - pi_k) / (Q - 1)
         AC1 = (po - pe) / (1 - pe)                   undefined if Q < 2
```

## What it does not do

- It does not judge whether the labels are right. "Human labels" is a declaration you make; the kit cannot see who labeled anything.
- It cannot detect sampling fraud or a sample that was filtered before you counted it. `sampling: 'random'` is taken at your word.
- A `supported` verdict is not proof that the system is accurate. It says only that the claim is no more favorable than the lower end of an interval computed from counts you supplied. The interval describes sampling noise alone; it does not cover label errors, drift, a different population in production, or choosing the best of several runs.
- The Wilson interval treats the pooled counts as one simple random sample. A stratified sample with unequal sampling rates is not a simple random sample; the interval is not reweighted, so use per-stratum results for those.
- It does not compare two systems, test significance between them, or estimate calibration.
- It does not give advice, legal conclusions, or compliance conclusions.
- The 30-item default minimum, the 1/10-of-width precision rule and the strata check are policy choices written down here, not statistical laws. Change `minN` if your situation differs.
- It does not check an interval you quote. A published "95% CI 0.0 to 1.2" is not compared with the computed interval; a claim that carries its own correct interval can still come back `overstated` when the point figure sits above the interval's lower end. Use the suggested statement, which quotes the computed interval.
- It does not compare systems ("+27 points over the old one", "best of ten models") and does not reweight a stratified sample by population share; for that, report per-stratum results.
- It does not model excluded or non-answered items (a rate computed only over items every system answered), or clustered, non-independent items; the interval assumes independent items.
- The scope and benchmark-wording checks compare strings you provide. They catch a mismatch you declared, not one you did not. Naming the benchmark in `claim.text` is necessary for a complete-set claim, not sufficient: the kit cannot read whether the sentence still generalizes.
- Multiple raters beyond two, ordinal weighting (weighted kappa), and confidence intervals for kappa or AC1 are not included.

## Relationship to advice-ledger-kit

`advice-ledger-kit` grades a log of recommendations against human judgments and outcomes, and it deliberately produces no confidence interval and never blends its counts into one accuracy number. This kit is the other half: when someone does want to publish an accuracy figure, it says whether the counts can carry it. They share no code.

## Tests and vectors

`npm run verify` runs lint, type check, tests, the build and a packaging check that installs the packed tarball into a clean project.

Expected values come from `test/fixtures/generate_vectors.py`, which uses only the Python standard library (`math`, `decimal`, `fractions`, `random` with a fixed seed, `statistics.NormalDist`). The Wilson reference runs in 60-digit decimal arithmetic; agreement statistics run in exact rational arithmetic. The committed output is `test/fixtures/vectors.json`.

Where published values were available they are included and labeled in the fixture:

- Cohen's kappa: the worked examples on the Cohen's kappa Wikipedia page (0.40, 0.1304, 0.2593, 0.0089, -0.0667). These were read from the page.
- Wilson intervals: three rows of Newcombe (1998) Table I (81/263, 15/148, 0/20). The paper could not be retrieved, so those 4-decimal values were recalled and are not checked against it; they do agree with the independent computation.
- Wilson's 1927 formula and Gwet's (2008) AC1 example could not be retrieved; those statistics rest on the independent reference implementation only.

## Layout

```
src/wilson.ts       Wilson interval, z for a confidence level
src/normal.ts       inverse normal CDF
src/agreement.ts    percent agreement, Cohen's kappa, Gwet's AC1
src/assess.ts       assessAccuracyClaim
src/format.ts       cautious rounding, display precision rule
src/validate.ts     input readers
test/               verdict table, numeric vectors, hostile inputs
scripts/            package verification and consumer probes
```
