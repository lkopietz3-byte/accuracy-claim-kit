# Method

This page says what `accuracy-claim-kit` decides, why each rule and default is what it is, how to change it, and how often each heuristic was measured to flag or pass the wrong thing. The README says how to call the kit; this page says why it answers the way it does.

## Read this first: what a verdict is

The kit checks evidence. It does not certify that a figure is true, that a system is accurate, or that anyone has met a legal, regulatory or contractual duty. Its inputs are declarations you make (who labeled, how items were chosen, what the claim covers); it cannot see the data, so a verdict is only as good as those declarations. A `supported` verdict means the claim is no more favorable than the counts you supplied can carry, or is an honest report of the rate you observed. A `refused` verdict means "cannot tell", never "false". Nothing here is legal advice, and nothing in this package should be relied on as proof of substantiation. If a figure matters to a regulator, a customer or a court, the evidence behind it needs a qualified human review.

## The decision order

1. Malformed input throws. A verdict is never produced from input the kit cannot read.
2. Preconditions are checked and every failing one is listed. Any failure is a refusal, and a refusal outranks every other verdict. A refusal returns no interval, so no number is available to quote.
3. The claim is compared with the evidence: the exact count for a whole fixed set, the Wilson interval for a sample.
4. The result carries reason codes, one plain sentence each, and a suggested statement that says no more than the evidence does.

The order exists so that a plainly false claim on an unusable sample is not called "contradicted" on evidence that cannot support any judgment.

## Verdicts

| Verdict | Rule | Why |
| --- | --- | --- |
| `refused` | A precondition failed: undisclosed counts, labels that are not human or declared deterministic, ranked, convenience or unknown sampling, `n` below `minN`, strata that differ, known retractions left out, a failed agreement gate, a stale evaluation, a scope mismatch, a metric the kit cannot judge. | Most real claims fail on a missing declaration. Saying "cannot tell" and listing what to write down is more honest than guessing either way. |
| `contradicted` | Higher-is-better claim above the top of the interval (below the bottom, for lower-is-better), or, for a whole fixed set, a figure that differs from the exact count. A printed range is judged at its favorable end, as a point, so a range that contains the exact count is still contradicted when that end does not match it (`95-98%` is judged as 98% for accuracy). | The counts positively rule the figure out. This is the only verdict that says the figure is wrong. |
| `overstated` | Inside the interval, above the conservative end, and not the observed rate to its printed precision: more favorable than the observed rate, or more cautious than it but still above the conservative end (98.5% for 990 of 1000, whose lower end is 98.17%); or a bound or an absolute claim (0%, 100%) a sample cannot show. | The counts do not rule the figure out, but they do not carry it either. |
| `supported` | At or below the conservative end of the interval, or equal to the observed rate to its printed precision, or equal to the exact count for a whole fixed set. | The claim is no more favorable than the evidence. It is not a statement that the system is accurate. |

To change the strictness, pass `options.conservative: true` (only a claim at or below the conservative end is supported) or `options.strictPrecision: true` (too many printed decimals makes a supported claim overstated).

## Defaults, with reasons

| Default | Value | Why | How to change it |
| --- | --- | --- | --- |
| Interval | Wilson, 95% two-sided | Wilson behaves at small n and at rates near 0 and 1, where the Wald interval fails. 95% is the usual reporting level. It is cross-checked against statsmodels and scipy to 1e-12. | `options.confidence`, from 0.5 up to but not including 1 |
| Floor on confidence | 0.5 | `0.05` typed for `0.95` gives a narrow interval and a meaningless "at least" statement. A typo should throw, not pass. | None. `wilsonInterval` itself takes any level between 0 and 1 |
| Minimum sample | `minN` = 30 | A policy choice, not a statistical law. Below about 30 the interval is so wide that a verdict adds little. The suggested statement still shows the width. | `options.minN` |
| Observed-rate allowance | A figure equal to the observed rate to its printed precision is `supported` | Reporting what you measured is honest even when the interval is wide. The statement still quotes the interval. | `options.conservative: true` |
| Bounds and absolute claims | `99%+`, `<1%`, 0% and 100% never use the allowance | A bound is a claim about the true rate, not about what was observed. A sample cannot show certainty. | None |
| Precision rule | Printed decimals are noise when a last digit is worth less than one tenth of the interval width | A figure printed finer than its interval supports implies precision the data does not have. One tenth is a rule of thumb, not a standard. Informational by default, because extra digits are not evidence the figure is wrong. | `options.strictPrecision: true` |
| Tolerance | 1e-12, absolute, always in the claimant's favor | The place floating-point noise is absorbed when a claim is compared with an interval limit. It matters only above about 4e12 items. 0% and 100% claims never use it. | None |
| Value noise | 2^-50 (about 9e-16), absolute | How far a `value` may sit from the decimal or rate it was computed as: `1 - correct / n`, `pct / 100` and the mean of equal folds all land a few units in the last place away, and subtracting from 1 turns that into hundreds of ulps of a small result. It would take about 1e15 items to matter. A value within it of 0 or 1 is read as 0% or 100%, an absolute claim. | None |
| Label sources | `human`, `automated` (a deterministic procedure) and `by-construction` are accepted; `model`, `mixed` and `unknown` are refused | A model's judgment is not ground truth. `mixed` is refused because the counts are not split, so the human-labeled share cannot be assessed. The kit cannot verify any of these declarations. | Assess only the human-labeled items, or split the counts |
| Sampling | `random`, `stratified` (with strata), `cross-validation`, and a named whole set (`complete`, `held-out-split`) are judged; `ranked`, `convenience` and `unknown` are refused | A ranked or convenience sample does not estimate a population rate. Cross-validation is judged as random with a note that the interval is optimistic, because folds share data. | Declare the sampling truthfully; there is no switch to accept a convenience sample |
| Whole fixed set | The figure is compared with the exact count, with no interval | There is nothing to infer when the claim is a score over the whole of a named set. The claim text must name the set, so a general claim cannot ride on a fixed-set score. | Use a random sample and the interval to make a general claim |
| Strata | Intervals use a Bonferroni split of the error budget; two strata whose intervals do not overlap refuse the pooled figure | One pooled number hides a real difference between strata. The split keeps many strata from refusing by chance. The pooled interval is not reweighted by population share. | Report per stratum |
| Agreement | A supplied statistic that carries an `n` below `minN` is refused; `minAgreement` makes agreement a gate | A kappa of 1.0 from 6 items says nothing about the raters. Percent agreement is not chance-corrected and runs higher than kappa or AC1 on the same labels, so pick the statistic and the threshold together. | `options.minAgreement`, `options.minN` |
| Age | Off unless `options.maxAgeDays` and `options.now` are set | The kit never reads a clock. Dates are passed in. | `options.maxAgeDays`, `options.now` |
| Scope | Off unless `population` is declared; `options.requireScope` makes it a requirement | The kit can only compare identifiers you declare. | `options.requireScope` |
| `1 in N` | N is exact to plus or minus one half; trailing zeros are placeholders only with `about`, `~` and the like | `1 in 100` passing for a true 1.5% error rate was a real false pass. The band that was applied is named in the explanation. `1 in 1` is 100% and matches only n of n. | Write `about 1 in 100` for the wide band |
| Unknown keys | An unknown key in any caller object throws, naming the nearest valid key | A misspelled optional key would otherwise switch its check off and return `supported`. The result's `checks` object says which optional checks ran. | None |
| Input limits | Benchmark and population names 200 characters, claim text 2000, display 64, labels and stratum names 1000, 1,000,000 distinct labels, arrays 10,000,000 items | Keeps every loop linear and bounded. The Unicode normalization and substring search the platform runs on top of them can grow faster than linearly on adversarial text, and stay at a few milliseconds per call at these caps. | None |

## Measured rates for each heuristic

`npm run bench` runs `bench/heuristics.mjs`, which measures each rule below and checks the numbers against `bench/expected.json`. Two kinds of number appear and they are kept apart. **Field** numbers are counted over 216 printed rates with counts in 75 public FDA 510(k) summaries (181 have n of 30 or more), with an independent oracle that was written from the README. **Simulated** numbers come from a fixed-seed generator in the script and describe the populations listed there, not real studies. The oracle shares its author and its rules with the kit, so agreement with it shows the kit does what it documents, not that the rules are right. The holdout (`bench/holdout/`, 103 hand-labeled public claims from other sources) is the check that does not use the oracle.

| Heuristic | Measured | Kind | What it means |
| --- | --- | --- | --- |
| Verdict rules, claims the counts do not carry | 0 false passes of 957 altered claims; 0 of 181 claimed 3 points too high; 0 of 147 claimed as 100% (the non-refused cases) on a non-perfect rate | Field | An altered claim was never judged `supported`. Altered claims are built by fixed rules, so this is not the rate on claims people actually write. |
| Verdict rules, claims the counts carry | 726 of 726 supported | Field | Every claim the oracle says the counts carry was judged `supported`. Some honest reports are still not supported by design; see the next rows. |
| Whole-fixed-set path | 0 false passes of 623 claims the exact count does not carry | Field | An exact count has no sampling error to hide behind. |
| Holdout | Kit equals the hand label on 103 of 103 (73 supported, 24 refused, 4 contradicted, 2 overstated); 71 of the 103 are fixed-set scores, so the interval path is exercised by only 6 | Field | Labels were written before the kit ran, from the same rules. Not a sample of all accuracy claims. |
| Minimum sample (`minN` 30) | Refuses 35 of 216 printed rates (16%); 30 of them have n from 10 to 29 | Field | These are the rates a lower `minN` would let through. Whether refusing them is right is a judgment; there is no ground truth to score it against. |
| Observed-rate allowance | 147 of 147 supported honest rates are supported because of it; 34 more (all of them 100% rates, k equal to n) are not supported | Field | The allowance is what lets an honest report pass. Absolute claims never use it. |
| Observed-rate allowance, what it does not say | The true rate was below an honest whole-percent report of the observed rate in 3,645 of 9,000 simulated samples (41%) | Simulated | `supported` through the allowance says the figure is what was observed. It says nothing like "the true rate is at least this". Read the interval in the statement. |
| Claim at the conservative end | The true rate was below a claim set at the lower end of the 95% interval (rounded down to 0.1 point) in 108 of 9,000 simulated samples (1.2%) | Simulated | The lower end of a two-sided 95% interval is a one-sided 97.5% limit, so the miss rate is about 2.5% nominal. Wilson coverage is close to nominal, not guaranteed; at these sizes the measured rate was lower (1.2%). |
| Precision rule | `precision-too-fine` appears on 129 of 181 printed rates | Field | Most real figures are printed finer than the rule allows. That is why it is informational. |
| Precision rule, strict mode | `strictPrecision` stops supporting 122 of 147 honest rates (83%) | Field | Making it a gate would flag most honest reports. This is the reason the default is informational. |
| Conservative mode | `conservative` stops supporting 147 of 147 honest rates | Field | By design: it accepts only a claim at or below the lower end. Use it for a strict reading, not for ordinary checking. |
| `claim-worse-than-counts` | Flagged on 0 of 181 honest printed rates and on 56 of 181 printed 5 points too low (31%) | Field | The flag is informational and set to a 99.9% interval on purpose, so it misses most understated figures. It is a pointer to a stale or mistyped number, not a detector. |
| Strata check, real tables | Refused 8 of 95 published pooled site tables | Field | Sites with truly different rates. Not scored as right or wrong. |
| Strata check, false flags | 6 of 4,500 simulated stratified samples with one true rate in every stratum were refused (0.13%) | Simulated | The Bonferroni split keeps chance refusals rare. Power to catch a real difference was not measured. |
| Numerics | Matches statsmodels, scipy, scikit-learn and irrCAC to a largest difference of 4.9e-15 (Wilson, 8,899 cases), 6.7e-14 (kappa, against irrCAC) and 1.1e-14 (AC1), over 1,500 two-rater tables | Field | See the README table. This checks the arithmetic, not the policy. |

Not measured, so no rate is claimed: `text-figure-differs` (the benchmark text is built from the printed figure, so it cannot show false flags on real prose), the `1 in N` bands (no `1 in N` figure in either corpus), the `mixed` and `ranked` refusals on real label sources, age and scope checks, and agreement gates. The FDA corpus is one document family (diagnostic device summaries), and 29 of its 216 printed intervals matched no standard method; the kit never reads a printed interval, so verdicts are unaffected.

## Honest limits

- The kit cannot see the data. "Human labels", "random sample" and every other declaration are taken at your word. A sample that was quietly filtered before counting passes.
- The interval covers sampling error only. It does not cover label errors, drift, a different production population, or picking the best of several runs.
- Items are assumed independent. Clustered items, questions drawn from shared passages, and rates computed only over items every system answered are not modeled.
- A stratified sample with unequal sampling rates is pooled, not reweighted.
- It does not compare systems, test significance, estimate calibration, or check an interval you quote.
- It does not judge F1, AUC, WER, BLEU or composite scores; those come back refused.
- Agreement statistics cover two raters and unweighted labels, with no interval for kappa or AC1.
- Policy defaults (minimum sample, the precision rule, the strata check) are choices written down here so you can disagree with them and change them. They are not statistical laws.
- Scope and benchmark-name checks compare strings you provide. They catch a mismatch you declared, not one you did not.

## Where this sits next to public frameworks

These mappings are an aid to reading, not a statement that using the kit satisfies any framework, order or law. None of the three is a checklist this kit completes.

- **NIST AI 800-3, Expanding the AI Evaluation Toolbox with Statistical Models** (NIST, February 2026, https://doi.org/10.6028/NIST.AI.800-3). It separates benchmark accuracy, performance on one fixed set of items, from generalized accuracy, performance on all similar items. The kit's two paths follow that split: a whole fixed set is compared with its exact count and the statement says it "describes that set only", while a sample gets an interval and the statement says it covers sampling error only. The paper's own method is statistical modeling of item-level results; this kit does not do that.
- **FTC order against Workado, LLC** (final order approved August 2025; https://www.ftc.gov/news-events/news/press-releases/2025/08/ftc-approves-final-order-against-workado-llc-which-misrepresented-accuracy-its-artificial). The FTC's press release says the order bars claims about an AI detection product's effectiveness unless the claim is not misleading and the company has competent and reliable evidence when it makes it, and requires records supporting such claims. The kit's refusal reasons name the kinds of missing evidence that make a figure hard to support (who labeled, how items were chosen, how many, what population). It does not decide whether evidence is competent and reliable in any legal sense.
- **EU AI Act, Regulation (EU) 2024/1689, Article 15(3).** The article requires providers of high-risk AI systems to state accuracy levels and the metrics used in the accompanying instructions. The kit's suggested statement is a way to word a figure with its metric, counts, label source and sampling stated. Whether a system is high-risk, what an instruction of use must contain and when the duty applies are legal questions the kit does not answer.

## Changing a default

Each default is an option or a documented choice, and a change to one should be a deliberate edit to this page, the README and the verdict table (`test/verdict-table.test.ts`) together. A verdict rule that changes moves numbers pinned in `bench/expected.json`; find out why before editing a pinned number.
