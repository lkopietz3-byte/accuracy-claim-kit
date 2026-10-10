import { normalQuantile } from './normal.js'
import { readCount, readOpenUnit } from './validate.js'

export const DEFAULT_CONFIDENCE = 0.95

export interface WilsonInterval {
  /** Lower limit, in [0, point]. Exactly 0 when successes is 0. */
  low: number
  /** Upper limit, in [point, 1]. Exactly 1 when successes equals n. */
  high: number
  /** successes / n. */
  point: number
  /** The two-sided confidence level used. */
  confidence: number
  /** The normal quantile used for that level. */
  z: number
  successes: number
  n: number
}

export interface WilsonOptions {
  /** Two-sided confidence level, strictly between 0 and 1. Default 0.95. */
  confidence?: number | undefined
}

/**
 * Two-sided standard normal quantile for a confidence level, e.g. 1.959963984540054
 * for 0.95. Throws TypeError / RangeError unless 0 < confidence < 1.
 */
export function zForConfidence(confidence: number): number {
  const c = readOpenUnit(confidence, 'confidence')
  // Use whichever form keeps the small probability exact: near 1 the tail
  // (1 - c) / 2 is exact enough, near 0 the central form 0.5 + c / 2 is.
  return c <= 0.5 ? normalQuantile(0.5 + c / 2) : zForTail((1 - c) / 2)
}

/** z such that a standard normal has probability `tail` above it; 0 < tail < 0.5. */
export function zForTail(tail: number): number {
  return -normalQuantile(tail)
}

/**
 * Lower Wilson limit. Written as s^2 / (n (A + B)), which equals the textbook
 * (A - B) / (n + z^2) but has no subtractive cancellation when s is small.
 */
function lowerLimit(s: number, n: number, z: number): number {
  if (s === 0) return 0
  const z2 = z * z
  const a = s + z2 / 2
  const b = z * Math.sqrt((s * (n - s)) / n + z2 / 4)
  return (s * s) / (n * (a + b))
}

/** Upper Wilson limit, (A + B) / (n + z^2): every term is positive, so no cancellation. */
function upperLimit(s: number, n: number, z: number): number {
  const z2 = z * z
  const a = s + z2 / 2
  const b = z * Math.sqrt((s * (n - s)) / n + z2 / 4)
  return (a + b) / (n + z2)
}

/** Interval for already-validated counts and an already-computed z. */
export function wilsonWithZ(s: number, n: number, z: number): { low: number; high: number; point: number } {
  const point = s / n
  // Each limit is computed in the form that is accurate in relative terms where
  // it is small. Past the midpoint the upper limit is the mirror image of the
  // lower limit for the failures, which also makes the edge s = n give exactly 1.
  const low = Math.min(lowerLimit(s, n, z), point)
  const rawHigh = 2 * s <= n ? upperLimit(s, n, z) : 1 - lowerLimit(n - s, n, z)
  const high = Math.min(1, Math.max(rawHigh, point))
  return { low, high, point }
}

/**
 * Wilson (1927) score interval for a binomial proportion.
 *
 * Throws TypeError when an argument is not a number, RangeError when n is not
 * a whole number from 1 to Number.MAX_SAFE_INTEGER, when successes is not a
 * whole number from 0 to n, or when confidence is not strictly between 0 and
 * 1. -0 is read as 0.
 */
export function wilsonInterval(
  successes: number,
  n: number,
  options?: WilsonOptions,
): WilsonInterval {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new TypeError('options must be an object')
  }
  const confidenceInput = options === undefined ? undefined : options.confidence
  const nValue = readCount(n, 'n', 1)
  const s = readCount(successes, 'successes', 0)
  if (s > nValue) {
    throw new RangeError(`successes must not exceed n (${String(s)} > ${String(nValue)})`)
  }
  const confidence = confidenceInput === undefined ? DEFAULT_CONFIDENCE : confidenceInput
  const z = zForConfidence(confidence)
  const { low, high, point } = wilsonWithZ(s, nValue, z)
  return { low, high, point, confidence, z, successes: s, n: nValue }
}

