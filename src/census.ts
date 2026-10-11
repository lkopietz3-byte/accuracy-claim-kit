// Exact helpers for claims about a complete, fixed set (a benchmark): there is
// no sampling, so the claim is compared with the exact count, not an interval.

import { splitDouble } from './exact.js'

/**
 * The decimal digits a number is written with, read from its shortest
 * round-trip text (never from binary expansion): 0.799 -> digits 799, scale 3;
 * 5e-7 -> digits 5, scale 7 (value = digits / 10^scale).
 */
export function valueDigits(value: number): { digits: bigint; scale: number } {
  const text = String(value)
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
 * True when the double `x` matches k / n: 0 and 1 are exact claims; otherwise
 * the exact value of the double must be within half a unit of its own last
 * shortest-text digit plus one ulp of `x` itself, so a value
 * computed as k / n in floating point matches its own count.
 */
export function matchesValue(x: number, k: number, n: number): boolean {
  if (x === 0) return k === 0
  if (x === 1) return k === n
  const { scale } = valueDigits(x)
  const { mantissa, exponent } = splitDouble(x)
  const ten = 10n ** BigInt(scale)
  const bn = BigInt(n)
  // |m 2^e - k/n| <= 1/(2 10^s) + 2^e, multiplied through by 2 n 10^s 2^-e (e < 0 here)
  if (exponent >= 0) {
    const big = mantissa << BigInt(exponent)
    const lhs = big * bn - BigInt(k)
    return 2n * ten * (lhs < 0n ? -lhs : lhs) <= bn + 2n * bn * ten * (1n << BigInt(exponent))
  }
  const d = 1n << BigInt(-exponent)
  const lhs = mantissa * bn - BigInt(k) * d
  return 2n * ten * (lhs < 0n ? -lhs : lhs) <= bn * d + 2n * bn * ten
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
