// Exact helpers for claims about a complete, fixed set (a benchmark): there is
// no sampling, so the claim is compared with the exact count, not an interval.

import { VALUE_NOISE, VALUE_NOISE_EXPONENT, snapAbsolute } from './exact.js'

/**
 * The decimal digits a number is written with, read from its shortest
 * round-trip text (never from binary expansion): 0.799 -> digits 799, scale 3;
 * 5e-7 -> digits 5, scale 7 (value = digits / 10^scale).
 *
 * A double within VALUE_NOISE of a shorter decimal is read as that decimal, so
 * the noisy results of 82.7 / 100 (0.8270000000000001), 82.7 * 0.01 and
 * 1 - 800 / 1000 (0.19999999999999996) read as 0.827 and 0.2 and not as a
 * sixteen-digit figure nobody wrote.
 */
export function valueDigits(value: number): { digits: bigint; scale: number } {
  const text = shortestWithinNoise(value)
  const at = text.indexOf('e')
  const mantissa = at < 0 ? text : text.slice(0, at)
  const exponent = at < 0 ? 0 : Number(text.slice(at + 1))
  const dot = mantissa.indexOf('.')
  const whole = dot < 0 ? mantissa : mantissa.slice(0, dot)
  let fraction = dot < 0 ? '' : mantissa.slice(dot + 1)
  let end = fraction.length
  while (end > 0 && fraction.charCodeAt(end - 1) === 48) end -= 1 // trailing zeros, scanned from the end
  fraction = fraction.slice(0, end)
  return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length - exponent }
}

/** The shortest decimal text (from 1 to 16 significant digits) within VALUE_NOISE of `value`, else its round-trip text. */
export function shortestWithinNoise(value: number): string {
  if (value === 0) return '0'
  for (let digits = 1; digits <= 16; digits++) {
    const text = value.toPrecision(digits)
    if (Math.abs(Number(text) - value) <= VALUE_NOISE) return text
  }
  return String(value)
}

/**
 * True when the printed figure digits / 10^scale matches k / n:
 * 0 matches only k = 0, 1 matches only k = n (an absolute claim is never
 * rounded), and otherwise |digits / 10^scale - k / n| <= 1/2 * 10^-scale.
 * Exact integer arithmetic.
 */
export function matchesCount(digits: bigint, scale: number, k: number, n: number): boolean {
  if (digits === 0n) return k === 0
  if (digits === 10n ** BigInt(scale)) return k === n
  const lhs = digits * BigInt(n) - BigInt(k) * 10n ** BigInt(scale)
  return 2n * (lhs < 0n ? -lhs : lhs) <= BigInt(n)
}

/**
 * The finest decimal place a bare value can be read at is a whole percent:
 * 0.9 means 90%, within half a point, never 90 plus or minus 5 points. A value
 * written with more digits keeps them.
 */
export const COARSEST_VALUE_SCALE = 2

/**
 * True when the double `x` matches k / n: 0 and 1 are exact claims (a value
 * within VALUE_NOISE of either is that claim; see snapAbsolute); otherwise the
 * decimal `x` is written as (see valueDigits) must be within half a unit of
 * its own last digit (never coarser than a whole percent) plus VALUE_NOISE of
 * k / n, so a value computed as k / n, or as 1 - (n - k) / n, in floating point
 * matches its own count and a value a little off a rounded figure is judged
 * like that figure. Exact integer arithmetic.
 */
export function matchesValue(x: number, k: number, n: number): boolean {
  const exact = snapAbsolute(x)
  if (exact === 0) return k === 0
  if (exact === 1) return k === n
  const { digits, scale: own } = valueDigits(x)
  const half = 10n ** BigInt(Math.max(own, COARSEST_VALUE_SCALE)) // half a unit is 1 / (2 half)
  const written = 10n ** BigInt(own)
  const bn = BigInt(n)
  // |digits / written - k / n| <= 1 / (2 half) + 2^NOISE_EXPONENT, multiplied
  // through by 2 half written n 2^-NOISE_EXPONENT
  const shift = BigInt(-VALUE_NOISE_EXPONENT)
  const gap = digits * bn - BigInt(k) * written
  return ((2n * half * (gap < 0n ? -gap : gap)) << shift) <= ((written * bn) << shift) + 2n * half * written * bn
}

/**
 * Most percent decimals worth printing for a count out of n: the largest d
 * with 10^(d+2) <= 10 n. Digits past that only restate the fraction k / n.
 */
export function countDecimals(n: number): number {
  const limit = 10n * BigInt(n)
  let d = 0
  while (limit >= 10n ** BigInt(d + 3)) d += 1
  return d
}
