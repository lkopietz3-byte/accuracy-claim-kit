import { shortestWithinNoise, valueDigits } from './census.js'
import { splitDouble } from './exact.js'

// Number formatting for statements. Bounds are rounded in the direction that
// never makes the evidence look better than it is: a lower limit is floored,
// an upper limit is ceiled. The rounding is exact: the double is split into its
// integer mantissa and power of two and the scaled value is floored or ceiled
// with BigInt arithmetic, so a printed figure can never sit on the wrong side
// of the number it describes (no fixed slack, no floating-point multiply).

/** floor or ceil of x * 100 * 10^decimals for a finite x >= 0, exactly. */
function scaledUnits(x: number, decimals: number, mode: 'floor' | 'ceil'): bigint {
  const { mantissa, exponent } = splitDouble(x)
  const numerator = mantissa * 100n * 10n ** BigInt(decimals)
  if (exponent >= 0) return numerator << BigInt(exponent)
  const denominator = 1n << BigInt(-exponent)
  const quotient = numerator / denominator
  return mode === 'ceil' && numerator % denominator !== 0n ? quotient + 1n : quotient
}

function render(units: bigint, decimals: number): string {
  if (decimals === 0) return `${String(units)}%`
  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const fraction = String(units % scale).padStart(decimals, '0')
  return `${String(whole)}.${fraction}%`
}

function checkProportion(x: number, decimals: number): void {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
    throw new RangeError(`proportion must be a finite number from 0 to 1, got ${String(x)}`)
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) {
    throw new RangeError('decimals must be a whole number from 0 to 20')
  }
}

/** A proportion as a percent, rounded down to `decimals` places. */
export function pctFloor(proportion: number, decimals: number): string {
  checkProportion(proportion, decimals)
  return render(scaledUnits(proportion, decimals, 'floor'), decimals)
}

/** A proportion as a percent, rounded up to `decimals` places. */
export function pctCeil(proportion: number, decimals: number): string {
  checkProportion(proportion, decimals)
  return render(scaledUnits(proportion, decimals, 'ceil'), decimals)
}

/** Nearest, for figures that are not bounds (the claim itself, a width). */
export function pctNearest(proportion: number, decimals: number): string {
  return `${(proportion * 100).toFixed(decimals)}%`
}

/**
 * A number to `decimals` places, cut in a chosen direction instead of rounded to
 * the nearest, from the digits it is written with (0.57 is 0.57, not 0.5699...):
 * 'down' never shows more than the number (0.9996 is 0.99, -0.456 is -0.46),
 * 'up' never shows less (a required minimum of 0.8004 is 0.801).
 */
export function decimalCut(x: number, decimals: number, direction: 'down' | 'up'): string {
  const negative = x < 0
  const { digits, scale } = valueDigits(Math.abs(x))
  let units: bigint
  if (scale <= decimals) {
    units = digits * 10n ** BigInt(decimals - scale)
  } else {
    const unit = 10n ** BigInt(scale - decimals)
    const rest = digits % unit
    // the size of a negative number grows when it is cut down, a positive one when it is cut up
    const grows = negative ? direction === 'down' : direction === 'up'
    units = digits / unit + (grows && rest !== 0n ? 1n : 0n)
  }
  const whole = units / 10n ** BigInt(decimals)
  const fraction = decimals === 0 ? '' : `.${String(units % 10n ** BigInt(decimals)).padStart(decimals, '0')}`
  return `${negative && units !== 0n ? '-' : ''}${String(whole)}${fraction}`
}

/**
 * A confidence level as a percent label, rounded down to at most 9 decimals
 * and never 100%. It works on the shortest decimal text of the number within
 * float noise (0.95 reads "95%", not "94.999999999%", and 1 - 0.07 reads "93%"),
 * so a level a person typed or computed keeps the digits they meant.
 */
export function confidenceLabel(confidence: number): string {
  // 1 - 0.07 is 0.9299999999999999: the level a person wrote, 93%, is the shortest decimal within
  // float noise of it. A level that noise would carry up to 1 keeps its own digits (never 100%).
  const nearest = shortestWithinNoise(confidence)
  let text = Number(nearest) < 1 ? nearest : String(confidence)
  const at = text.indexOf('e')
  if (at >= 0) {
    // 1.5e-7 is 0.00000015: expand the digits the number is written with, never the binary expansion
    const exponent = Number(text.slice(at + 1))
    const mantissa = text.slice(0, at).replace('.', '')
    text = `0.${'0'.repeat(Math.max(0, -exponent - 1))}${mantissa}`
  }
  const digits = text.slice(2) // after "0."
  const whole = Number(digits.slice(0, 2).padEnd(2, '0')) // percent, integer part
  const fraction = digits.slice(2, 11).replace(/0+$/, '')
  if (whole === 0 && fraction === '') return 'under 0.000000001%'
  return `${String(whole)}${fraction === '' ? '' : `.${fraction}`}%`
}

const LEVELS = [1, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001, 1e-7, 1e-8, 1e-9, 1e-10, 1e-11, 1e-12, 1e-13, 1e-14, 1e-15]

/**
 * Most decimals a percent figure can print before its last digit is finer
 * than one tenth of the interval width. A figure with D decimals has a last
 * digit worth 10^-D percentage points; it is supported while
 * 10^-D >= (width in percentage points) / 10. Whole-percent figures (0
 * decimals) are always allowed. `width` is the interval width as a
 * proportion (high - low).
 */
export function maxDisplayDecimals(width: number): number {
  if (typeof width !== 'number') throw new TypeError('width must be a number')
  if (!Number.isFinite(width) || width < 0 || width > 1) {
    throw new RangeError(`width must be a finite number from 0 to 1, got ${String(width)}`)
  }
  const unitFloor = (width * 100) / 10
  let d = 0
  // A relative slack of 1e-12 makes "exactly one tenth" count as supported.
  while (d + 1 < LEVELS.length && (LEVELS[d + 1] as number) >= unitFloor * (1 - 1e-12)) d += 1
  return d
}
