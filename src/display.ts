// Reads the printed form of a claimed figure ("99.8%", "99%+", "<1%", "about
// 95%", "95-98%", "1 in 10,000") into the figure a reader takes away, using the
// favorable reading, and answers the exact questions the verdict needs.

import { matchesCount } from './census.js'
import { atLeastDecimal, atMostDecimal, beyondOneUlp, splitDouble, withinHalfUnit } from './exact.js'
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
  /** True for "over 99%" / "<1%": the bound itself does not satisfy the claim. */
  strict: boolean
  /** True when the printed value agrees with `value` to its rounding (plus one ulp). */
  consistentWith(value: number): boolean
  /**
   * True when `value` is what this figure says: a point, approximate figure, range or
   * "1 in N" within its printed rounding, a floor at or below the value, a ceiling at or
   * above it (strict bounds exclude equality). One ulp of representation error is allowed.
   */
  agreesWith(value: number): boolean
  /** True when the observed rate k / n equals the figure to its printed precision. */
  matchesObserved(k: number, n: number): boolean
  /**
   * Census check of the printed figure against the exact count k / n: a bound as
   * an inequality (strict ones exclude equality), a point, range end or "1 in N"
   * as a match to its printed precision.
   */
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

const PREFIXES: readonly (readonly [string, 'floor' | 'ceiling' | 'approx', boolean, boolean])[] = [
  // [text, kind, needs a space after, strict]
  ['>=', 'floor', false, false],
  ['≥', 'floor', false, false],
  ['>', 'floor', false, true],
  ['<=', 'ceiling', false, false],
  ['≤', 'ceiling', false, false],
  ['<', 'ceiling', false, true],
  ['≈', 'approx', false, false],
  ['~', 'approx', false, false],
  ['at least', 'floor', true, false],
  ['more than', 'floor', true, true],
  ['greater than', 'floor', true, true],
  ['over', 'floor', true, true],
  ['above', 'floor', true, true],
  ['at most', 'ceiling', true, false],
  ['no more than', 'ceiling', true, false],
  ['less than', 'ceiling', true, true],
  ['fewer than', 'ceiling', true, true],
  ['up to', 'ceiling', true, false],
  ['under', 'ceiling', true, true],
  ['below', 'ceiling', true, true],
  ['approximately', 'approx', true, false],
  ['approx.', 'approx', true, false],
  ['approx', 'approx', true, false],
  ['about', 'approx', true, false],
  ['around', 'approx', true, false],
  ['roughly', 'approx', true, false],
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
      strict: false,
      consistentWith(value: number): boolean {
        // 1/(N + h) <= value <= 1/(N - h), with one ulp of slack each way
        const { mantissa, exponent } = splitDouble(value)
        if (exponent >= 0) return false
        const d = 1n << BigInt(-exponent)
        return (mantissa + 1n) * (n2 + unit) >= 2n * d && (mantissa === 0n ? -1n : mantissa - 1n) * (n2 - unit) <= 2n * d
      },
      agreesWith(value: number): boolean {
        return this.consistentWith(value)
      },
      matchesObserved: (k, n) => BigInt(k) * (n2 + unit) >= 2n * BigInt(n) && BigInt(k) * (n2 - unit) <= 2n * BigInt(n),
      satisfiedBy: (k, n) => BigInt(k) * (n2 + unit) >= 2n * BigInt(n) && BigInt(k) * (n2 - unit) <= 2n * BigInt(n),
    }
  }

  let kind: 'percent' | 'floor' | 'ceiling' | 'approx' = 'percent'
  let strict = false
  for (const [prefix, prefixKind, needsSpace, prefixStrict] of PREFIXES) {
    if (t.startsWith(prefix)) {
      let rest = t.slice(prefix.length)
      if (needsSpace) {
        if (!rest.startsWith(' ')) continue
        rest = rest.slice(1)
      } else if (rest.startsWith(' ')) {
        rest = rest.slice(1)
      }
      kind = prefixKind
      strict = prefixStrict
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
        strict: false,
        consistentWith(value: number): boolean {
          // inside the range, with only one ulp of representation error at each end
          return atLeastDecimal(value, low.digits, low.decimals + 2) && atMostDecimal(value, high.digits, high.decimals + 2)
        },
        agreesWith(value: number): boolean {
          return this.consistentWith(value)
        },
        matchesObserved: (k, n) => matchesCount(end.digits, end.decimals + 2, k, n),
        // a range is judged at its favorable end, as a point
        satisfiedBy: (k, n) => matchesCount(end.digits, end.decimals + 2, k, n),
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
  const isBound = form === 'floor' || form === 'ceiling'
  if (isBound && strict && ((form === 'floor' && num.digits === 10n ** BigInt(scale)) || (form === 'ceiling' && num.digits === 0n))) {
    // nothing is above 100% or below 0%
    throw new RangeError(`claim.display "${clip(display)}" asks for more than 100% or less than 0%, which is impossible`)
  }
  return {
    info: { form, figure: proportionOf(num), decimals: num.decimals },
    bound: isBound ? form : null,
    strict: isBound && strict,
    consistentWith: (value) => withinHalfUnit(value, num.digits, scale, scale),
    agreesWith(value: number): boolean {
      const shown = proportionOf(num)
      if (form === 'floor') return strict ? beyondOneUlp(value, shown, true) : !beyondOneUlp(shown, value, true)
      if (form === 'ceiling') return strict ? beyondOneUlp(value, shown, false) : !beyondOneUlp(shown, value, false)
      return withinHalfUnit(value, num.digits, scale, scale)
    },
    matchesObserved: (k, n) => matchesCount(num.digits, scale, k, n),
    satisfiedBy(k, n): boolean {
      const lhs = num.digits * BigInt(n) - BigInt(k) * 10n ** BigInt(scale)
      if (form === 'floor') return strict ? lhs < 0n : lhs <= 0n // figure < or <= k/n
      if (form === 'ceiling') return strict ? lhs > 0n : lhs >= 0n // figure > or >= k/n
      return matchesCount(num.digits, scale, k, n)
    },
  }
}


// ---- figures in the claim's own wording ---------------------------------

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PREFIX_ALTERNATIVES = PREFIXES.map(([text]) => text)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|')
const TEXT_NUM = '\\d{1,3}(?:\\.\\d{1,15})?'
/** A printed figure inside prose: an optional bound or approximation word, then a percent, a range or "1 in N". */
const TEXT_FIGURE = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?:(?:${PREFIX_ALTERNATIVES}) ?)?(?:${TEXT_NUM}(?: ?%)? ?(?:-|to) ?${TEXT_NUM} ?%|${TEXT_NUM} ?\\+? ?%\\+?|1 in (?:[1-9]\\d{0,2}(?:,\\d{3})+|[1-9]\\d{0,14}))(?![\\p{N}])`,
  'gu',
)
const ABSOLUTE_WORDS = /(?<![\p{L}\p{N}])(?:perfect|flawless|error-free|no errors|zero errors)(?![\p{L}\p{N}])/u
/** Most figures read from one text; each is cheap, but the count is bounded anyway. */
const MAX_TEXT_FIGURES = 50

/**
 * The figures in `text` that say something other than the judged figure, as
 * written (folded). A figure is read by the same parser as `claim.display`;
 * one that cannot be read (a bound pointing the wrong way for the metric, an
 * impossible percent) is skipped. A figure agrees when it describes `value` or
 * `assessed` (the value, or the printed display that was judged instead), or,
 * for a point, approximate or range figure, their complement ("87.7% right"
 * beside a 12.3% error rate). The words perfect, flawless, error-free, no
 * errors and zero errors mean 100% (0% for a lower-is-better metric). The
 * text is only scanned, never judged: nothing here changes a verdict.
 */
export function textFiguresDiffering(text: string, value: number, assessed: number, higherIsBetter: boolean): string[] {
  // "99.9 percent" is the figure "99.9%"
  const folded = foldText(text).replace(/(\d) ?(?:percent|per cent|pct)(?![\p{L}\p{N}])/gu, '$1%')
  const differing: string[] = []
  let seen = 0
  for (const match of folded.matchAll(TEXT_FIGURE)) {
    if (seen >= MAX_TEXT_FIGURES) break
    seen += 1
    const snippet = match[0]
    let figure: DisplayFigure
    try {
      figure = parseDisplayFigure(snippet, higherIsBetter)
    } catch {
      continue
    }
    let agrees = figure.agreesWith(value) || figure.agreesWith(assessed)
    if (!agrees && figure.bound === null) agrees = figure.agreesWith(1 - value) || figure.agreesWith(1 - assessed)
    if (!agrees) differing.push(snippet)
  }
  const absolute = ABSOLUTE_WORDS.exec(folded)
  if (absolute !== null) {
    const exact = higherIsBetter ? 1 : 0
    if (value !== exact && assessed !== exact) differing.push(absolute[0])
  }
  return differing
}
