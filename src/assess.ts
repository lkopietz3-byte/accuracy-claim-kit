import type { AgreementStatistic, UndefinedAgreementReason } from './agreement.js'
import { countDecimals, matchesValue } from './census.js'
import { dayNumber } from './dates.js'
import { parseDisplayFigure, textFiguresDiffering } from './display.js'
import { beyondNoise, snapAbsolute, VALUE_NOISE } from './exact.js'
import type { DisplayFigure } from './display.js'
import { confidenceLabel, decimalCut, maxDisplayDecimals, pctCeil, pctFloor, pctNearest } from './format.js'
import type {
  AccuracyAssessment,
  AccuracyClaimInput,
  AccuracyVerdict,
  AssessOptions,
  ClaimMetric,
  GateChecks,
  UnsupportedMetric,
  LabelSource,
  ReasonCode,
  SamplingMethod,
} from './types.js'
import {
  clip,
  isRecord,
  MAX_COUNT,
  readCount,
  readFiniteInRange,
  readLength,
  assertKnownKeys,
  assertPlainObject,
  readOpenUnit,
  requireRecord,
} from './validate.js'
import { assertPlainText, foldText, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, mentionsName, readName, shownText } from './text.js'
import { DEFAULT_CONFIDENCE, wilsonWithZ, zForConfidence, zForTail } from './wilson.js'

/** Lowest confidence level `assessAccuracyClaim` accepts. `wilsonInterval` takes any level strictly between 0 and 1. */
const MIN_ASSESS_CONFIDENCE = 0.5

/** Smallest sample that gets a verdict unless options.minN says otherwise. */
export const DEFAULT_MIN_N = 30

/**
 * Absolute tolerance, as a proportion, when a claim is compared with an
 * interval limit. A claim within this distance of a limit counts as being at
 * the limit, on the claimant's side. It exists only to absorb binary
 * floating-point noise (a claim of exactly 0.98 against a limit that
 * computes to 0.98000000000000001). It is far below the width of any
 * interval met in practice; it can only matter for samples above about 4e12
 * items with a rate within about 1e-12 of 0 or 1, where the interval itself
 * is narrower than the tolerance. A claim of exactly 0 or 1 is absolute and
 * never uses it.
 */
export const COMPARISON_TOLERANCE = 1e-12

const SOURCES: readonly LabelSource[] = ['human', 'automated', 'by-construction', 'model', 'mixed', 'unknown']
const SAMPLINGS: readonly SamplingMethod[] = ['random', 'stratified', 'ranked', 'convenience', 'unknown', 'complete', 'held-out-split', 'cross-validation']
const METRICS: readonly ClaimMetric[] = [
  'accuracy',
  'error-rate',
  'precision',
  'recall',
  'false-positive-rate',
  'false-negative-rate',
  'specificity',
  'npv',
  'sensitivity',
  'ppa',
  'ppv',
  'npa',
  'opa',
]
/** Metrics the kit knows it cannot judge: they get a refusal, not a throw. */
const UNSUPPORTED_METRICS: readonly UnsupportedMetric[] = [
  'f1', 'auc', 'roc-auc', 'wer', 'cer', 'bleu', 'rouge', 'map', 'composite', 'other',
]
const HIGHER_IS_BETTER: readonly ClaimMetric[] = ['accuracy', 'precision', 'recall', 'specificity', 'npv', 'sensitivity', 'ppa', 'ppv', 'npa', 'opa']
const METRIC_PHRASE: Record<ClaimMetric, string> = {
  accuracy: 'accurate',
  'error-rate': 'error rate',
  precision: 'precision',
  recall: 'recall',
  'false-positive-rate': 'false-positive rate',
  'false-negative-rate': 'false-negative rate',
  specificity: 'specificity',
  npv: 'negative predictive value',
  sensitivity: 'sensitivity',
  ppa: 'positive percent agreement',
  ppv: 'positive predictive value',
  npa: 'negative percent agreement',
  opa: 'overall percent agreement',
}
/** What a bare value (no display) is read at; nothing was printed, so the text must not say so. */
const VALUE_PRECISION = 'the precision of the value (a whole percent at the coarsest)'
const SUPPORTED_LIST = 'accuracy, error-rate, precision, recall, false-positive-rate, false-negative-rate, specificity, npv and the diagnostic names sensitivity, ppa, ppv, npa and opa'
// The keys each caller-supplied object may carry. Anything else is a typo that
// would silently switch a check off, so it throws.
const OPTION_KEYS = ['confidence', 'minN', 'minAgreement', 'maxAgeDays', 'now', 'strictPrecision', 'conservative', 'requireScope'] as const
const INPUT_KEYS = ['claim', 'sample', 'provenance', 'sampling', 'strata', 'retractions', 'benchmark', 'population', 'evaluatedAt'] as const
const CLAIM_KEYS = ['metric', 'value', 'display', 'text'] as const
const SAMPLE_KEYS = ['n', 'correct', 'errors'] as const
const STRATUM_KEYS = ['name', 'n', 'correct', 'errors'] as const
const PROVENANCE_KEYS = ['source', 'raters', 'agreement'] as const
const AGREEMENT_KEYS = ['statistic', 'status', 'value', 'n', 'agreements', 'categories', 'reason'] as const
const RETRACTION_KEYS = ['count', 'includedInSample'] as const
const BENCHMARK_KEYS = ['name'] as const
const POPULATION_KEYS = ['claimed', 'evaluated'] as const
const STATISTICS: readonly AgreementStatistic[] = ['percent-agreement', 'cohen-kappa', 'gwet-ac1']
const UNDEFINED_REASONS: readonly UndefinedAgreementReason[] = ['no-pairs', 'expected-agreement-is-1', 'single-category']
const STATISTIC_LABEL: Record<AgreementStatistic, string> = {
  'percent-agreement': 'percent agreement',
  'cohen-kappa': 'Cohen kappa',
  'gwet-ac1': 'Gwet AC1',
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  const found = allowed.find((candidate) => candidate === value)
  if (found === undefined) {
    throw new RangeError(`${name} must be one of ${allowed.join(', ')}; got "${clip(value)}"`)
  }
  return found
}

/**
 * The metric: judged (exact, lower-case name), known-unsupported (refused
 * later; case does not matter, since such a name can only be refused), or
 * unknown (thrown). A judged name in the wrong case is a typo that throws, with
 * the name the caller probably meant.
 */
function readMetric(raw: unknown): { metric: ClaimMetric | UnsupportedMetric; judged: boolean } {
  if (typeof raw !== 'string') throw new TypeError('claim.metric must be a string')
  const supported = METRICS.find((m) => m === raw)
  if (supported !== undefined) return { metric: supported, judged: true }
  const lower = raw.toLowerCase()
  const unsupported = UNSUPPORTED_METRICS.find((m) => m === lower)
  if (unsupported !== undefined) return { metric: unsupported, judged: false }
  const meant = METRICS.find((m) => m === lower)
  const hint = meant === undefined ? '' : `; did you mean "${meant}"?`
  throw new RangeError(
    `claim.metric must be one of ${METRICS.join(', ')}, or one of ${UNSUPPORTED_METRICS.join(', ')} (which the kit knows and refuses, in any case); got "${clip(raw)}"${hint}`,
  )
}

interface Counts {
  n: number
  correct: number
}

/** Reads {n, correct?, errors?} for the sample; null when no counts were disclosed at all. */
function readSampleCounts(raw: unknown): Counts | null {
  if (raw === undefined) return null
  const rec = requireRecord(raw, 'sample')
  assertKnownKeys(rec, SAMPLE_KEYS, 'sample')
  const nRaw: unknown = rec.n
  const correctRaw: unknown = rec.correct
  const errorsRaw: unknown = rec.errors
  if (nRaw === undefined && correctRaw === undefined && errorsRaw === undefined) return null
  return readCounts({ n: nRaw, correct: correctRaw, errors: errorsRaw }, 'sample')
}

/** Reads {n, correct?, errors?}; each property once. */
function readCounts(raw: unknown, name: string): Counts {
  const rec = requireRecord(raw, name)
  const nRaw: unknown = rec.n
  const correctRaw: unknown = rec.correct
  const errorsRaw: unknown = rec.errors
  const n = readCount(nRaw, `${name}.n`, 1)
  if (correctRaw === undefined && errorsRaw === undefined) {
    throw new TypeError(`${name} needs correct or errors`)
  }
  const correct = correctRaw === undefined ? undefined : readCount(correctRaw, `${name}.correct`, 0)
  const errors = errorsRaw === undefined ? undefined : readCount(errorsRaw, `${name}.errors`, 0)
  if (correct !== undefined && correct > n) {
    throw new RangeError(`${name}.correct (${String(correct)}) is larger than n (${String(n)})`)
  }
  if (errors !== undefined && errors > n) {
    throw new RangeError(`${name}.errors (${String(errors)}) is larger than n (${String(n)})`)
  }
  if (correct !== undefined && errors !== undefined && correct + errors !== n) {
    throw new RangeError(`${name}.correct + ${name}.errors must equal n`)
  }
  return { n, correct: correct !== undefined ? correct : n - (errors as number) }
}

interface Agreement {
  statistic: AgreementStatistic
  value: number | null
  /** Items the statistic was computed on; null for a hand-written {statistic, value}, which is trusted. */
  n: number | null
}

function readAgreement(raw: unknown): Agreement {
  const rec = requireRecord(raw, 'provenance.agreement')
  assertKnownKeys(rec, AGREEMENT_KEYS, 'provenance.agreement')
  const statisticRaw: unknown = rec.statistic
  const statusRaw: unknown = rec.status
  const valueRaw: unknown = rec.value
  const nRaw: unknown = rec.n
  const agreementsRaw: unknown = rec.agreements
  const categoriesRaw: unknown = rec.categories
  const reasonRaw: unknown = rec.reason
  const statistic = readEnum(statisticRaw, STATISTICS, 'provenance.agreement.statistic')
  if (statusRaw !== undefined && statusRaw !== 'defined' && statusRaw !== 'undefined') {
    throw new RangeError('provenance.agreement.status must be "defined" or "undefined"')
  }
  const n = nRaw === undefined ? null : readCount(nRaw, 'provenance.agreement.n', 0)
  // The keys a kit result carries are allowed so it can be passed straight in; they
  // are not used, but nonsense in them means the object is not what it claims to be.
  const agreements = agreementsRaw === undefined ? null : readCount(agreementsRaw, 'provenance.agreement.agreements', 0)
  if (agreements !== null && n !== null && agreements > n) {
    throw new RangeError(`provenance.agreement.agreements (${String(agreements)}) is larger than provenance.agreement.n (${String(n)})`)
  }
  if (categoriesRaw !== undefined) readCount(categoriesRaw, 'provenance.agreement.categories', 0)
  if (reasonRaw !== undefined) readEnum(reasonRaw, UNDEFINED_REASONS, 'provenance.agreement.reason')
  if (statusRaw === 'undefined') {
    // A statistic that has no value must say so with null; NaN, 0 or text in
    // its place is malformed input, not "cannot tell".
    if (valueRaw !== null) {
      const message = 'provenance.agreement.value must be null when status is "undefined"'
      throw typeof valueRaw === 'number' ? new RangeError(message) : new TypeError(message)
    }
    return { statistic, value: null, n }
  }
  return { statistic, value: readFiniteInRange(valueRaw, 'provenance.agreement.value', -1, 1), n }
}

interface Stratum {
  name: string
  n: number
  correct: number
}

function readStrata(raw: unknown): Stratum[] {
  if (!Array.isArray(raw)) throw new TypeError('strata must be an array')
  const length = readLength((raw as unknown[]).length, 'strata')
  if (length === 0) throw new RangeError('strata must not be empty; leave it out if there are none')
  const out: Stratum[] = []
  const names = new Set<string>()
  for (let i = 0; i < length; i++) {
    const entry: unknown = (raw as unknown[])[i]
    const rec = requireRecord(entry, `strata[${i}]`)
    assertKnownKeys(rec, STRATUM_KEYS, `strata[${i}]`)
    const nameRaw: unknown = rec.name
    if (typeof nameRaw !== 'string') throw new TypeError(`strata[${i}].name must be a string`)
    if (nameRaw === '') throw new RangeError(`strata[${i}].name must not be empty`)
    if (nameRaw.length > MAX_LABEL_LENGTH) {
      throw new RangeError(`strata[${i}].name must be at most ${String(MAX_LABEL_LENGTH)} characters`)
    }
    const name = shownText(nameRaw, `strata[${i}].name`)
    if (name === '') throw new RangeError(`strata[${i}].name must not be blank`)
    if (names.has(name)) throw new RangeError(`strata[${i}].name "${clip(name)}" is a duplicate`)
    names.add(name)
    const counts = readCounts(rec, `strata[${i}]`)
    out.push({ name, ...counts })
  }
  return out
}

const REFUSAL_PHRASE: Record<string, string> = {
  'metric-not-supported': 'this kit cannot judge that kind of metric',
  'n-undisclosed': 'the number of items checked was not disclosed',
  'no-human-labels': 'the labels were not checked by people',
  'unknown-label-source': 'nobody has said where the labels came from',
  'mixed-label-source': 'only some labels came from people and the counts are not split',
  'ranked-sample': 'the sample was picked by rank, not at random',
  'convenience-sample': 'the sample was whatever was easy to collect',
  'unknown-sampling': 'nobody has said how the sample was picked',
  'sample-too-small': 'the sample is too small',
  'merged-strata-differ': 'groups with clearly different rates were merged into one number',
  'retractions-not-included': 'known retractions are not in the counts',
  'agreement-missing': 'no agreement statistic was supplied for the required agreement check',
  'agreement-undefined': 'the agreement statistic could not be computed',
  'agreement-below-minimum': 'the raters agreed less than the required minimum',
  'agreement-sample-too-small': 'the agreement statistic was computed on too few items',
  'stratified-without-strata': 'the sample is stratified but the strata were not supplied, so the pooled counts cannot be read as the population rate',
  'benchmark-unnamed': 'a complete-set or held-out-split claim needs the name of the fixed set',
  'claim-not-scoped-to-benchmark': 'the claim wording does not name the benchmark, so a benchmark score is standing in for a general claim',
  'evaluation-date-missing': 'a maximum age was set but the evaluation date was not supplied',
  'evaluation-stale': 'the evaluation is older than the allowed age',
  'scope-mismatch': 'the claim covers a different population than the one evaluated',
  'scope-undeclared': 'the claimed and evaluated populations were not declared',
}

const LABEL_WORD: Record<'human' | 'automated' | 'by-construction', string> = {
  human: 'human labels',
  automated: 'automated labels',
  'by-construction': 'labels fixed by construction',
}

/** What the interval in a statement does and does not cover, said in the statement itself. */
const SAMPLING_ERROR_ONLY = 'the interval covers sampling error only'
const SAMPLING_ERROR_ONLY_CV = 'the interval covers sampling error only and is optimistic because cross-validation folds share data'

const SAMPLE_WORD: Partial<Record<SamplingMethod, string>> = {
  stratified: 'stratified sample, unweighted pooled',
  'cross-validation': 'cross-validation estimate',
}

/** "1 decimal place", "2 decimal places"; whole percents have none. */
function placesWord(decimals: number): string {
  return decimals === 1 ? '1 decimal place' : `${String(decimals)} decimal places`
}
/** What a precision limit allows: "whole percents only", "at most 1 decimal place". */
function supportsWord(decimals: number): string {
  return decimals === 0 ? 'whole percents only' : `at most ${placesWord(decimals)}`
}
/** The statement's advice on how to print the figure. */
function printAdvice(decimals: number): string {
  return decimals === 0 ? '; print it as a whole percent' : `; print it to at most ${placesWord(decimals)}`
}

/**
 * The informational note for a figure in `claim.text` that is not the figure
 * judged (`text-figure-differs`), or null. The text is only scanned: a verdict
 * is never changed by it.
 */
function textFigureNote(text: string | undefined, claimed: number, assessed: number, higherIsBetter: boolean): string | null {
  if (text === undefined) return null
  const differing = textFiguresDiffering(text, claimed, assessed, higherIsBetter)
  if (differing.length === 0) return null
  const shown = differing.slice(0, 3).map((figure) => `"${clip(figure, 40)}"`).join(', ')
  const more = differing.length > 3 ? ` and ${String(differing.length - 3)} more` : ''
  return `claim.text says ${shown}${more}, which is not the figure judged (${pctNearest(assessed, 3)}). The verdict judges value and display, never the wording, so make the text say what was judged.`
}

/**
 * Does this accuracy or error-rate claim have the evidence to carry it?
 *
 * Pure statistics on the counts you pass in. It never judges whether the
 * labels are right and cannot see how the sample was really drawn; it takes
 * your `provenance` and `sampling` declarations at their word and refuses
 * when they do not support a figure.
 *
 * Verdicts:
 *  - refused: a precondition failed. This means "cannot tell", not "false".
 *  - contradicted: the claim is more favorable than the interval's best end.
 *  - overstated: inside the interval but more favorable than the observed
 *    rate (or, with options.conservative, than the conservative end), or
 *    printed with finer precision than the interval allows.
 *  - supported: no more favorable than the conservative end, or an honest
 *    report of the observed rate to its printed precision.
 *
 * Malformed input throws (TypeError for a wrong type, RangeError for a wrong
 * value); it never returns a verdict. Every input property is read once.
 */
export function assessAccuracyClaim(
  input: AccuracyClaimInput,
  options?: AssessOptions,
): AccuracyAssessment {
  // ---- read and validate everything before judging anything -------------
  if (options !== undefined && !isRecord(options)) {
    throw new TypeError('options must be an object')
  }
  if (options !== undefined) {
    assertPlainObject(options, 'options')
    assertKnownKeys(options, OPTION_KEYS, 'options')
  }
  const confidenceRaw: unknown = options === undefined ? undefined : options.confidence
  const minNRaw: unknown = options === undefined ? undefined : options.minN
  const minAgreementRaw: unknown = options === undefined ? undefined : options.minAgreement
  const confidence =
    confidenceRaw === undefined ? DEFAULT_CONFIDENCE : readOpenUnit(confidenceRaw, 'options.confidence')
  // A level below one half is a typo (0.05 for 0.95): its "interval" is narrower
  // than the data's own noise and an "at least" statement built on it means nothing.
  if (confidence < MIN_ASSESS_CONFIDENCE) {
    throw new RangeError(`options.confidence must be at least ${String(MIN_ASSESS_CONFIDENCE)} for a verdict (0.95 is the default); got ${String(confidence)}`)
  }
  const z = zForConfidence(confidence)
  const minN = minNRaw === undefined ? DEFAULT_MIN_N : readCount(minNRaw, 'options.minN', 1)
  const minAgreement =
    minAgreementRaw === undefined ? undefined : readFiniteInRange(minAgreementRaw, 'options.minAgreement', -1, 1)
  const maxAgeRaw: unknown = options === undefined ? undefined : options.maxAgeDays
  const nowRaw: unknown = options === undefined ? undefined : options.now
  const requireScopeRaw: unknown = options === undefined ? undefined : options.requireScope
  const conservativeRaw: unknown = options === undefined ? undefined : options.conservative
  const strictPrecisionRaw: unknown = options === undefined ? undefined : options.strictPrecision
  const maxAgeDays = maxAgeRaw === undefined ? undefined : readCount(maxAgeRaw, 'options.maxAgeDays', 0)
  if (maxAgeDays !== undefined && nowRaw === undefined) {
    throw new TypeError('options.now is required with options.maxAgeDays: the kit never reads a clock')
  }
  const nowDay = nowRaw === undefined ? undefined : dayNumber(nowRaw, 'options.now')
  if (requireScopeRaw !== undefined && typeof requireScopeRaw !== 'boolean') {
    throw new TypeError('options.requireScope must be a boolean')
  }
  if (conservativeRaw !== undefined && typeof conservativeRaw !== 'boolean') {
    throw new TypeError('options.conservative must be a boolean')
  }
  if (strictPrecisionRaw !== undefined && typeof strictPrecisionRaw !== 'boolean') {
    throw new TypeError('options.strictPrecision must be a boolean')
  }
  const requireScope = requireScopeRaw === true
  const conservative = conservativeRaw === true
  // Excess printed precision is informational unless asked for, or in conservative mode.
  const strictPrecision = strictPrecisionRaw === true || conservative

  const root = requireRecord(input, 'input')
  assertKnownKeys(root, INPUT_KEYS, 'input')
  const claimRaw: unknown = root.claim
  const sampleRaw: unknown = root.sample
  const provenanceRaw: unknown = root.provenance
  const samplingRaw: unknown = root.sampling
  const strataRaw: unknown = root.strata
  const retractionsRaw: unknown = root.retractions
  const benchmarkRaw: unknown = root.benchmark
  const populationRaw: unknown = root.population
  const evaluatedAtRaw: unknown = root.evaluatedAt

  const claimRec = requireRecord(claimRaw, 'claim')
  assertKnownKeys(claimRec, CLAIM_KEYS, 'claim')
  const metricRaw: unknown = claimRec.metric
  const valueRaw: unknown = claimRec.value
  const displayRaw: unknown = claimRec.display
  const textRaw: unknown = claimRec.text

  // The metric: judged, or known-unsupported (refused below), or a typo (thrown).
  const { metric, judged } = readMetric(metricRaw)
  const higherIsBetter = judged && HIGHER_IS_BETTER.includes(metric as ClaimMetric)

  // A value is a proportion from 0 to 1 for a judged metric. An unsupported
  // metric (a word error rate can pass 1) only needs to be a number.
  const claimed = readFiniteInRange(valueRaw, 'claim.value', -Infinity, Infinity)
  // A value within the floating-point noise of 0 or 1 is the absolute claim of 0 or
  // 1 (ten 0.1s added up is 100%, not "99.99999999999999% so matches 99.5%"), and
  // that includes a computed value that overshoots by the noise (1.0000000000000002).
  // Further out it is not a proportion. `claimed` stays as supplied for the result;
  // every judgment uses `judgedValue`.
  if (judged && (claimed < -VALUE_NOISE || claimed > 1 + VALUE_NOISE)) {
    throw new RangeError(`claim.value must be a finite number between 0 and 1, got ${String(claimed)}`)
  }
  const judgedValue = judged ? snapAbsolute(claimed) : claimed

  if (displayRaw !== undefined && typeof displayRaw !== 'string') throw new TypeError('claim.display must be a string')
  let figure: DisplayFigure | undefined
  if (displayRaw !== undefined && judged) {
    figure = parseDisplayFigure(displayRaw, higherIsBetter)
    // Exact: the value must agree with the printed figure to its rounding plus
    // one ulp of the value. No float tolerance is involved.
    if (!figure.consistentWith(judgedValue)) {
      throw new RangeError(
        `claim.display "${clip(displayRaw, 40)}" (${pctNearest(figure.info.figure, 3).replace(/\.?0+%$/, '%')}) does not match claim.value ${String(claimed)} (${pctNearest(claimed, 3).replace(/\.?0+%$/, '%')}): ${figure.mismatchHint}`,
      )
    }
  }
  const displayIsPoint = figure !== undefined && figure.bound === null
  const displayDecimals =
    figure !== undefined && figure.info.form !== 'one-in-n' && figure.bound === null ? figure.info.decimals : null

  let claimText: string | undefined
  if (textRaw !== undefined) {
    if (typeof textRaw !== 'string') throw new TypeError('claim.text must be a string')
    if (textRaw.length > MAX_TEXT_LENGTH) throw new RangeError(`claim.text must be at most ${String(MAX_TEXT_LENGTH)} characters`)
    assertPlainText(textRaw, 'claim.text', 'put the claim on one line (join the lines with spaces) before passing it')
    claimText = textRaw
  }

  const sampleCounts = readSampleCounts(sampleRaw)

  const provRec = requireRecord(provenanceRaw, 'provenance')
  assertKnownKeys(provRec, PROVENANCE_KEYS, 'provenance')
  const sourceRaw: unknown = provRec.source
  const ratersRaw: unknown = provRec.raters
  const agreementRaw: unknown = provRec.agreement
  const source = readEnum(sourceRaw, SOURCES, 'provenance.source')
  const raters = ratersRaw === undefined ? undefined : readCount(ratersRaw, 'provenance.raters', 1)
  const agreement = agreementRaw === undefined ? undefined : readAgreement(agreementRaw)
  if (agreement !== undefined && raters !== undefined && raters < 2) {
    // Agreement is between raters; one rater cannot have produced it.
    throw new RangeError(`provenance.raters is ${String(raters)} but provenance.agreement was supplied; agreement needs at least 2 raters`)
  }

  const sampling = readEnum(samplingRaw, SAMPLINGS, 'sampling')
  const isFixedSet = sampling === 'complete' || sampling === 'held-out-split'

  let benchmarkName: string | undefined
  if (benchmarkRaw !== undefined) {
    const rec = requireRecord(benchmarkRaw, 'benchmark')
    assertKnownKeys(rec, BENCHMARK_KEYS, 'benchmark')
    const nameRaw: unknown = rec.name
    benchmarkName = readName(nameRaw, 'benchmark.name')
    if (!isFixedSet) {
      throw new RangeError("benchmark is only for sampling: 'complete' or 'held-out-split'")
    }
  }

  let population: { claimed: string; evaluated: string } | undefined
  if (populationRaw !== undefined) {
    const rec = requireRecord(populationRaw, 'population')
    assertKnownKeys(rec, POPULATION_KEYS, 'population')
    const claimedRaw: unknown = rec.claimed
    const evaluatedRaw: unknown = rec.evaluated
    population = {
      claimed: readName(claimedRaw, 'population.claimed'),
      evaluated: readName(evaluatedRaw, 'population.evaluated'),
    }
  }

  const evaluatedDay = evaluatedAtRaw === undefined ? undefined : dayNumber(evaluatedAtRaw, 'evaluatedAt')
  if (evaluatedDay !== undefined && nowDay !== undefined && evaluatedDay > nowDay) {
    throw new RangeError('evaluatedAt is after options.now')
  }

  const strata = strataRaw === undefined ? undefined : readStrata(strataRaw)
  const counts = sampleCounts
  // The strata's own totals, as text for a refusal that asks for the pooled counts (null when none or too big to say)
  let strataTotals: string | null = null
  if (strata !== undefined) {
    // BigInt: a plain sum can round past 2^53 and falsely equal the total.
    let sumN = 0n
    let sumCorrect = 0n
    for (const s of strata) {
      sumN += BigInt(s.n)
      sumCorrect += BigInt(s.correct)
    }
    if (sampleCounts !== null) {
      if (sumN !== BigInt(sampleCounts.n) || sumCorrect !== BigInt(sampleCounts.correct)) {
        throw new RangeError('strata counts must add up to the sample counts')
      }
    } else if (sumN <= BigInt(MAX_COUNT)) {
      strataTotals = `{ n: ${String(sumN)}, correct: ${String(sumCorrect)} }`
    }
  }

  let retractionCount = 0
  let retractionsIncluded = true
  if (retractionsRaw !== undefined) {
    const rec = requireRecord(retractionsRaw, 'retractions')
    assertKnownKeys(rec, RETRACTION_KEYS, 'retractions')
    const countRaw: unknown = rec.count
    const includedRaw: unknown = rec.includedInSample
    retractionCount = readCount(countRaw, 'retractions.count', 0)
    if (typeof includedRaw !== 'boolean') {
      throw new TypeError('retractions.includedInSample must be a boolean')
    }
    retractionsIncluded = includedRaw
    if (retractionsIncluded && counts !== null && retractionCount > counts.n) {
      throw new RangeError('retractions.count is larger than the sample, so it cannot all be included')
    }
  }

  // Readers see the printed figure, so the more favorable of the value and the
  // parsed figure is what gets judged. A display that disagrees with the value
  // by more than its own rounding already threw above.
  let assessed = judgedValue
  let fromDisplay = false
  if (figure !== undefined) {
    const shown = figure.info.figure
    // A little noise apart is the same figure (82.7 / 100 against 0.827, 1 - 0.8 against
    // 0.2), not a more favorable one.
    const displayWins = beyondNoise(shown, judgedValue, higherIsBetter)
    if (displayWins) {
      assessed = shown
      fromDisplay = true
    }
  }
  const parsedDisplay = figure === undefined ? null : figure.info

  // Which optional checks this call actually ran. A gate that was asked for
  // ('applied') is different from one that was left out ('not-supplied').
  const checks: GateChecks = {
    retractions: retractionsRaw !== undefined ? 'applied' : 'not-supplied',
    scope: population !== undefined ? 'applied' : 'not-supplied',
    age: maxAgeDays !== undefined ? 'applied' : 'not-supplied',
    // applied = a minimum was required, or a statistic with a value and an n had its size checked;
    // a statistic that has no value is never examined unless a minimum asks for it
    agreement:
      minAgreement !== undefined || (agreement !== undefined && agreement.n !== null && agreement.value !== null) ? 'applied' : 'not-supplied',
    // applied = two or more strata could be compared; one stratum has nothing to differ from
    strata: strata !== undefined && strata.length > 1 && !isFixedSet ? 'applied' : 'not-supplied',
  }

  // ---- preconditions -----------------------------------------------------
  const refusals: ReasonCode[] = []
  const notes: string[] = []
  const metricWord = String(metric)

  if (!judged) {
    refusals.push('metric-not-supported')
    notes.push(`"${clip(String(metric))}" is not a proportion of independently checked items. This kit judges ${SUPPORTED_LIST}; for anything else, report the counts and method instead.`)
  }

  if (source === 'model') {
    refusals.push('no-human-labels')
    notes.push('The labels came from a model, not from people, so there is no human ground truth to count against.')
  } else if (source === 'unknown') {
    refusals.push('unknown-label-source')
    notes.push('The source of the labels is unknown, so it is not possible to tell whether people checked them.')
  } else if (source === 'mixed') {
    refusals.push('mixed-label-source')
    notes.push('Some labels came from a model. Count only the human-labeled items and assess those as a human sample.')
  }

  if (sampling === 'ranked') {
    refusals.push('ranked-sample')
    notes.push('The sample was chosen by rank (for example the top-scored items), which does not represent the rest.')
  } else if (sampling === 'convenience') {
    refusals.push('convenience-sample')
    notes.push('The sample is a convenience sample, so the interval does not describe any larger group.')
  } else if (sampling === 'unknown') {
    refusals.push('unknown-sampling')
    notes.push('How the sample was chosen is unknown, so the interval cannot be read as covering a larger group.')
  }

  if (sampling === 'stratified' && strata === undefined) {
    refusals.push('stratified-without-strata')
    notes.push('The sample is stratified but no strata were supplied. The pooled counts are not a simple random sample, so they cannot be read as the population rate; supply the strata.')
  }

  if (isFixedSet) {
    if (benchmarkName === undefined) {
      refusals.push('benchmark-unnamed')
      notes.push("A complete-set or held-out-split claim must name the fixed set it was measured on (the 'benchmark' field).")
    } else if (claimText === undefined || !mentionsName(claimText, benchmarkName)) {
      refusals.push('claim-not-scoped-to-benchmark')
      notes.push(`The claim wording does not mention "${clip(benchmarkName)}". A score on a fixed set describes that set; word the claim for it, or supply a random sample for a general claim.`)
    }
  }

  if (counts === null) {
    refusals.push('n-undisclosed')
    notes.push(
      strataTotals === null
        ? 'The sample counts (n and correct or errors) were not supplied, so there is nothing to weigh the figure against.'
        : `The pooled sample counts (n and correct or errors) were not supplied. The strata hold them: pass sample: ${strataTotals}, their sums, with the strata.`,
    )
  } else if (!isFixedSet && counts.n < minN) {
    refusals.push('sample-too-small')
    notes.push(`The sample has ${String(counts.n)} items, below the minimum of ${String(minN)} needed for a verdict.`)
  }

  if (!isFixedSet && strata !== undefined && strata.length > 1) {
    // Bonferroni: split the error budget across the strata so that many
    // strata do not make a refusal likelier by chance alone.
    const zStrata = zForTail((1 - confidence) / (2 * strata.length))
    let highestLow = -Infinity
    let lowestHigh = Infinity
    let highestName = ''
    let lowestName = ''
    for (const s of strata) {
      const w = wilsonWithZ(s.correct, s.n, zStrata)
      if (w.low > highestLow) {
        highestLow = w.low
        highestName = s.name
      }
      if (w.high < lowestHigh) {
        lowestHigh = w.high
        lowestName = s.name
      }
    }
    if (highestLow - lowestHigh > COMPARISON_TOLERANCE) {
      refusals.push('merged-strata-differ')
      notes.push(
        `The strata do not agree: "${clip(highestName)}" and "${clip(lowestName)}" have intervals that do not overlap, so one combined figure hides a real difference. Report each stratum.`,
      )
    }
  }

  if (retractionCount > 0 && !retractionsIncluded) {
    refusals.push('retractions-not-included')
    notes.push(`${String(retractionCount)} retracted item(s) are known but are not counted in the sample.`)
  }

  if (maxAgeDays !== undefined && nowDay !== undefined) {
    if (evaluatedDay === undefined) {
      refusals.push('evaluation-date-missing')
      notes.push('A maximum age was set but no evaluation date (evaluatedAt) was supplied.')
    } else if (nowDay - evaluatedDay > maxAgeDays) {
      refusals.push('evaluation-stale')
      notes.push(`The evaluation is ${String(nowDay - evaluatedDay)} days old, over the allowed ${String(maxAgeDays)} days.`)
    }
  }

  if (population !== undefined) {
    if (foldText(population.claimed) !== foldText(population.evaluated)) {
      refusals.push('scope-mismatch')
      notes.push(`The claim covers "${clip(population.claimed)}" but the evaluation covered "${clip(population.evaluated)}".`)
    }
  } else if (requireScope) {
    refusals.push('scope-undeclared')
    notes.push('The claimed and evaluated populations were not declared (population).')
  }

  if (minAgreement !== undefined) {
    if (agreement === undefined) {
      refusals.push('agreement-missing')
      notes.push('A minimum agreement was required but no agreement statistic was supplied.')
    } else if (agreement.value === null) {
      refusals.push('agreement-undefined')
      notes.push(`${STATISTIC_LABEL[agreement.statistic]} is undefined for these labels, so the agreement requirement cannot be checked.`)
    } else if (agreement.value + COMPARISON_TOLERANCE < minAgreement) {
      refusals.push('agreement-below-minimum')
      notes.push(
        `${STATISTIC_LABEL[agreement.statistic]} is ${decimalCut(agreement.value, 3, 'down')}, below the required ${decimalCut(minAgreement, 3, 'up')}.`,
      )
    }
  }

  // An agreement statistic from a handful of items is noise (kappa of 1.0 from 6
  // pairs), whether or not a minimum is required. A hand-written statistic with
  // no n cannot be checked and is trusted.
  if (agreement !== undefined && agreement.value !== null && agreement.n !== null && agreement.n < minN) {
    refusals.push('agreement-sample-too-small')
    notes.push(`${STATISTIC_LABEL[agreement.statistic]} was computed on ${String(agreement.n)} items, below the minimum of ${String(minN)}, so it says too little about the raters to count.`)
  }

  if (refusals.length > 0 || counts === null) {
    const phrases = refusals.map((code) => REFUSAL_PHRASE[code] as string)
    return {
      verdict: 'refused',
      reasons: refusals,
      explanation: notes,
      metric,
      claimed,
      assessedValue: assessed,
      n: counts === null ? null : counts.n,
      basis: 'none',
      parsedDisplay,
      checks,
      interval: null,
      conservativeBound: null,
      suggestedStatement: `No ${metricWord} figure can be supported from this evidence: ${phrases.join('; ')}.`,
    }
  }

  const { n, correct } = counts
  const supportedMetric = metric as ClaimMetric
  const successes = higherIsBetter ? correct : n - correct
  const labelWord = LABEL_WORD[source as 'human' | 'automated' | 'by-construction']
  const datePart = evaluatedAtRaw === undefined ? '' : `, evaluated ${evaluatedAtRaw as string}`
  const metricName = METRIC_PHRASE[supportedMetric]

  // ---- complete set or held-out split: compare with the exact count ---------
  if (isFixedSet) {
    const k = successes
    const censusReasons: ReasonCode[] = []
    const censusNotes: string[] = []
    let censusVerdict: AccuracyVerdict
    const shown = Math.min(countDecimals(n), 2)
    const exactText = pctNearest(k / n, shown)
    // Every figure the reader can see is judged according to its form: a point
    // or approximate figure must match the count to its digits; a bound is an
    // inequality (strict ones exclude equality); a range and "1 in N" are judged
    // at their favorable end / precision band. The value is judged as a point
    // too whenever it is more favorable than the printed figure, or when the
    // printed figure is itself a point figure. 0 and 1 stay exact.
    const form = figure?.info.form
    const pointDisplay = form === 'percent' || form === 'approx'
    const valueMoreFavorable = figure !== undefined && beyondNoise(judgedValue, figure.info.figure, higherIsBetter)
    const displayOk = figure === undefined || figure.satisfiedBy(k, n)
    const valueOk =
      figure === undefined || valueMoreFavorable || pointDisplay ? matchesValue(judgedValue, k, n) : true
    const printedOnly = form === 'floor' || form === 'ceiling' || form === 'range' || form === 'one-in-n'
    const ok = displayOk && valueOk
    if (ok) {
      censusVerdict = 'supported'
      censusReasons.push('census-matches-count')
      censusNotes.push(`The figure ${printedOnly && form !== 'one-in-n' && form !== 'range' ? 'is consistent with' : 'matches'} the exact count (${String(k)} of ${String(n)}, ${exactText}) to ${figure === undefined ? VALUE_PRECISION : 'its printed precision'}.`)
    } else {
      censusVerdict = 'contradicted'
      censusReasons.push('claim-differs-from-count')
      censusNotes.push(`The figure does not match the exact count (${String(k)} of ${String(n)}, ${exactText}). It may be stale or mistyped.`)
    }
    if (figure !== undefined && figure.bandNote !== null) {
      censusNotes[0] = `${censusNotes[0] as string} ${figure.bandNote}`
    }
    let censusPrecisionNote = ''
    if (displayDecimals !== null && displayDecimals > countDecimals(n)) {
      if (strictPrecision && censusVerdict === 'supported') {
        censusReasons.length = 0
        censusNotes.length = 0
        censusVerdict = 'overstated'
      }
      censusReasons.push('precision-too-fine')
      censusNotes.push(`The figure is printed to ${placesWord(displayDecimals)}; ${String(n)} items resolve ${supportsWord(countDecimals(n))}.`)
      censusPrecisionNote = printAdvice(countDecimals(n))
    }
    const censusTextNote = textFigureNote(claimText, judgedValue, assessed, higherIsBetter)
    if (censusTextNote !== null) {
      censusReasons.push('text-figure-differs')
      censusNotes.push(censusTextNote)
    }
    const name = benchmarkName as string
    const counted = higherIsBetter ? `${String(k)} of ${String(n)} correct` : `${String(k)} of ${String(n)} wrong`
    const setWord = sampling === 'held-out-split' ? 'held-out split' : 'complete set'
    return {
      verdict: censusVerdict,
      reasons: censusReasons,
      explanation: censusNotes,
      metric,
      claimed,
      assessedValue: assessed,
      n,
      basis: 'census',
      parsedDisplay,
      checks,
      interval: null,
      conservativeBound: null,
      suggestedStatement: `${counted} on ${name} (${setWord}, ${labelWord}${datePart}): ${exactText} ${metricName === 'accurate' ? 'accuracy' : metricName}. This describes that set only; it is not an estimate for other data${censusPrecisionNote}`,
    }
  }

  // ---- the interval and the verdict ------------------------------------
  const w = wilsonWithZ(successes, n, z)
  const interval = { ...w, confidence, z, successes, n }
  const conservativeBound = higherIsBetter ? w.low : w.high
  const cl = confidenceLabel(confidence)
  // The tolerance absorbs binary noise at an interval limit. An exact 0 or 1 is
  // an absolute claim with no noise in it, and must never be excused: at about
  // 4e12 items the limit next to 0 or 1 is closer than the tolerance.
  const tolFor = (x: number): number => (x === 0 || x === 1 ? 0 : COMPARISON_TOLERANCE)

  let verdict: AccuracyVerdict
  const reasons: ReasonCode[] = []
  const explanation: string[] = []
  const claimedText = pctNearest(assessed, 3)
  const subject = fromDisplay
    ? `The printed figure ${claimedText} (more favorable than the claim value ${pctNearest(claimed, 3)})`
    : `The claimed ${claimedText}`
  const qualifier = higherIsBetter ? '' : ` ${metricName}`

  // An honest report of the observed rate: a point figure (not a bound, not 0 or
  // 100%) equal to successes / n to its printed precision. Never for a bound,
  // and not at all with options.conservative.
  const absolute = assessed === 0 || assessed === 1
  let matchesObserved = false
  if (!conservative && !absolute && (figure === undefined || displayIsPoint)) {
    // The printed figure must match the rate to its own precision; a value that
    // is more favorable than the printed figure must match as well, so a coarse
    // value cannot stand in for a precise print.
    const valueMoreFavorable = figure !== undefined && beyondNoise(judgedValue, figure.info.figure, higherIsBetter)
    matchesObserved =
      figure === undefined
        ? matchesValue(judgedValue, successes, n)
        : figure.matchesObserved(successes, n) && (!valueMoreFavorable || matchesValue(judgedValue, successes, n))
  }

  const top = pctCeil(w.high, 3)
  const bottom = pctFloor(w.low, 3)
  const observedText = `${String(successes)} of ${String(n)}`
  const strictBound = figure !== undefined && figure.strict
  // A bound claim is supported when it sits on the cautious side of the
  // interval's conservative end; a strict one ("over 99%") needs to clear it.
  // The value and the printed figure are each judged on their own terms: only
  // the printed bound carries the strictness.
  const clears = (x: number, strict: boolean): boolean => {
    const tol = tolFor(x)
    return higherIsBetter ? (strict ? x < w.low - tol : x <= w.low + tol) : strict ? x > w.high + tol : x >= w.high - tol
  }
  const withinBound = clears(judgedValue, false) && (figure === undefined || clears(figure.info.figure, strictBound))
  const matchesText = `matches the observed rate (${observedText}) to ${figure === undefined ? VALUE_PRECISION : 'its printed precision'}. The ${cl} Wilson interval is ${bottom} to ${top}.`
  if (withinBound) {
    verdict = 'supported'
    reasons.push('claim-within-bound')
    explanation.push(
      higherIsBetter
        ? `${subject} is ${strictBound ? 'below' : 'no higher than'} the lower end of the ${cl} Wilson interval (${bottom}).`
        : `${subject}${qualifier} is ${strictBound ? 'above' : 'no lower than'} the upper end of the ${cl} Wilson interval (${top}).`,
    )
  } else if (matchesObserved) {
    // An honest report of the observed rate comes first: a rounded figure can
    // land just outside the interval it was rounded from.
    verdict = 'supported'
    reasons.push('matches-observed-rate')
    explanation.push(`${subject}${qualifier} ${matchesText}`)
  } else if (higherIsBetter ? assessed > w.high + tolFor(assessed) : assessed < w.low - tolFor(assessed)) {
    verdict = 'contradicted'
    reasons.push('claim-outside-interval')
    explanation.push(
      higherIsBetter
        ? `${subject} is above the top of the ${cl} Wilson interval (${top}).`
        : `${subject}${qualifier} is below the bottom of the ${cl} Wilson interval (${bottom}).`,
    )
  } else {
    verdict = 'overstated'
    reasons.push('claim-beyond-conservative-bound')
    if (absolute) {
      // 100% (or 0%) is certainty: no sample reaches it, even when every item agreed.
      explanation.push(
        higherIsBetter
          ? `${subject} cannot be stated from a sample: an interval never reaches 100%, even when every item was right (${observedText}). The most the evidence supports is ${bottom}, the lower end of the ${cl} Wilson interval.`
          : `${subject}${qualifier} cannot be stated from a sample: an interval never reaches 0%, even when no item was wrong (${observedText}). The least the evidence supports is ${top}, the upper end of the ${cl} Wilson interval.`,
      )
    } else {
      let sentence = higherIsBetter
        ? `${subject} is inside the ${cl} Wilson interval but above its lower end (${bottom}), which is the most the evidence supports.`
        : `${subject}${qualifier} is inside the ${cl} Wilson interval but below its upper end (${top}), which is the least the evidence supports.`
      // A bound printed rounded to the nearest digit ("99.1%+" from a limit of 99.046%) can land
      // just past the limit; the figure to print is the limit rounded in the cautious direction.
      const printedDecimals = figure !== undefined && figure.bound !== null ? figure.info.decimals : null
      if (printedDecimals !== null && figure !== undefined) {
        const oneUnit = 10 ** -(printedDecimals + 2)
        if (higherIsBetter && figure.bound === 'floor' && assessed - w.low < oneUnit) {
          sentence += ` The shortfall is within the rounding of the last printed digit, so print the bound rounded down: ${pctFloor(w.low, printedDecimals)}.`
        } else if (!higherIsBetter && figure.bound === 'ceiling' && w.high - assessed < oneUnit) {
          sentence += ` The shortfall is within the rounding of the last printed digit, so print the bound rounded up: ${pctCeil(w.high, printedDecimals)}.`
        }
      }
      explanation.push(sentence)
    }
  }

  if (figure !== undefined && figure.bandNote !== null) {
    explanation[0] = `${explanation[0] as string} ${figure.bandNote}`
  }

  let precisionNote = ''
  if (displayDecimals !== null) {
    const allowed = maxDisplayDecimals(w.high - w.low)
    if (displayDecimals > allowed) {
      const text = `The figure is printed to ${placesWord(displayDecimals)}, but the interval is ${pctNearest(w.high - w.low, 2).replace('%', '')} percentage points wide and supports ${supportsWord(allowed)}.`
      if (strictPrecision && verdict === 'supported') {
        // The value itself is fine; only the printed precision overreaches.
        reasons.length = 0
        explanation.length = 0
        verdict = 'overstated'
      }
      reasons.push('precision-too-fine')
      explanation.push(text)
      precisionNote = printAdvice(allowed)
    }
  }

  // A claim far less favorable than the counts (outside the 99.9% interval on
  // the pessimistic side) looks like a stale or mistyped figure. Informational:
  // the verdict is unchanged.
  if (verdict !== 'contradicted') {
    const wide = wilsonWithZ(successes, n, zForConfidence(0.999))
    const worse = higherIsBetter ? assessed < wide.low - tolFor(assessed) : assessed > wide.high + tolFor(assessed)
    if (worse) {
      reasons.push('claim-worse-than-counts')
      explanation.push(
        `${subject} is far less favorable than the counts support (the 99.9% Wilson interval is ${pctFloor(wide.low, 3)} to ${pctCeil(wide.high, 3)}). If this is a published figure it may be stale or wrong.`,
      )
    }
  }

  // The interval pools the strata as one simple random sample. It is not
  // reweighted by population share, and the kit has no population shares to
  // reweight with, so a stratified result says so (informational).
  if (sampling === 'stratified') {
    reasons.push('strata-not-reweighted')
    explanation.push('The strata are pooled as one sample and not reweighted by population share, so the interval describes the pooled counts, not the population, unless each stratum was sampled in proportion to its size. Report each stratum, or reweight them yourself.')
  }

  const textNote = textFigureNote(claimText, judgedValue, assessed, higherIsBetter)
  if (textNote !== null) {
    reasons.push('text-figure-differs')
    explanation.push(textNote)
  }

  // ---- statement ---------------------------------------------------------
  // One precision for the headline bound and the interval it quotes.
  const decimals = Math.min(maxDisplayDecimals(w.high - w.low) + 2, 5)
  // The lead names the scope first: the figure is about this sample (or the
  // declared evaluated population), so a pasted headline cannot read as a
  // property of the system.
  const scope = population === undefined ? 'On this sample' : `On this sample of ${population.evaluated}`
  const headline = higherIsBetter
    ? `${scope}, at least ${pctFloor(w.low, decimals)} ${metricName}`
    : `${scope}, at most ${pctCeil(w.high, decimals)} ${metricName}`
  const caveat = sampling === 'cross-validation' ? SAMPLING_ERROR_ONLY_CV : SAMPLING_ERROR_ONLY
  const parts = [
    `${cl} Wilson interval ${pctFloor(w.low, decimals)} to ${pctCeil(w.high, decimals)}`,
    `n = ${String(n)}`,
    labelWord,
    SAMPLE_WORD[sampling] ?? 'random sample',
  ]
  if (evaluatedAtRaw !== undefined) parts.push(`evaluated ${evaluatedAtRaw as string}`)
  if (agreement !== undefined && agreement.value !== null) {
    parts.push(`${STATISTIC_LABEL[agreement.statistic]} ${decimalCut(agreement.value, 2, 'down')}`)
  }
  return {
    verdict,
    reasons,
    explanation,
    metric,
    claimed,
    assessedValue: assessed,
    n,
    basis: 'wilson-interval',
    parsedDisplay,
    checks,
    interval,
    conservativeBound,
    suggestedStatement: `${headline} (${parts.join(', ')}); ${caveat}${precisionNote}`,
  }
}
