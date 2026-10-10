import type { AgreementResult, AgreementStatistic } from './agreement.js'
import type { WilsonInterval } from './wilson.js'

export type ClaimMetric = 'accuracy' | 'error-rate'
export type LabelSource = 'human' | 'model' | 'mixed' | 'unknown'
export type SamplingMethod = 'random' | 'stratified' | 'ranked' | 'convenience' | 'unknown'

export interface Claim {
  metric: ClaimMetric
  /** The claimed rate as a proportion from 0 to 1 (0.998 means 99.8%). */
  value: number
  /**
   * How the claim is printed, as a percent string such as "99.8%". When given,
   * it must agree with `value` to the printed precision, and its number of
   * decimals is checked against what the interval can support.
   */
  display?: string | undefined
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

export interface AccuracyClaimInput {
  claim: Claim
  sample: SampleCounts
  provenance: LabelProvenance
  sampling: SamplingMethod
  strata?: readonly Stratum[] | undefined
  retractions?: Retractions | undefined
}

export interface AssessOptions {
  /** Two-sided confidence level for the Wilson interval, strictly between 0 and 1. Default 0.95. */
  confidence?: number | undefined
  /** Smallest sample size that can get a verdict. Default 30. Whole number, at least 1. */
  minN?: number | undefined
  /** If given, the supplied agreement statistic must be at least this value (from -1 to 1). */
  minAgreement?: number | undefined
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
  // contradicted
  | 'claim-outside-interval'
  // overstated
  | 'claim-beyond-conservative-bound'
  | 'precision-too-fine'
  // supported
  | 'claim-within-bound'

export interface AccuracyAssessment {
  verdict: AccuracyVerdict
  /** At least one code. A refusal lists every failed precondition. */
  reasons: ReasonCode[]
  /** One plain sentence per reason, in the same order. */
  explanation: string[]
  metric: ClaimMetric
  /** The claim's `value` as supplied. */
  claimed: number
  /**
   * The figure that was judged: the more favorable of `value` and the parsed
   * `display` (the higher for accuracy, the lower for error rate). Equal to
   * `claimed` when there is no display or the value is already the more favorable.
   */
  assessedValue: number
  n: number
  /** Wilson interval for the claimed metric (accuracy, or error rate). Null when refused. */
  interval: WilsonInterval | null
  /** The end of the interval a claim should not beat: lower for accuracy, upper for error rate. Null when refused. */
  conservativeBound: number | null
  /** Plain text that describes the evidence only. For a refusal it says why no figure can be given. */
  suggestedStatement: string
}
