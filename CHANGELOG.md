# Changelog

## [0.1.0] - 2026-10-21

First release. MIT licensed.

### What it does

- `assessAccuracyClaim` judges a published accuracy or error-rate figure against the counts behind it and returns one of four verdicts: `supported`, `overstated`, `contradicted` or `refused`. Every result has reason codes, one plain sentence per code, and a cautious suggested statement that begins `On this sample` and says the interval covers sampling error only.
- `refused` means "cannot tell", never "false". It outranks every other verdict, lists every failed precondition and returns no interval. Preconditions: counts disclosed, human or deterministic labels, random or stratified or named whole-set sampling, `n` at or above `minN` (default 30), strata that do not clearly differ, known retractions included, and optional gates for agreement, age and scope.
- Sample claims are compared with the Wilson interval (95% by default). A figure equal to the observed rate to its printed precision is `supported` (`matches-observed-rate`). Bounds such as `99%+` and `<1%`, and absolute claims of 0% or 100%, are never excused that way.
- Claims about a whole fixed set (`sampling: 'complete'` or `'held-out-split'`, with `benchmark.name` and wording that names the set) are compared with the exact count, with no interval.
- Metrics: accuracy, error rate, precision, recall, false positive rate, false negative rate, specificity and NPV, plus the diagnostic names `sensitivity`, `ppa`, `ppv`, `npa` and `opa`, with statements in the claimant's words. F1, AUC, WER, BLEU and composite scores are refused as `metric-not-supported`.
- Printed forms are read as written: `99.8%`, `~95%`, `99%+`, `at least 99%`, `<1%`, `95-98%`, `1 in 10,000` and the common wordings of each. The parsed form is returned as `parsedDisplay`, and the more favorable of `value` and the printed figure is the one judged. A bare `value` with no `display` is read at whole-percent precision or finer.
- Informational codes that never change a verdict: `precision-too-fine`, `claim-worse-than-counts`, `strata-not-reweighted` and `text-figure-differs`. `options.strictPrecision` and `options.conservative` make the stricter readings available.
- Malformed input throws (`TypeError` or `RangeError`) and never produces a verdict. An unknown key in any caller object throws and names the nearest valid key, so a misspelled option cannot switch a check off. The same holds for `wilsonInterval` and `gwetAC1`, whose `options` must be a plain object (a `Map` or `Date` throws instead of silently using the defaults). The result's `checks` says which optional checks ran: `agreement` reads `applied` only when a minimum was set or a statistic with a value and an `n` had its size checked, and `strata` only when two or more strata could be compared. Every key of `provenance.agreement` is validated, so a kit result still passes straight in and nonsense throws.
- A value computed in floating point (`1 - correct / n`, `percent / 100`, the mean of equal folds) is the figure it nearly is: a value is read within 2^-50 (about 9e-16) of the decimal it was computed as, on the sample path and on a complete set. A value within that of 0 or 1 is the absolute claim of 0% or 100% (ten `0.1`s added up is 100%, never a 99.5% sample's observed rate), and `1 in 1` is 100%, not a band.
- Echoed strings stay plain. Tag characters and variation selectors in a name, population identifier or stratum name throw, other invisible characters are dropped before the string is echoed, and error messages quote caller strings with every control, bidirectional or invisible character written as `\uXXXX`. Name matching ignores invisible characters, folds a Greek final sigma, and does not find a numeral name inside a percent figure. An agreement statistic is cut down, never rounded up, in a statement or a refusal, and a confidence written as `1 - alpha` prints as the level it means.
- Public declarations: `Claim.metric` also accepts the upper-case and capitalized forms of the refused metric names (`F1`, `AUC`, `Auc`) that the kit already recognizes at run time. No runtime export changed.
- Type export: `UnsupportedMetric` (the metric names that come back refused) is exported from the package root, because `Claim.metric` and `AccuracyAssessment.metric` use it. No runtime export changed.
- An `overstated` figure that sits on the cautious side of the observed rate (99.6% observed, printed as "99%") says so in its explanation, and names the two figures that would pass: the observed rate, or the conservative end. The verdict is unchanged.
- The Wilson upper limit stays below 1 whenever at least one item failed, at every size up to `Number.MAX_SAFE_INTEGER`, including when all but one item is right at about 4.5e15 items or more. A claim of 100% on all but one right is `contradicted`, like the mirror claim of 0% on one error, and its explanation says not every item was counted right.
- The text-figure scan reads the Arabic percent sign (U+066A) as `%`.
- Also exported: `wilsonInterval`, `zForConfidence`, `percentAgreement`, `cohenKappa`, `gwetAC1` (computed from integer counts, with a distinct `undefined` result instead of `NaN`), `maxDisplayDecimals`, and the constants `DEFAULT_CONFIDENCE`, `DEFAULT_MIN_N` and `COMPARISON_TOLERANCE`.
- No clock and no randomness: dates are passed in. Zero runtime dependencies. ESM, with type declarations, Node 20 or newer.

### Evidence

- Wilson intervals, percent agreement, Cohen's kappa and Gwet's AC1 match statsmodels, scipy, scikit-learn and irrCAC to 1e-12 over 8,899 Wilson cases and 1,500 two-rater tables (largest difference seen: 4.9e-15 for Wilson, 6.7e-14 for kappa).
- A field benchmark of 216 printed rates from 75 public FDA 510(k) summaries, with an independent oracle: 0 of 957 claims the counts do not carry were judged `supported`, 726 of 726 claims the counts carry were `supported`, and the kit equals the oracle on 2,001 of 2,001 judged claims.
- A holdout of 103 public claims from other sources, labeled by hand before the kit ran: the kit equals the label on 103 of 103.
- `npm run bench` reproduces these numbers from a clone. The README's "Agreement with an independent oracle and a hand-labeled holdout" section states what they do and do not show, and METHOD.md gives the measured false-flag or false-pass rate of each policy default.

### Documentation

- README: install, a first example that runs (with the reason a figure between the lower end and the observed rate is `overstated`), a TypeScript example with the node16 CommonJS note, the verdict table, printed forms and limits. It names what the text-figure scan does not read, that an exact rounding tie accepts both neighbors, and that echoed names are not judged.
- METHOD.md: the reason for each verdict and default, how to change it, measured rates, honest limits and a plain mapping to NIST AI 800-3, the FTC order against Workado and EU AI Act Article 15(3). The kit checks evidence; it does not certify truth or compliance.
- SECURITY.md: report vulnerabilities privately through GitHub private vulnerability reporting.
