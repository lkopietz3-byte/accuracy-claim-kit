// Exact views of a double, so comparisons and roundings that must be right to
// the last digit do not go through floating-point multiplication.

const SCRATCH = new DataView(new ArrayBuffer(8))

/** x = mantissa * 2^exponent exactly, for a finite x >= 0. */
export function splitDouble(x: number): { mantissa: bigint; exponent: number } {
  SCRATCH.setFloat64(0, x)
  const bits = SCRATCH.getBigUint64(0)
  const biased = Number((bits >> 52n) & 0x7ffn)
  const fraction = bits & ((1n << 52n) - 1n)
  return {
    mantissa: biased === 0 ? fraction : fraction | (1n << 52n),
    exponent: (biased === 0 ? 1 : biased) - 1075,
  }
}

/**
 * True when |x - D / 10^scale| <= 1/2 * 10^-places + 1 ulp of x, judged on the
 * exact value of the double x. `digits` is D as a BigInt and the printed figure
 * is D / 10^scale; `places` is the decimal place of the printed last digit (so
 * half a unit of it is 0.5 * 10^-places). The one-ulp allowance is the spacing
 * of doubles at x (2^exponent of its mantissa), so a value that is the double
 * nearest to a figure a person rounded by hand is never rejected for the
 * double's own representation error, while a real gap many ulps wide still is.
 * No floating-point tolerance is involved.
 */
export function withinHalfUnit(x: number, digits: bigint, scale: number, places: number): boolean {
  // Work in units of 10^-scale and double everything to keep 1/2 an integer:
  // 2 |x * 10^scale - D| <= 10^(scale - places) + 2 * ulp * 10^scale
  const { mantissa, exponent } = splitDouble(x)
  const ten = 10n ** BigInt(scale)
  const half = 10n ** BigInt(scale - places) // twice the half-unit
  if (exponent >= 0) {
    const lhs = 2n * mantissa * (1n << BigInt(exponent)) * ten - 2n * digits
    return (lhs < 0n ? -lhs : lhs) <= half + 2n * (1n << BigInt(exponent)) * ten
  }
  const s = 1n << BigInt(-exponent) // 1 / ulp
  const lhs = 2n * mantissa * ten - 2n * digits * s
  return (lhs < 0n ? -lhs : lhs) <= half * s + 2n * ten
}

/** True when x + 1 ulp >= digits / 10^scale (x is at or above the decimal, up to representation error). */
export function atLeastDecimal(x: number, digits: bigint, scale: number): boolean {
  const { mantissa, exponent } = splitDouble(x)
  const ten = 10n ** BigInt(scale)
  if (exponent >= 0) return ((mantissa + 1n) << BigInt(exponent)) * ten >= digits
  return (mantissa + 1n) * ten >= digits * (1n << BigInt(-exponent))
}

/** True when x - 1 ulp <= digits / 10^scale (x is at or below the decimal, up to representation error). */
export function atMostDecimal(x: number, digits: bigint, scale: number): boolean {
  const { mantissa, exponent } = splitDouble(x)
  const ten = 10n ** BigInt(scale)
  if (mantissa === 0n) return true
  if (exponent >= 0) return ((mantissa - 1n) << BigInt(exponent)) * ten <= digits
  return (mantissa - 1n) * ten <= digits * (1n << BigInt(-exponent))
}

/**
 * True when `a` is more favorable than `b` by more than one ulp of `a`.
 * "More favorable" is higher when `higherIsBetter`, else lower. A value built
 * as printedPercent / 100 can sit one ulp from the figure it was printed as;
 * that is the same figure, not a more favorable one.
 */
export function beyondOneUlp(a: number, b: number, higherIsBetter: boolean): boolean {
  const gap = higherIsBetter ? a - b : b - a
  if (!(gap > 0)) return false
  return gap > 2 ** splitDouble(a).exponent
}
