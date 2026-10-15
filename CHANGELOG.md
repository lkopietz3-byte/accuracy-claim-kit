# Changelog

## [0.1.0] - 2026-10-14

First release. MIT licensed.

### What it does

- `assessAccuracyClaim` judges a published accuracy or error-rate figure against the counts behind it and returns one of four verdicts: `supported`, `overstated`, `contradicted` or `refused`. Every result has reason codes, one plain sentence per code, and a cautious suggested statement that begins `On this sample` and says the interval covers sampling error only.
- `refused` means "cannot tell", never "false". It outranks every other verdict, lists every failed precondition and returns no interval. Preconditions: counts disclosed, human or deterministic labels, random or stratified or named whole-set sampling, `n` at or above `minN` (default 30), strata that do not clearly differ, known retractions included, and optional gates for agreement, age and scope.
- Sample claims are compared with the Wilson interval (95% by default). A figure equal to the observed rate to its printed precision is `supported` (`matches-observed-rate`). Bounds such as `99%+` and `<1%`, and absolute claims of 0% or 100%, are never excused that way.
- Claims about a whole fixed set (`sampling: 'complete'` or `'held-out-split'`, with `benchmark.name` and wording that names the set) are compared with the exact count, with no interval.
- Metrics: accuracy, error rate, precision, recall, false positive rate, false negative rate, specificity and NPV, plus the diagnostic names `sensitivity`, `ppa`, `ppv`, `npa` and `opa`, with statements in the claimant's words. F1, AUC, WER, BLEU and composite scores are refused as `metric-not-supported`.
- Printed forms are read as written: `99.8%`, `~95%`, `99%+`, `at least 99%`, `<1%`, `95-98%`, `1 in 10,000` and the common wordings of each. The parsed form is returned as `parsedDisplay`, and the more favorable of `value` and the printed figure is the one judged. A bare `value` with no `display` is read at whole-percent precision or finer.
- Informational codes that never change a verdict: `precision-too-fine`, `claim-worse-than-counts`, `strata-not-reweighted` and `text-figure-differs`. `options.strictPrecision` and `options.conservative` make the stricter readings available.
- Malformed input throws (`TypeError` or `RangeError`) and never produces a verdict. An unknown key in any caller object throws and names the nearest valid key, so a misspelled option cannot switch a check off. The result's `checks` says which optional checks ran.
- Also exported: `wilsonInterval`, `zForConfidence`, `percentAgreement`, `cohenKappa`, `gwetAC1` (computed from integer counts, with a distinct `undefined` result instead of `NaN`), `maxDisplayDecimals`, and the constants `DEFAULT_CONFIDENCE`, `DEFAULT_MIN_N` and `COMPARISON_TOLERANCE`.
- No clock and no randomness: dates are passed in. Zero runtime dependencies. ESM, with type declarations, Node 20 or newer.

### Evidence

- Wilson intervals, percent agreement, Cohen's kappa and Gwet's AC1 match statsmodels, scipy, scikit-learn and irrCAC to 1e-12 over 8,899 Wilson cases and 1,500 two-rater tables (largest difference seen: 4.9e-15 for Wilson, 6.7e-14 for kappa).
- A field benchmark of 216 printed rates from 75 public FDA 510(k) summaries, with an independent oracle: 0 of 957 claims the counts do not carry were judged `supported`, 726 of 726 claims the counts carry were `supported`, and the kit equals the oracle on 2,001 of 2,001 judged claims.
- A holdout of 103 public claims from other sources, labeled by hand before the kit ran: the kit equals the label on 103 of 103.
- `npm run bench` reproduces these numbers from a clone. The README's "Accuracy on real data" section states what they do and do not show, and METHOD.md gives the measured false-flag or false-pass rate of each policy default.

### Documentation

- README: install, a first example that runs, the verdict table, printed forms and limits.
- METHOD.md: the reason for each verdict and default, how to change it, measured rates, honest limits and a plain mapping to NIST AI 800-3, the FTC order against Workado and EU AI Act Article 15(3). The kit checks evidence; it does not certify truth or compliance.
- SECURITY.md: report vulnerabilities privately through GitHub private vulnerability reporting.
