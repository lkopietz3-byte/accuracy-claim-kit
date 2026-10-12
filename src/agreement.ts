import { MAX_LABEL_LENGTH } from './text.js'
import { assertKnownKeys, isRecord, readCount, readLength } from './validate.js'

/** A categorical label. Compared exactly: 1 and "1" are different labels. */
export type Label = string | number | boolean

export type AgreementStatistic = 'percent-agreement' | 'cohen-kappa' | 'gwet-ac1'

export type UndefinedAgreementReason =
  /** The list of pairs was empty. */
  | 'no-pairs'
  /** Cohen's kappa: chance agreement is exactly 1 (both raters used one and the same single label for every item). */
  | 'expected-agreement-is-1'
  /** Gwet's AC1: fewer than two categories, so the chance model has nothing to spread over. */
  | 'single-category'

interface AgreementBase {
  statistic: AgreementStatistic
  /** Number of pairs used. */
  n: number
  /** Pairs where the two labels are equal. */
  agreements: number
  /** Distinct labels seen across both raters; for gwetAC1 the category count Q actually used. */
  categories: number
}

export interface DefinedAgreement extends AgreementBase {
  status: 'defined'
  value: number
}

export interface UndefinedAgreement extends AgreementBase {
  status: 'undefined'
  value: null
  reason: UndefinedAgreementReason
}

export type AgreementResult = DefinedAgreement | UndefinedAgreement

export interface GwetOptions {
  /**
   * Number of categories the label scale allows (Q in Gwet's formula), when
   * some categories may be unused in the sample. Must be a whole number at
   * least as large as the number of distinct labels seen. Default: the
   * number of distinct labels seen.
   */
  categories?: number | undefined
}

interface Tally {
  n: number
  agreements: number
  /** label -> [count for rater A, count for rater B] */
  byLabel: Map<Label, [number, number]>
}

function readLabel(value: unknown, where: string): Label {
  if (typeof value === 'string') {
    // Equal-length strings over 16,383 characters collide in V8's Map hashing and make the tally quadratic.
    if (value.length > MAX_LABEL_LENGTH) {
      throw new RangeError(`${where} must be at most ${String(MAX_LABEL_LENGTH)} characters`)
    }
    return value
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${where} must be a finite number when numeric, got ${String(value)}`)
    }
    return value + 0 // -0 and 0 are the same label
  }
  throw new TypeError(`${where} must be a string, number or boolean`)
}

/** One indexed pass; every array element and tuple slot is read exactly once. */
function tally(pairs: unknown): Tally {
  if (!Array.isArray(pairs)) {
    throw new TypeError('pairs must be an array of [labelA, labelB] pairs')
  }
  const length = readLength((pairs as unknown[]).length, 'pairs')
  const byLabel = new Map<Label, [number, number]>()
  let agreements = 0
  for (let i = 0; i < length; i++) {
    const pair: unknown = (pairs as unknown[])[i]
    if (!Array.isArray(pair)) {
      throw new TypeError(`pairs[${i}] must be a [labelA, labelB] array`)
    }
    const slots = pair as unknown[]
    if (readLength(slots.length, `pairs[${i}]`) !== 2) {
      throw new RangeError(`pairs[${i}] must have exactly 2 labels`)
    }
    const a = readLabel(slots[0], `pairs[${i}][0]`)
    const b = readLabel(slots[1], `pairs[${i}][1]`)
    if (a === b) agreements += 1
    const ca = byLabel.get(a)
    if (ca === undefined) byLabel.set(a, [1, 0])
    else ca[0] += 1
    const cb = byLabel.get(b)
    if (cb === undefined) byLabel.set(b, [0, 1])
    else cb[1] += 1
  }
  return { n: length, agreements, byLabel }
}

function undefinedResult(
  statistic: AgreementStatistic,
  t: Tally,
  reason: UndefinedAgreementReason,
  categories: number,
): UndefinedAgreement {
  return { statistic, status: 'undefined', value: null, reason, n: t.n, agreements: t.agreements, categories }
}

function definedResult(
  statistic: AgreementStatistic,
  t: Tally,
  value: number,
  categories: number,
): DefinedAgreement {
  // Guard against a stray -0 and keep the range honest after the final division.
  const v = Math.max(-1, Math.min(1, value)) + 0
  return { statistic, status: 'defined', value: v, n: t.n, agreements: t.agreements, categories }
}

/**
 * Share of pairs where the two raters gave the same label: agreements / n.
 * With no pairs the result is `undefined` with reason "no-pairs".
 * Throws TypeError / RangeError for malformed pairs.
 */
export function percentAgreement(pairs: readonly (readonly [Label, Label])[]): AgreementResult {
  const t = tally(pairs)
  if (t.n === 0) return undefinedResult('percent-agreement', t, 'no-pairs', 0)
  return definedResult('percent-agreement', t, t.agreements / t.n, t.byLabel.size)
}

/**
 * Cohen's kappa for two raters: (po - pe) / (1 - pe), with pe the chance
 * agreement implied by each rater's own label frequencies. Computed from
 * integer counts (BigInt), so there is no cancellation error.
 * Undefined when pe is exactly 1, or when there are no pairs.
 */
export function cohenKappa(pairs: readonly (readonly [Label, Label])[]): AgreementResult {
  const t = tally(pairs)
  const categories = t.byLabel.size
  if (t.n === 0) return undefinedResult('cohen-kappa', t, 'no-pairs', 0)
  const n = BigInt(t.n)
  let sumAB = 0n
  for (const [a, b] of t.byLabel.values()) sumAB += BigInt(a) * BigInt(b)
  const den = n * n - sumAB // n^2 (1 - pe)
  if (den === 0n) return undefinedResult('cohen-kappa', t, 'expected-agreement-is-1', categories)
  const num = n * BigInt(t.agreements) - sumAB // n^2 (po - pe)
  return definedResult('cohen-kappa', t, Number(num) / Number(den), categories)
}

/**
 * Gwet's AC1 for two raters: (po - pe) / (1 - pe) with
 * pe = sum_k pi_k (1 - pi_k) / (Q - 1) and pi_k the mean share of label k
 * across both raters. Computed from integer counts (BigInt).
 * Undefined with fewer than two categories (Q < 2) or no pairs.
 * Throws RangeError if options.categories is below the number of labels seen.
 */
export function gwetAC1(
  pairs: readonly (readonly [Label, Label])[],
  options?: GwetOptions,
): AgreementResult {
  if (options !== undefined && !isRecord(options)) {
    throw new TypeError('options must be an object')
  }
  if (options !== undefined) assertKnownKeys(options, ['categories'], 'options')
  const declared = options === undefined ? undefined : options.categories
  const t = tally(pairs)
  const seen = t.byLabel.size
  let q = seen
  if (declared !== undefined) {
    q = readCount(declared, 'options.categories', 1)
    if (q < seen) {
      throw new RangeError(`options.categories (${String(q)}) is below the ${String(seen)} labels seen`)
    }
  }
  if (t.n === 0) return undefinedResult('gwet-ac1', t, 'no-pairs', q)
  if (q < 2) return undefinedResult('gwet-ac1', t, 'single-category', q)
  const n = BigInt(t.n)
  const qm1 = BigInt(q - 1)
  let s = 0n // sum_k c_k (2n - c_k), c_k = count of k across both raters
  for (const [a, b] of t.byLabel.values()) {
    const c = BigInt(a + b)
    s += c * (2n * n - c)
  }
  const den = 4n * n * n * qm1 - s
  if (den <= 0n) return undefinedResult('gwet-ac1', t, 'single-category', q)
  const num = 4n * n * BigInt(t.agreements) * qm1 - s
  return definedResult('gwet-ac1', t, Number(num) / Number(den), q)
}
