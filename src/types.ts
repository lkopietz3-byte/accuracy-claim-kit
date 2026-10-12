import type { AgreementResult, AgreementStatistic } from './agreement.js'
import type { WilsonInterval } from './wilson.js'

/**
 * Proportions the kit can judge, with what `sample.n` counts for each:
 * accuracy (items checked), error-rate (items checked), precision (predicted
 * positives; `correct` are the true positives), recall (actual positives;
 * `correct` are the ones found), false-positive-rate (actual negatives;
 * `errors` are the false positives), false-negative-rate (actual positives;
 * `errors` are the misses).
 */
export type ClaimMetric =
  | 'accuracy'
  | 'error-rate'
  | 'precision'
  | 'recall'
  | 'false-positive-rate'
  | 'false-negative-rate'
/** Metrics the kit knows but refuses (`metric-not-supported`) instead of throwing. */
export type UnsupportedMetric =
  | 'f1' | 'auc' | 'roc-auc' | 'wer' | 'cer' | 'bleu' | 'rouge' | 'map' | 'composite' | 'other'
/**
 * Where the labels came from. `by-construction` means the ground truth was fixed by how
 * the data was made (text from a known generator, labels taken from a corpus's language);
 * it is accepted like `human` and is a declaration the kit cannot verify. `automated` means a deterministic procedure with
 * known correct answers (a test suite, an exact search), never a model's judgment.
 */
export type LabelSource = 'human' | 'automated' | 'by-construction' | 'model' | 'mixed' | 'unknown'
/**
 * How the items were chosen. `complete` means the sample is the whole of a
 * fixed, named set (a benchmark): the count is exact and no interval is used.
 * `held-out-split` is the same for a fixed named test split. `cross-validation`
 * is judged like `random`; folds are not independent, so the interval is optimistic.
 */
export type SamplingMethod =
  | 'random'
  | 'stratified'
  | 'ranked'
  | 'convenience'
  | 'unknown'
  | 'complete'
  | 'held-out-split'
  | 'cross-validation'

export interface Claim {
  metric: ClaimMetric | UnsupportedMetric
  /** The claimed rate as a proportion from 0 to 1 (0.998 means 99.8%). */
  value: number
  /**
   * How the claim is printed, as a percent string such as "99.8%". When given,
   * it must agree with `value` to the printed precision, and its number of
   * decimals is checked against what the interval can support.
   */
  display?: string | undefined
  /**
   * The claim's wording, used only for `sampling: 'complete'`: it must name the
   * benchmark, or the claim is refused as an unscoped general claim. At most 2000 characters.
   */
  text?: string | undefined
}

/**
 * Counts for a sample. Give `correct` or `errors` (or both, if they add up to n).
 * Both metrics accept either field.
 */
export interface SampleCounts {
  n: number
  correct?: number | undefined
  errors?: number | undefined
}

/** A reported agreement statistic: a result from this kit, or a plain {statistic, value}. */
export type AgreementInput =
  | AgreementResult
  | { statistic: AgreementStatistic; value: number; status?: 'defined' | undefined }

export interface LabelProvenance {
  source: LabelSource
  /** Number of independent human raters, if known. */
  raters?: number | undefined
  agreement?: AgreementInput | undefined
}

export interface Stratum extends SampleCounts {
  name: string
}

export interface Retractions {
  /** Labels or records known to have been retracted. */
  count: number
  /** Whether those retracted items are counted in the sample (as failures where they were wrong). */
  includedInSample: boolean
}

/** The fixed set a `complete` claim is about. */
export interface Benchmark {
  /** Name of the set, as the claim text must mention it (at most 200 characters). */
  name: string
}

/** What the claim says it covers, and what was actually evaluated. Compared after Unicode and case folding. */
export interface PopulationScope {
  claimed: string
  evaluated: string
}

export interface AccuracyClaimInput {
  claim: Claim
  /** Omit it (or leave out n and the counts) when the source does not say; the result is refused with `n-undisclosed`. */
  sample?: SampleCounts | undefined
  provenance: LabelProvenance
  sampling: SamplingMethod
  strata?: readonly Stratum[] | undefined
  retractions?: Retractions | undefined
  /** Required with `sampling: 'complete'` or `'held-out-split'`; rejected with any other sampling. */
  benchmark?: Benchmark | undefined
  /** Claimed versus evaluated population; a mismatch is refused. */
  population?: PopulationScope | undefined
  /** Date the evaluation was run, "YYYY-MM-DD". Used with `options.maxAgeDays`. */
  evaluatedAt?: string | undefined
}

export interface AssessOptions {
  /** Two-sided confidence level for the Wilson interval, from 0.5 up to (not including) 1. Default 0.95. A lower level throws: it is almost always a typo. */
  confidence?: number | undefined
  /** Smallest sample size that can get a verdict. Default 30. Whole number, at least 1. */
  minN?: number | undefined
  /** If given, the supplied agreement statistic must be at least this value (from -1 to 1). */
  minAgreement?: number | undefined
  /** Refuse an evaluation older than this many days (whole number, 0 or more). Needs `now`. */
  maxAgeDays?: number | undefined
  /** Reference date "YYYY-MM-DD" for `maxAgeDays`. The kit never reads a clock. */
  now?: string | undefined
  /**
   * Make excess printed precision (`precision-too-fine`) change a supported claim to
   * overstated. By default it is only noted. Implied by `conservative`.
   */
  strictPrecision?: boolean | undefined
  /** Restore the strict rule: supported only at or below the interval's conservative end. Default false. */
  conservative?: boolean | undefined
  /** Refuse a claim that does not declare `population`. Default false. */
  requireScope?: boolean | undefined
}

export type AccuracyVerdict = 'supported' | 'overstated' | 'contradicted' | 'refused'

export type ReasonCode =
  // refused
  | 'no-human-labels'
  | 'unknown-label-source'
  | 'mixed-label-source'
  | 'ranked-sample'
  | 'convenience-sample'
  | 'unknown-sampling'
  | 'sample-too-small'
  | 'merged-strata-differ'
  | 'retractions-not-included'
  | 'agreement-missing'
  | 'agreement-undefined'
  | 'agreement-below-minimum'
  | 'metric-not-supported'
  | 'n-undisclosed'
  | 'stratified-without-strata'
  | 'benchmark-unnamed'
  | 'claim-not-scoped-to-benchmark'
  | 'evaluation-date-missing'
  | 'evaluation-stale'
  | 'scope-mismatch'
  | 'scope-undeclared'
  // contradicted
  | 'claim-outside-interval'
  | 'claim-differs-from-count'
  // overstated
  | 'claim-beyond-conservative-bound'
  | 'precision-too-fine'
  // supported
  | 'claim-within-bound'
  | 'census-matches-count'
  | 'matches-observed-rate'
  // informational, never changes the verdict
  | 'claim-worse-than-counts'

/** Whether an optional check ran for this call. */
export type GateStatus = 'applied' | 'not-supplied'

/**
 * Which optional checks the call ran, so a check that was left out is visible
 * in the result. `retractions`: a `retractions` block was supplied. `scope`: a
 * `population` was supplied. `age`: `options.maxAgeDays` was set. `agreement`:
 * `options.minAgreement` was set (a statistic that is only echoed is not a
 * check). `strata`: `strata` were supplied for a sample (a complete set does
 * not compare strata).
 */
export interface GateChecks {
  retractions: GateStatus
  scope: GateStatus
  age: GateStatus
  agreement: GateStatus
  strata: GateStatus
}

export interface AccuracyAssessment {
  verdict: AccuracyVerdict
  /** At least one code. A refusal lists every failed precondition. */
  reasons: ReasonCode[]
  /** One plain sentence per reason, in the same order. */
  explanation: string[]
  metric: ClaimMetric | UnsupportedMetric
  /** The claim's `value` as supplied. */
  claimed: number
  /**
   * The figure that was judged: the more favorable of `value` and the parsed
   * `display` (the higher for accuracy, the lower for error rate). Equal to
   * `claimed` when there is no display or the value is already the more favorable.
   */
  assessedValue: number
  /** Items in the sample; null when the counts were not disclosed. */
  n: number | null
  /** How the printed `display` was read, or null when there was none. */
  parsedDisplay: { form: 'percent' | 'approx' | 'floor' | 'ceiling' | 'range' | 'one-in-n'; figure: number; decimals: number | null } | null
  /** Which optional checks ran: `applied`, or `not-supplied` when the input or option that switches the check on was left out. */
  checks: GateChecks
  /** `wilson-interval`: judged against an interval. `census`: compared with the exact count of a complete set. `none`: refused. */
  basis: 'wilson-interval' | 'census' | 'none'
  /** Wilson interval for the claimed metric (accuracy, or error rate). Null when refused or for a census. */
  interval: WilsonInterval | null
  /** The end of the interval a claim should not beat: lower for accuracy, upper for error rate. Null when refused. */
  conservativeBound: number | null
  /** Plain text that describes the evidence only. For a refusal it says why no figure can be given. */
  suggestedStatement: string
}
