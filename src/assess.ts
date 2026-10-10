import type { AgreementStatistic } from './agreement.js'
import { withinHalfUnit } from './exact.js'
import { confidenceLabel, maxDisplayDecimals, pctCeil, pctFloor, pctNearest } from './format.js'
import type {
  AccuracyAssessment,
  AccuracyClaimInput,
  AccuracyVerdict,
  AssessOptions,
  ClaimMetric,
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

const SOURCES: readonly LabelSource[] = ['human', 'model', 'mixed', 'unknown']
const SAMPLINGS: readonly SamplingMethod[] = ['random', 'stratified', 'ranked', 'convenience', 'unknown']
const METRICS: readonly ClaimMetric[] = ['accuracy', 'error-rate']
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

const DISPLAY = /^\s*(\d{1,3})(?:\.(\d{1,15}))?\s*%\s*$/

interface ParsedDisplay {
  /** The figure as a proportion, correctly rounded from its decimal digits. */
  proportion: number
  /** All digits of the percent figure as one integer (whole and fraction). */
  digits: bigint
  decimals: number
}

/**
 * Parses a percent string such as "99.8%". The decimal digits are checked
 * against 0..100 before anything is converted to a double, so "100.000000000000001%"
 * cannot round its way to a valid 100%. A sign is not part of the format.
 */
function parseDisplay(display: unknown): ParsedDisplay {
  if (typeof display !== 'string') throw new TypeError('claim.display must be a string')
  if (display.length > 64) throw new RangeError('claim.display is too long to be a percent figure')
  const match = DISPLAY.exec(display)
  if (match === null) {
    throw new RangeError(`claim.display must look like "99.8%"; got "${clip(display)}"`)
  }
  const whole = match[1] as string
  const frac = match[2] ?? ''
  if (Number(whole) > 100 || (Number(whole) === 100 && /[1-9]/.test(frac))) {
    throw new RangeError(`claim.display must be between 0% and 100%; got "${clip(display)}"`)
  }
  const text = frac === '' ? whole : `${whole}.${frac}`
  // Parsing "99.8e-2" is correctly rounded; dividing 99.8 by 100 is not always.
  return { proportion: Number(`${text}e-2`), digits: BigInt(`${whole}${frac}`), decimals: frac.length }
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
    if (names.has(nameRaw)) throw new RangeError(`strata[${i}].name "${clip(nameRaw)}" is a duplicate`)
    names.add(nameRaw)
    const counts = readCounts(rec, `strata[${i}]`)
    out.push({ name: nameRaw, ...counts })
  }
  return out
}

const REFUSAL_PHRASE: Record<string, string> = {
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
 *  - overstated: inside the interval but more favorable than its
 *    conservative end, or printed with finer precision than the interval allows.
 *  - supported: no more favorable than the conservative end (and, if a
 *    display string was given, not printed finer than the interval allows).
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

  const root = requireRecord(input, 'input')
  const claimRaw: unknown = root.claim
  const sampleRaw: unknown = root.sample
  const provenanceRaw: unknown = root.provenance
  const samplingRaw: unknown = root.sampling
  const strataRaw: unknown = root.strata
  const retractionsRaw: unknown = root.retractions

  const claimRec = requireRecord(claimRaw, 'claim')
  const metricRaw: unknown = claimRec.metric
  const valueRaw: unknown = claimRec.value
  const displayRaw: unknown = claimRec.display
  const metric = readEnum(metricRaw, METRICS, 'claim.metric')
  const claimed = readFiniteInRange(valueRaw, 'claim.value', 0, 1)
  let displayDecimals: number | undefined
  let displayProportion: number | undefined
  if (displayRaw !== undefined) {
    const parsed = parseDisplay(displayRaw)
    displayDecimals = parsed.decimals
    displayProportion = parsed.proportion
    // Exact: the value must be within half a unit of the printed last digit,
    // judged on the double's exact value. No tolerance is involved.
    if (!withinHalfUnit(claimed, parsed.digits, parsed.decimals + 2, parsed.decimals + 2)) {
      throw new RangeError('claim.display does not match claim.value')
    }
  }

  const { n, correct } = readCounts(sampleRaw, 'sample')

  const provRec = requireRecord(provenanceRaw, 'provenance')
  const sourceRaw: unknown = provRec.source
  const ratersRaw: unknown = provRec.raters
  const agreementRaw: unknown = provRec.agreement
  const source = readEnum(sourceRaw, SOURCES, 'provenance.source')
  if (ratersRaw !== undefined) readCount(ratersRaw, 'provenance.raters', 1)
  const agreement = agreementRaw === undefined ? undefined : readAgreement(agreementRaw)

  const sampling = readEnum(samplingRaw, SAMPLINGS, 'sampling')

  const strata = strataRaw === undefined ? undefined : readStrata(strataRaw)
  if (strata !== undefined) {
    // BigInt: a plain sum can round past 2^53 and falsely equal the total.
    let sumN = 0n
    let sumCorrect = 0n
    for (const s of strata) {
      sumN += BigInt(s.n)
      sumCorrect += BigInt(s.correct)
    }
    if (sumN !== BigInt(n) || sumCorrect !== BigInt(correct)) {
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
    if (retractionsIncluded && retractionCount > n) {
      throw new RangeError('retractions.count is larger than the sample, so it cannot all be included')
    }
  }

  // Readers see the printed figure, so the more favorable of the value and the
  // parsed display is what gets judged. A display that disagrees with the value
  // by more than its own rounding already threw above.
  let assessed = claimed
  let fromDisplay = false
  if (displayProportion !== undefined) {
    const displayWins = metric === 'accuracy' ? displayProportion > claimed : displayProportion < claimed
    if (displayWins) {
      assessed = displayProportion
      fromDisplay = true
    }
  }

  // ---- preconditions -----------------------------------------------------
  const refusals: ReasonCode[] = []
  const notes: string[] = []
  const metricWord = metric === 'accuracy' ? 'accuracy' : 'error-rate'

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

  if (n < minN) {
    refusals.push('sample-too-small')
    notes.push(`The sample has ${String(n)} items, below the minimum of ${String(minN)} needed for a verdict.`)
  }

  if (strata !== undefined && strata.length > 1) {
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

  if (refusals.length > 0) {
    const phrases = refusals.map((code) => REFUSAL_PHRASE[code] as string)
    return {
      verdict: 'refused',
      reasons: refusals,
      explanation: notes,
      metric,
      claimed,
      assessedValue: assessed,
      n,
      interval: null,
      conservativeBound: null,
      suggestedStatement: `No ${metricWord} figure can be supported from this evidence: ${phrases.join('; ')}.`,
    }
  }

  // ---- the interval and the verdict ------------------------------------
  const successes = metric === 'accuracy' ? correct : n - correct
  const w = wilsonWithZ(successes, n, z)
  const interval = { ...w, confidence, z, successes, n }
  const conservativeBound = metric === 'accuracy' ? w.low : w.high
  const cl = confidenceLabel(confidence)
  const tol = COMPARISON_TOLERANCE

  let verdict: AccuracyVerdict
  const reasons: ReasonCode[] = []
  const explanation: string[] = []
  const claimedText = pctNearest(assessed, 3)
  const subject = fromDisplay
    ? `The printed figure ${claimedText} (more favorable than the claim value ${pctNearest(claimed, 3)})`
    : `The claimed ${claimedText}`

  const top = pctCeil(w.high, 3)
  const bottom = pctFloor(w.low, 3)
  if (metric === 'accuracy') {
    if (assessed > w.high + tol) {
      verdict = 'contradicted'
      reasons.push('claim-outside-interval')
      explanation.push(`${subject} is above the top of the ${cl} Wilson interval (${top}).`)
    } else if (assessed > w.low + tol) {
      verdict = 'overstated'
      reasons.push('claim-beyond-conservative-bound')
      explanation.push(`${subject} is inside the ${cl} Wilson interval but above its lower end (${bottom}), which is the most the evidence supports.`)
    } else {
      verdict = 'supported'
      reasons.push('claim-within-bound')
      explanation.push(`${subject} is no higher than the lower end of the ${cl} Wilson interval (${bottom}).`)
    }
  } else if (assessed < w.low - tol) {
    verdict = 'contradicted'
    reasons.push('claim-outside-interval')
    explanation.push(`${subject} error rate is below the bottom of the ${cl} Wilson interval (${bottom}).`)
  } else if (assessed < w.high - tol) {
    verdict = 'overstated'
    reasons.push('claim-beyond-conservative-bound')
    explanation.push(`${subject} error rate is inside the ${cl} Wilson interval but below its upper end (${top}), which is the least the evidence supports.`)
  } else {
    verdict = 'supported'
    reasons.push('claim-within-bound')
    explanation.push(`${subject} error rate is no lower than the upper end of the ${cl} Wilson interval (${top}).`)
  }

  if (displayDecimals !== undefined) {
    const allowed = maxDisplayDecimals(w.high - w.low)
    if (displayDecimals > allowed) {
      const text = `The figure is printed to ${String(displayDecimals)} decimal place(s), but the interval is ${pctNearest(w.high - w.low, 2).replace('%', '')} percentage points wide and supports at most ${String(allowed)} decimal place(s).`
      if (verdict === 'supported') {
        // The value itself is fine; only the printed precision overreaches.
        reasons.length = 0
        explanation.length = 0
        verdict = 'overstated'
      }
      reasons.push('precision-too-fine')
      explanation.push(text)
    }
  }

  // ---- statement ---------------------------------------------------------
  const stmtDecimals = Math.min(maxDisplayDecimals(w.high - w.low) + 1, 4)
  const edgeDecimals = stmtDecimals + 1
  const headline =
    metric === 'accuracy'
      ? `At least ${pctFloor(w.low, stmtDecimals)} accurate`
      : `At most ${pctCeil(w.high, stmtDecimals)} error rate`
  const parts = [
    `${cl} Wilson interval ${pctFloor(w.low, edgeDecimals)} to ${pctCeil(w.high, edgeDecimals)}`,
    `n = ${String(n)}`,
    'human labels',
    sampling === 'stratified' ? 'stratified sample' : 'random sample',
  ]
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
    interval,
    conservativeBound,
    suggestedStatement: `${headline} (${parts.join(', ')})`,
  }
}
