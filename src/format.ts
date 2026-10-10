// Number formatting for statements. Bounds are rounded in the direction that
// never makes the evidence look better than it is: a lower limit is floored,
// an upper limit is ceiled. A tiny slack (1e-7 of the last printed unit)
// keeps a bound like 0.98 from printing as 97.9 because of binary noise.

const SLACK = 1e-7

export function pctFloor(proportion: number, decimals: number): string {
  const scale = 10 ** decimals
  const units = Math.floor(proportion * 100 * scale + SLACK)
  return `${(Math.max(0, units) / scale).toFixed(decimals)}%`
}

export function pctCeil(proportion: number, decimals: number): string {
  const scale = 10 ** decimals
  const units = Math.ceil(proportion * 100 * scale - SLACK)
  return `${(Math.min(100 * scale, units) / scale).toFixed(decimals)}%`
}

export function pctNearest(proportion: number, decimals: number): string {
  return `${(proportion * 100).toFixed(decimals)}%`
}

export function confidenceLabel(confidence: number): string {
  return `${String(Number((confidence * 100).toPrecision(10)))}%`
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
