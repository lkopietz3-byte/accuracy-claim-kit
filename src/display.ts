// Reads the printed form of a claimed figure ("99.8%", "99%+", "<1%", "about
// 95%", "95-98%", "1 in 10,000") into the figure a reader takes away, using the
// favorable reading, and answers the exact questions the verdict needs.

import { matchesCount } from './census.js'
import { atLeastDecimal, atMostDecimal, beyondNoise, snapAbsolute, splitDouble, withinHalfUnit } from './exact.js'
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
  /** What the value had to satisfy when it disagrees with this figure, as the end of an error message. */
  mismatchHint: string
  /** For "1 in N": what band N was read at, to put in an explanation; null for every other form. */
  bandNote: string | null
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
/** A bound written after the figure: "95% or higher", "5% or lower". */
const BOUND_SUFFIX = /^(.*) or (higher|more|above|greater|lower|less|below)$/
const FLOOR_SUFFIXES: readonly string[] = ['higher', 'more', 'above', 'greater']

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
  ['greater than or equal to', 'floor', true, false],
  ['not less than', 'floor', true, false],
  ['no less than', 'floor', true, false],
  ['a minimum of', 'floor', true, false],
  ['minimum of', 'floor', true, false],
  ['more than', 'floor', true, true],
  ['greater than', 'floor', true, true],
  ['over', 'floor', true, true],
  ['above', 'floor', true, true],
  ['at most', 'ceiling', true, false],
  ['less than or equal to', 'ceiling', true, false],
  ['not more than', 'ceiling', true, false],
  ['a maximum of', 'ceiling', true, false],
  ['maximum of', 'ceiling', true, false],
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

/** A half-integer as text: 99.5, 100. `twice` is the value times two. */
function halves(twice: bigint): string {
  return twice % 2n === 0n ? String(twice / 2n) : `${String(twice / 2n)}.5`
}

function oneInN(text: string, kind: 'percent' | 'approx' | 'floor' | 'ceiling', strict: boolean, folded: string, display: string): DisplayFigure {
  const digits = text.replace(/,/g, '')
  const big = BigInt(digits)
  const bound = kind === 'floor' || kind === 'ceiling' ? kind : null
  if (kind === 'floor' && strict && big === 1n) {
    // nothing is above 100%
    throw new RangeError(`claim.display "${clip(display)}" asks for more than 100%, which is impossible`)
  }
  const approximate = kind === 'approx'
  const zeros = digits.length - digits.replace(/0+$/, '').length
  const placeholder = 10n ** BigInt(zeros)
  // twice the half-width of the band around N: 1 for an exact N, 10^zeros for an approximate one
  const unit = approximate ? placeholder : 1n
  const n2 = 2n * big
  const figure = 1 / Number(digits)
  const shown = `"${clip(folded, 30)}"`
  const band = `1 in ${halves(n2 - unit)} to 1 in ${halves(n2 + unit)}`
  const widen = zeros > 0 ? `; write "about 1 in ${digits}" to allow 1 in ${halves(n2 - placeholder)} to 1 in ${halves(n2 + placeholder)}` : ''
  // "1 in 1" is 100%: an absolute claim, never a band (1 in 0.5 to 1 in 1.5 would take in any rate from 66.7% up)
  const everything = big === 1n && bound === null
  const bandNote =
    bound !== null
      ? null
      : everything
        ? `${shown} is read as 100%, an absolute claim that matches only n of n.`
        : approximate
          ? `${shown} is read as ${band}.`
          : `${shown} is read as exactly 1 in ${digits} (${band})${widen}.`
  const within = (k: number, n: number): boolean =>
    everything ? k === n : BigInt(k) * (n2 + unit) >= 2n * BigInt(n) && BigInt(k) * (n2 - unit) <= 2n * BigInt(n)
  const consistentWith = (value: number): boolean => {
    if (everything) return snapAbsolute(value) === 1
    // 1/(N + h) <= value <= 1/(N - h), with one ulp of slack each way
    const { mantissa, exponent } = splitDouble(value)
    if (exponent >= 0) return false
    const d = 1n << BigInt(-exponent)
    return (mantissa + 1n) * (n2 + unit) >= 2n * d && (mantissa === 0n ? -1n : mantissa - 1n) * (n2 - unit) <= 2n * d
  }
  const satisfiedBy = (k: number, n: number): boolean => {
    if (bound === null) return within(k, n)
    // k / n against 1 / N, by integer arithmetic: floor 1/N <= k/n is k N >= n
    const lhs = BigInt(k) * big - BigInt(n)
    if (bound === 'floor') return strict ? lhs > 0n : lhs >= 0n
    return strict ? lhs < 0n : lhs <= 0n
  }
  const agreesWith = (value: number): boolean => {
    if (bound === 'floor') return strict ? beyondNoise(value, figure, true) : !beyondNoise(figure, value, true)
    if (bound === 'ceiling') return strict ? beyondNoise(value, figure, false) : !beyondNoise(figure, value, false)
    return consistentWith(value)
  }
  return {
    info: { form: bound ?? 'one-in-n', figure, decimals: null },
    bound,
    strict: bound !== null && strict,
    bandNote,
    mismatchHint: everything ? 'the value must be 1 (100%), which is what "1 in 1" means' : `the value must lie inside the band the display is read at (${band})`,
    consistentWith,
    agreesWith,
    matchesObserved: (k, n) => bound === null && within(k, n),
    satisfiedBy,
  }
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
  const folded = foldText(display)
  let t = folded
  if (t.endsWith('.')) t = t.slice(0, -1)

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

  // "95% or higher" is "at least 95%": a bound written after the figure. It does
  // not combine with a word in front, and on "1 in N" it would be ambiguous
  // ("1 in 100 or lower": a lower rate, or a lower N?), so those are not read.
  const suffix = BOUND_SUFFIX.exec(t)
  if (suffix !== null) {
    if (kind !== 'percent' || ONE_IN_N.test(suffix[1] as string)) throw bad(display)
    kind = FLOOR_SUFFIXES.includes(suffix[2] as string) ? 'floor' : 'ceiling'
    strict = false
    t = suffix[1] as string
  }

  // "1 in N": 1/N. N is exact (plus or minus one half) unless the figure is
  // written as approximate ("about 1 in 100"), when the trailing zeros of N are
  // placeholders: 100 means 50 to 150. A bound on it ("fewer than 1 in 1,000")
  // is a bound at 1/N.
  const one = ONE_IN_N.exec(t)
  if (one !== null) {
    if (kind === 'floor' && !higherIsBetter) throw new RangeError(`claim.display "${clip(display)}" is a lower bound, which does not fit a metric where lower is better`)
    if (kind === 'ceiling' && higherIsBetter) throw new RangeError(`claim.display "${clip(display)}" is an upper bound, which does not fit a metric where higher is better`)
    return oneInN(one[1] as string, kind, strict, folded, display)
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
        bandNote: null,
        mismatchHint: 'the value must lie inside the range',
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
    bandNote: null,
    mismatchHint: `they may differ by at most half a unit of the last digit printed (${(0.5 / 10 ** num.decimals).toFixed(num.decimals + 1)} percentage points)`,
    consistentWith: (value) => withinHalfUnit(value, num.digits, scale, scale),
    agreesWith(value: number): boolean {
      const shown = proportionOf(num)
      if (form === 'floor') return strict ? beyondNoise(value, shown, true) : !beyondNoise(shown, value, true)
      if (form === 'ceiling') return strict ? beyondNoise(value, shown, false) : !beyondNoise(shown, value, false)
      // a printed 100% or 0% is absolute: it is the figure only for a value that is exactly 1 or 0
      // (within the value noise), never for 99.6% that merely rounds to it (AGENTS.md: absolute claims).
      // A figure written as approximate ("about 100%") keeps its rounding band on purpose, in the text scan:
      // it does not claim certainty, and the README says so.
      if (form === 'percent' && (num.digits === 0n || num.digits === 10n ** BigInt(scale))) return snapAbsolute(value) === shown
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
  `(?<![\\p{L}\\p{N}.])(?:(?:${PREFIX_ALTERNATIVES}) ?)?(?:${TEXT_NUM}(?: ?%)? ?(?:-|to) ?${TEXT_NUM} ?%|${TEXT_NUM} ?\\+? ?%\\+?(?: or (?:higher|more|above|greater|lower|less|below))?|1 in (?:[1-9]\\d{0,2}(?:,\\d{3})+|[1-9]\\d{0,14}))(?![\\p{N}])`,
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
 * beside a 12.3% error rate). A printed 100% or 0% is absolute: it describes
 * only a value of exactly 1 or 0, never 99.6% that rounds to it. The words perfect, flawless, error-free, no
 * errors and zero errors mean 100% (0% for a lower-is-better metric). The
 * text is only scanned, never judged: nothing here changes a verdict.
 */
export function textFiguresDiffering(text: string, value: number, assessed: number, higherIsBetter: boolean): string[] {
  // "99.9 percent" is the figure "99.9%"
  // The Arabic percent sign (U+066A) has no compatibility fold to "%"; it is the same sign.
  const folded = foldText(text)
    .replace(/\u066A/g, '%')
    .replace(/(\d) ?(?:percent|per cent|pct)(?![\p{L}\p{N}])/gu, '$1%')
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
