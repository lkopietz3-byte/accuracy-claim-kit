import type { AgreementStatistic } from './agreement.js'
import { countDecimals, matchesValue } from './census.js'
import { dayNumber } from './dates.js'
import { parseDisplayFigure } from './display.js'
import { beyondOneUlp } from './exact.js'
import type { DisplayFigure } from './display.js'
import { confidenceLabel, maxDisplayDecimals, pctCeil, pctFloor, pctNearest } from './format.js'
import type {
  AccuracyAssessment,
  AccuracyClaimInput,
  AccuracyVerdict,
  AssessOptions,
  ClaimMetric,
  UnsupportedMetric,
  LabelSource,
  ReasonCode,
  SamplingMethod,
} from './types.js'
import {
  clip,
  isRecord,
  readCount,
  readFiniteInRange,
  readLength,
  readOpenUnit,
  requireRecord,
} from './validate.js'
import { foldText, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, mentionsName, readName } from './text.js'
import { DEFAULT_CONFIDENCE, wilsonWithZ, zForConfidence, zForTail } from './wilson.js'

/** Smallest sample that gets a verdict unless options.minN says otherwise. */
export const DEFAULT_MIN_N = 30

/**
 * Absolute tolerance, as a proportion, when a claim is compared with an
 * interval limit. A claim within this distance of a limit counts as being at
 * the limit, on the claimant's side. It exists only to absorb binary
 * floating-point noise (a claim of exactly 0.98 against a limit that
 * computes to 0.98000000000000001). It is far below the width of any
 * interval met in practice; it can only matter for samples above about 1e15
 * items with a rate within about 1e-12 of 0 or 1, where the interval itself
 * is narrower than the tolerance.
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
]
/** Metrics the kit knows it cannot judge: they get a refusal, not a throw. */
const UNSUPPORTED_METRICS: readonly UnsupportedMetric[] = [
  'f1', 'auc', 'roc-auc', 'wer', 'cer', 'bleu', 'rouge', 'map', 'composite', 'other',
]
const HIGHER_IS_BETTER: readonly ClaimMetric[] = ['accuracy', 'precision', 'recall']
const METRIC_PHRASE: Record<ClaimMetric, string> = {
  accuracy: 'accurate',
  'error-rate': 'error rate',
  precision: 'precision',
  recall: 'recall',
  'false-positive-rate': 'false-positive rate',
  'false-negative-rate': 'false-negative rate',
}
/** What a bare value (no display) is read at; nothing was printed, so the text must not say so. */
const VALUE_PRECISION = 'the precision of the value (a whole percent at the coarsest)'
const SUPPORTED_LIST = 'accuracy, error-rate, precision, recall, false-positive-rate and false-negative-rate'
const STATISTICS: readonly AgreementStatistic[] = ['percent-agreement', 'cohen-kappa', 'gwet-ac1']
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

interface Counts {
  n: number
  correct: number
}

/** Reads {n, correct?, errors?} for the sample; null when no counts were disclosed at all. */
function readSampleCounts(raw: unknown): Counts | null {
  if (raw === undefined) return null
  const rec = requireRecord(raw, 'sample')
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
}

function readAgreement(raw: unknown): Agreement {
  const rec = requireRecord(raw, 'provenance.agreement')
  const statisticRaw: unknown = rec.statistic
  const statusRaw: unknown = rec.status
  const valueRaw: unknown = rec.value
  const statistic = readEnum(statisticRaw, STATISTICS, 'provenance.agreement.statistic')
  if (statusRaw !== undefined && statusRaw !== 'defined' && statusRaw !== 'undefined') {
    throw new RangeError('provenance.agreement.status must be "defined" or "undefined"')
  }
  if (statusRaw === 'undefined') {
    // A statistic that has no value must say so with null; NaN, 0 or text in
    // its place is malformed input, not "cannot tell".
    if (valueRaw !== null) {
      const message = 'provenance.agreement.value must be null when status is "undefined"'
      throw typeof valueRaw === 'number' ? new RangeError(message) : new TypeError(message)
    }
    return { statistic, value: null }
  }
  return { statistic, value: readFiniteInRange(valueRaw, 'provenance.agreement.value', -1, 1) }
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
    const nameRaw: unknown = rec.name
    if (typeof nameRaw !== 'string') throw new TypeError(`strata[${i}].name must be a string`)
    if (nameRaw === '') throw new RangeError(`strata[${i}].name must not be empty`)
    if (nameRaw.length > MAX_LABEL_LENGTH) {
      throw new RangeError(`strata[${i}].name must be at most ${String(MAX_LABEL_LENGTH)} characters`)
    }
    if (names.has(nameRaw)) throw new RangeError(`strata[${i}].name "${clip(nameRaw)}" is a duplicate`)
    names.add(nameRaw)
    const counts = readCounts(rec, `strata[${i}]`)
    out.push({ name: nameRaw, ...counts })
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

const SAMPLE_WORD: Partial<Record<SamplingMethod, string>> = {
  stratified: 'stratified sample',
  'cross-validation': 'cross-validation estimate',
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
  const confidenceRaw: unknown = options === undefined ? undefined : options.confidence
  const minNRaw: unknown = options === undefined ? undefined : options.minN
  const minAgreementRaw: unknown = options === undefined ? undefined : options.minAgreement
  const confidence =
    confidenceRaw === undefined ? DEFAULT_CONFIDENCE : readOpenUnit(confidenceRaw, 'options.confidence')
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
  const metricRaw: unknown = claimRec.metric
  const valueRaw: unknown = claimRec.value
  const displayRaw: unknown = claimRec.display
  const textRaw: unknown = claimRec.text

  // The metric: judged, or known-unsupported (refused below), or a typo (thrown).
  const unsupportedMetric =
    typeof metricRaw === 'string' ? UNSUPPORTED_METRICS.find((m) => m === metricRaw) : undefined
  const metric: ClaimMetric | UnsupportedMetric =
    unsupportedMetric !== undefined
      ? unsupportedMetric
      : readEnum(metricRaw, METRICS, `claim.metric (or one of ${UNSUPPORTED_METRICS.join(', ')})`)
  const judged = unsupportedMetric === undefined
  const higherIsBetter = judged && HIGHER_IS_BETTER.includes(metric as ClaimMetric)

  // A value is a proportion from 0 to 1 for a judged metric. An unsupported
  // metric (a word error rate can pass 1) only needs to be a number.
  const claimed = judged
    ? readFiniteInRange(valueRaw, 'claim.value', 0, 1)
    : readFiniteInRange(valueRaw, 'claim.value', -Infinity, Infinity)

  if (displayRaw !== undefined && typeof displayRaw !== 'string') throw new TypeError('claim.display must be a string')
  let figure: DisplayFigure | undefined
  if (displayRaw !== undefined && judged) {
    figure = parseDisplayFigure(displayRaw, higherIsBetter)
    // Exact: the value must agree with the printed figure to its rounding plus
    // one ulp of the value. No float tolerance is involved.
    if (!figure.consistentWith(claimed)) {
      throw new RangeError('claim.display does not match claim.value')
    }
  }
  const displayIsPoint = figure !== undefined && figure.bound === null
  const displayDecimals =
    figure !== undefined && figure.info.form !== 'one-in-n' && figure.bound === null ? figure.info.decimals : null

  let claimText: string | undefined
  if (textRaw !== undefined) {
    if (typeof textRaw !== 'string') throw new TypeError('claim.text must be a string')
    if (textRaw.length > MAX_TEXT_LENGTH) throw new RangeError(`claim.text must be at most ${String(MAX_TEXT_LENGTH)} characters`)
    claimText = textRaw
  }

  const counts = readSampleCounts(sampleRaw)

  const provRec = requireRecord(provenanceRaw, 'provenance')
  const sourceRaw: unknown = provRec.source
  const ratersRaw: unknown = provRec.raters
  const agreementRaw: unknown = provRec.agreement
  const source = readEnum(sourceRaw, SOURCES, 'provenance.source')
  if (ratersRaw !== undefined) readCount(ratersRaw, 'provenance.raters', 1)
  const agreement = agreementRaw === undefined ? undefined : readAgreement(agreementRaw)

  const sampling = readEnum(samplingRaw, SAMPLINGS, 'sampling')
  const isFixedSet = sampling === 'complete' || sampling === 'held-out-split'

  let benchmarkName: string | undefined
  if (benchmarkRaw !== undefined) {
    const rec = requireRecord(benchmarkRaw, 'benchmark')
    const nameRaw: unknown = rec.name
    benchmarkName = readName(nameRaw, 'benchmark.name')
    if (!isFixedSet) {
      throw new RangeError("benchmark is only for sampling: 'complete' or 'held-out-split'")
    }
  }

  let population: { claimed: string; evaluated: string } | undefined
  if (populationRaw !== undefined) {
    const rec = requireRecord(populationRaw, 'population')
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
  if (strata !== undefined && counts !== null) {
    // BigInt: a plain sum can round past 2^53 and falsely equal the total.
    let sumN = 0n
    let sumCorrect = 0n
    for (const s of strata) {
      sumN += BigInt(s.n)
      sumCorrect += BigInt(s.correct)
    }
    if (sumN !== BigInt(counts.n) || sumCorrect !== BigInt(counts.correct)) {
      throw new RangeError('strata counts must add up to the sample counts')
    }
  }

  let retractionCount = 0
  let retractionsIncluded = true
  if (retractionsRaw !== undefined) {
    const rec = requireRecord(retractionsRaw, 'retractions')
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
  let assessed = claimed
  let fromDisplay = false
  if (figure !== undefined) {
    const shown = figure.info.figure
    // One ulp apart is the same figure (82.7 / 100 against 0.827), not a more favorable one.
    const displayWins = beyondOneUlp(shown, claimed, higherIsBetter)
    if (displayWins) {
      assessed = shown
      fromDisplay = true
    }
  }
  const parsedDisplay = figure === undefined ? null : figure.info

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
    notes.push('The sample counts (n and correct or errors) were not supplied, so there is nothing to weigh the figure against.')
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
        `${STATISTIC_LABEL[agreement.statistic]} is ${agreement.value.toFixed(3)}, below the required ${minAgreement.toFixed(3)}.`,
      )
    }
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
    const valueMoreFavorable = figure !== undefined && beyondOneUlp(claimed, figure.info.figure, higherIsBetter)
    const displayOk = figure === undefined || figure.satisfiedBy(k, n)
    const valueOk =
      figure === undefined || valueMoreFavorable || pointDisplay ? matchesValue(claimed, k, n) : true
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
    let censusPrecisionNote = ''
    if (displayDecimals !== null && displayDecimals > countDecimals(n)) {
      if (strictPrecision && censusVerdict === 'supported') {
        censusReasons.length = 0
        censusNotes.length = 0
        censusVerdict = 'overstated'
      }
      censusReasons.push('precision-too-fine')
      censusNotes.push(`The figure is printed to ${String(displayDecimals)} decimal place(s); ${String(n)} items resolve at most ${String(countDecimals(n))}.`)
      censusPrecisionNote = `; print it to at most ${String(countDecimals(n))} decimal place(s)`
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
  const tol = COMPARISON_TOLERANCE

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
    const valueMoreFavorable = figure !== undefined && beyondOneUlp(claimed, figure.info.figure, higherIsBetter)
    matchesObserved =
      figure === undefined
        ? matchesValue(claimed, successes, n)
        : figure.matchesObserved(successes, n) && (!valueMoreFavorable || matchesValue(claimed, successes, n))
  }

  const top = pctCeil(w.high, 3)
  const bottom = pctFloor(w.low, 3)
  const observedText = `${String(successes)} of ${String(n)}`
  const strictBound = figure !== undefined && figure.strict
  // A bound claim is supported when it sits on the cautious side of the
  // interval's conservative end; a strict one ("over 99%") needs to clear it.
  // The value and the printed figure are each judged on their own terms: only
  // the printed bound carries the strictness.
  const clears = (x: number, strict: boolean): boolean =>
    higherIsBetter ? (strict ? x < w.low - tol : x <= w.low + tol) : strict ? x > w.high + tol : x >= w.high - tol
  const withinBound = clears(claimed, false) && (figure === undefined || clears(figure.info.figure, strictBound))
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
  } else if (higherIsBetter ? assessed > w.high + tol : assessed < w.low - tol) {
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
    explanation.push(
      higherIsBetter
        ? `${subject} is inside the ${cl} Wilson interval but above its lower end (${bottom}), which is the most the evidence supports.`
        : `${subject}${qualifier} is inside the ${cl} Wilson interval but below its upper end (${top}), which is the least the evidence supports.`,
    )
  }

  let precisionNote = ''
  if (displayDecimals !== null) {
    const allowed = maxDisplayDecimals(w.high - w.low)
    if (displayDecimals > allowed) {
      const text = `The figure is printed to ${String(displayDecimals)} decimal place(s), but the interval is ${pctNearest(w.high - w.low, 2).replace('%', '')} percentage points wide and supports at most ${String(allowed)} decimal place(s).`
      if (strictPrecision && verdict === 'supported') {
        // The value itself is fine; only the printed precision overreaches.
        reasons.length = 0
        explanation.length = 0
        verdict = 'overstated'
      }
      reasons.push('precision-too-fine')
      explanation.push(text)
      precisionNote = `; print it to at most ${String(allowed)} decimal place(s)`
    }
  }

  // A claim far less favorable than the counts (outside the 99.9% interval on
  // the pessimistic side) looks like a stale or mistyped figure. Informational:
  // the verdict is unchanged.
  if (verdict !== 'contradicted') {
    const wide = wilsonWithZ(successes, n, zForConfidence(0.999))
    const worse = higherIsBetter ? assessed < wide.low - tol : assessed > wide.high + tol
    if (worse) {
      reasons.push('claim-worse-than-counts')
      explanation.push(
        `${subject} is far less favorable than the counts support (the 99.9% Wilson interval is ${pctFloor(wide.low, 3)} to ${pctCeil(wide.high, 3)}). If this is a published figure it may be stale or wrong.`,
      )
    }
  }

  // ---- statement ---------------------------------------------------------
  // One precision for the headline bound and the interval it quotes.
  const decimals = Math.min(maxDisplayDecimals(w.high - w.low) + 2, 5)
  const headline = higherIsBetter
    ? `At least ${pctFloor(w.low, decimals)} ${metricName}`
    : `At most ${pctCeil(w.high, decimals)} ${metricName}`
  const parts = [
    `${cl} Wilson interval ${pctFloor(w.low, decimals)} to ${pctCeil(w.high, decimals)}`,
    `n = ${String(n)}`,
    labelWord,
    SAMPLE_WORD[sampling] ?? 'random sample',
  ]
  if (evaluatedAtRaw !== undefined) parts.push(`evaluated ${evaluatedAtRaw as string}`)
  if (agreement !== undefined && agreement.value !== null) {
    parts.push(`${STATISTIC_LABEL[agreement.statistic]} ${agreement.value.toFixed(2)}`)
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
    interval,
    conservativeBound,
    suggestedStatement: `${headline} (${parts.join(', ')})${precisionNote}`,
  }
}
