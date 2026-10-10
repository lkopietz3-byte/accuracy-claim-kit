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
 * True when |x - D / 10^scale| <= 1/2 * 10^-places, judged on the exact value
 * of the double x. `digits` is D as a BigInt and the printed figure is
 * D / 10^scale; `places` is how many of those decimals are the last digit's
 * place (so half a unit of the last digit is 0.5 * 10^-places).
 */
export function withinHalfUnit(x: number, digits: bigint, scale: number, places: number): boolean {
  // Work in units of 10^-scale: |x * 10^scale - D| <= 10^(scale - places) / 2.
  const { mantissa, exponent } = splitDouble(x)
  const ten = 10n ** BigInt(scale)
  const allowance = 10n ** BigInt(scale - places) // twice the half-unit, in the same units
  if (exponent >= 0) {
    const lhs = 2n * mantissa * (1n << BigInt(exponent)) * ten - 2n * digits
    return (lhs < 0n ? -lhs : lhs) <= allowance
  }
  const s = 1n << BigInt(-exponent)
  const lhs = 2n * mantissa * ten - 2n * digits * s
  return (lhs < 0n ? -lhs : lhs) <= allowance * s
}
