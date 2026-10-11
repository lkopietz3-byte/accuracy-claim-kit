// Exact helpers for claims about a complete, fixed set (a benchmark): there is
// no sampling, so the claim is compared with the exact count, not an interval.

/** The decimal digits a number was written with: 0.799 -> digits 799, scale 3 (value = digits / 10^scale). */
export function valueDigits(value: number): { digits: bigint; scale: number } {
  const text = String(value).includes('e') ? value.toFixed(40) : String(value)
  const [whole = '0', fraction = ''] = text.split('.')
  let end = fraction.length
  while (end > 0 && fraction.charCodeAt(end - 1) === 48) end -= 1 // trailing zeros, scanned from the end
  const frac = fraction.slice(0, end)
  return { digits: BigInt(`${whole}${frac}`), scale: frac.length }
}

/**
 * True when digits / 10^scale equals k / n to the printed precision, i.e. when
 * |digits / 10^scale - k / n| <= 1/2 * 10^-scale, in exact integer arithmetic.
 */
export function matchesCount(digits: bigint, scale: number, k: number, n: number): boolean {
  const lhs = digits * BigInt(n) - BigInt(k) * 10n ** BigInt(scale)
  return 2n * (lhs < 0n ? -lhs : lhs) <= BigInt(n)
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
