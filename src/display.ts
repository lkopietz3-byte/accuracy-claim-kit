// Reads the printed form of a claimed figure ("99.8%", "99%+", "<1%", "about
// 95%", "95-98%", "1 in 10,000") into the figure a reader takes away, using the
// favorable reading, and answers the exact questions the verdict needs.

import { matchesCount } from './census.js'
import { splitDouble, withinHalfUnit } from './exact.js'
import { foldText } from './text.js'
import { clip } from './validate.js'

export type DisplayForm = 'percent' | 'approx' | 'floor' | 'ceiling' | 'range' | 'one-in-n'

/** What a result records about the parsed display. */
export interface ParsedDisplayInfo {
  form: DisplayForm
  /** The figure judged, as a proportion (0.99 for "99%+"). */
  figure: number
  /** Decimal places of the printed percent, or null for "1 in N". */
  decimals: number | null
}

export interface DisplayFigure {
  info: ParsedDisplayInfo
  /** "floor" for "99%+" style claims, "ceiling" for "<1%", else null. */
  bound: 'floor' | 'ceiling' | null
  /** True when the printed value agrees with `value` to its rounding (plus one ulp). */
  consistentWith(value: number): boolean
  /** True when the observed rate k / n equals the figure to its printed precision. */
  matchesObserved(k: number, n: number): boolean
  /** Census check: the exact count k / n satisfies the printed figure (a bound as an inequality). */
  satisfiedBy(k: number, n: number): boolean
}

interface Num {
  whole: string
  frac: string
  digits: bigint
  decimals: number
}

const NUM = '(\\d{1,3}(?:\\.\\d{1,15})?)'
const RANGE = new RegExp(`^${NUM} ?%? ?(?:-|–|—|to) ?${NUM} ?%$`)
const SINGLE = new RegExp(`^${NUM} ?%$`)
const PLUS_BEFORE_PERCENT = new RegExp(`^${NUM}\\+ ?%$`)
const ONE_IN_N = /^1 in ((?:[1-9]\d{0,2}(?:,\d{3})+)|(?:[1-9]\d{0,14}))$/

const PREFIXES: readonly (readonly [string, 'floor' | 'ceiling' | 'approx', boolean])[] = [
  // [text, kind, needs a space after]
  ['>=', 'floor', false],
  ['≥', 'floor', false],
  ['>', 'floor', false],
  ['<=', 'ceiling', false],
  ['≤', 'ceiling', false],
  ['<', 'ceiling', false],
  ['≈', 'approx', false],
  ['~', 'approx', false],
  ['at least', 'floor', true],
  ['more than', 'floor', true],
  ['greater than', 'floor', true],
  ['over', 'floor', true],
  ['above', 'floor', true],
  ['at most', 'ceiling', true],
  ['no more than', 'ceiling', true],
  ['less than', 'ceiling', true],
  ['fewer than', 'ceiling', true],
  ['up to', 'ceiling', true],
  ['under', 'ceiling', true],
  ['below', 'ceiling', true],
  ['approximately', 'approx', true],
  ['approx.', 'approx', true],
  ['approx', 'approx', true],
  ['about', 'approx', true],
  ['around', 'approx', true],
  ['roughly', 'approx', true],
]

function bad(display: string): RangeError {
  return new RangeError(
    `claim.display must be a percent such as "99.8%", "99%+", "<1%", "about 95%", "95-98%" or "1 in 10,000"; got "${clip(display)}"`,
  )
}

function readNum(text: string, display: string): Num {
  const [whole = '', frac = ''] = text.split('.')
  if (Number(whole) > 100 || (Number(whole) === 100 && /[1-9]/.test(frac))) {
    throw new RangeError(`claim.display must be between 0% and 100%; got "${clip(display)}"`)
  }
  return { whole, frac, digits: BigInt(`${whole}${frac}`), decimals: frac.length }
}

function proportionOf(num: Num): number {
  // Parsing "99.8e-2" is correctly rounded; dividing 99.8 by 100 is not always.
  return Number(`${num.frac === '' ? num.whole : `${num.whole}.${num.frac}`}e-2`)
}

function numLess(a: Num, b: Num): boolean {
  const scale = Math.max(a.decimals, b.decimals)
  return a.digits * 10n ** BigInt(scale - a.decimals) < b.digits * 10n ** BigInt(scale - b.decimals)
}

/**
 * Parses the display for a metric where higher is better (accuracy, precision,
 * recall) or lower is better (error rates). Throws TypeError for a non-string
 * and RangeError for text that is not one of the forms above, or a bound that
 * points the wrong way for the metric ("<99%" accuracy).
 */
export function parseDisplayFigure(display: unknown, higherIsBetter: boolean): DisplayFigure {
  if (typeof display !== 'string') throw new TypeError('claim.display must be a string')
  if (display.length > 64) throw new RangeError('claim.display is too long to be a percent figure')
  let t = foldText(display)
  if (t.endsWith('.')) t = t.slice(0, -1)

  // "1 in N": 1/N, to the precision N is written with (trailing zeros are placeholders).
  const one = ONE_IN_N.exec(t)
  if (one !== null) {
    const digits = (one[1] as string).replace(/,/g, '')
    const big = BigInt(digits)
    const zeros = digits.length - digits.replace(/0+$/, '').length
    const unit = 10n ** BigInt(zeros) // twice the half-unit of N's last significant digit
    const n2 = 2n * big
    const figure = 1 / Number(digits)
    return {
      info: { form: 'one-in-n', figure, decimals: null },
      bound: null,
      consistentWith(value: number): boolean {
        // 1/(N + h) <= value <= 1/(N - h), with one ulp of slack each way
        const { mantissa, exponent } = splitDouble(value)
        if (exponent >= 0) return false
        const d = 1n << BigInt(-exponent)
        return (mantissa + 1n) * (n2 + unit) >= 2n * d && (mantissa === 0n ? -1n : mantissa - 1n) * (n2 - unit) <= 2n * d
      },
      matchesObserved: (k, n) => BigInt(k) * (n2 + unit) >= 2n * BigInt(n) && BigInt(k) * (n2 - unit) <= 2n * BigInt(n),
      satisfiedBy: (k, n) => BigInt(k) * (n2 + unit) >= 2n * BigInt(n) && BigInt(k) * (n2 - unit) <= 2n * BigInt(n),
    }
  }

  let kind: 'percent' | 'floor' | 'ceiling' | 'approx' = 'percent'
  for (const [prefix, prefixKind, needsSpace] of PREFIXES) {
    if (t.startsWith(prefix)) {
      let rest = t.slice(prefix.length)
      if (needsSpace) {
        if (!rest.startsWith(' ')) continue
        rest = rest.slice(1)
      } else if (rest.startsWith(' ')) {
        rest = rest.slice(1)
      }
      kind = prefixKind
      t = rest
      break
    }
  }

  if (kind === 'percent') {
    const range = RANGE.exec(t)
    if (range !== null) {
      const low = readNum(range[1] as string, display)
      const high = readNum(range[2] as string, display)
      if (numLess(high, low)) throw bad(display)
      const end = higherIsBetter ? high : low
      return {
        info: { form: 'range', figure: proportionOf(end), decimals: end.decimals },
        bound: null,
        consistentWith(value: number): boolean {
          const lo = proportionOf(low)
          const hi = proportionOf(high)
          return (
            (value > lo && value < hi) ||
            withinHalfUnit(value, low.digits, low.decimals + 2, low.decimals + 2) ||
            withinHalfUnit(value, high.digits, high.decimals + 2, high.decimals + 2)
          )
        },
        matchesObserved: (k, n) => matchesCount(end.digits, end.decimals + 2, k, n),
        satisfiedBy(k, n): boolean {
          // the exact count lies in the range, widened by half a unit at each end
          const s = Math.max(low.decimals, high.decimals) + 2
          const scale = 10n ** BigInt(s)
          const kk = BigInt(k) * 2n * scale
          const nn = BigInt(n)
          const loScaled = low.digits * 10n ** BigInt(s - low.decimals - 2) // in units of 10^-s proportion
          const hiScaled = high.digits * 10n ** BigInt(s - high.decimals - 2)
          const halfLo = 10n ** BigInt(s - low.decimals - 2)
          const halfHi = 10n ** BigInt(s - high.decimals - 2)
          return kk >= (2n * loScaled - halfLo) * nn && kk <= (2n * hiScaled + halfHi) * nn
        },
      }
    }
    // "99+%" is "99%+"
    const plus = PLUS_BEFORE_PERCENT.exec(t)
    if (plus !== null) {
      kind = 'floor'
      t = `${plus[1] as string}%`
    } else if (t.endsWith('+')) {
      kind = 'floor'
      t = t.slice(0, -1)
    }
  }

  const single = SINGLE.exec(t)
  if (single === null) throw bad(display)
  const num = readNum(single[1] as string, display)
  const form = kind
  if (form === 'floor' && !higherIsBetter) throw new RangeError(`claim.display "${clip(display)}" is a lower bound, which does not fit a metric where lower is better`)
  if (form === 'ceiling' && higherIsBetter) throw new RangeError(`claim.display "${clip(display)}" is an upper bound, which does not fit a metric where higher is better`)
  const scale = num.decimals + 2
  return {
    info: { form, figure: proportionOf(num), decimals: num.decimals },
    bound: form === 'floor' || form === 'ceiling' ? form : null,
    consistentWith: (value) => withinHalfUnit(value, num.digits, scale, scale),
    matchesObserved: (k, n) => matchesCount(num.digits, scale, k, n),
    satisfiedBy(k, n): boolean {
      const lhs = num.digits * BigInt(n) - BigInt(k) * 10n ** BigInt(scale)
      if (form === 'floor') return lhs <= 0n // figure <= k/n
      if (form === 'ceiling') return lhs >= 0n // figure >= k/n
      return matchesCount(num.digits, scale, k, n)
    },
  }
}

