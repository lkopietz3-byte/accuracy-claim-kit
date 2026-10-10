// Inverse of the standard normal CDF. Acklam's rational approximation
// (relative error about 1.15e-9) followed by one Halley refinement step that
// evaluates the CDF through erf / erfc written out below, so the result is
// accurate to a few units of 1e-16 across the whole open interval (0, 1).
// Below about 1e-300 the exp(x^2/2) factor of the refinement overflows; there
// the unrefined approximation (about 1e-9 relative) is returned.

const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
] as const
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
] as const
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
] as const
const D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
] as const
const P_LOW = 0.02425

const SQRT_PI = Math.sqrt(Math.PI)
const SQRT_2 = Math.SQRT2
const SQRT_2PI = Math.sqrt(2 * Math.PI)

/** erf(y) for 0 <= y <= about 5, from the all-positive series (no cancellation). */
function erfSeries(y: number): number {
  const y2 = y * y
  let term = y
  let sum = y
  for (let n = 1; n < 500; n++) {
    term *= (2 * y2) / (2 * n + 1)
    sum += term
    if (term < sum * 1e-17) break
  }
  return (2 / SQRT_PI) * Math.exp(-y2) * sum
}

/** erfc(y) for y >= 1 from the continued fraction with partial numerators k/2. */
function erfcContinuedFraction(y: number): number {
  let f = y
  for (let k = 100; k >= 1; k--) {
    f = y + k / 2 / f
  }
  return Math.exp(-y * y) / (SQRT_PI * f)
}

function erfcPositive(y: number): number {
  return y < 1 ? 1 - erfSeries(y) : erfcContinuedFraction(y)
}

/** Initial guess for p in (0, 0.5]. */
function acklamLower(p: number): number {
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  )
}

/** Quantile for p in (0, 0.5]; p = 0.5 gives exactly 0. */
function quantileLower(p: number): number {
  if (p === 0.5) return 0
  let x = acklamLower(p)
  // e = Phi(x) - p, computed so it stays accurate near 0.5 and in the tail.
  let e: number
  if (p >= P_LOW) {
    const y = Math.abs(x) / SQRT_2
    const half = 0.5 * erfSeries(y) * (x < 0 ? -1 : 1) // Phi(x) - 0.5
    e = half - (p - 0.5)
  } else {
    e = 0.5 * erfcPositive(-x / SQRT_2) - p
  }
  const u = e * SQRT_2PI * Math.exp((x * x) / 2)
  if (Number.isFinite(u)) {
    x = x - u / (1 + (x * u) / 2)
  }
  return x
}

/**
 * Inverse standard normal CDF: the x with P(Z <= x) = p.
 * Throws TypeError if p is not a number and RangeError unless 0 < p < 1.
 */
export function normalQuantile(p: number): number {
  if (typeof p !== 'number') {
    throw new TypeError('p must be a number')
  }
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`p must be strictly between 0 and 1, got ${String(p)}`)
  }
  // 1 - p is exact for p in [0.5, 1), so the upper half mirrors the lower half.
  return p > 0.5 ? -quantileLower(1 - p) : quantileLower(p)
}
