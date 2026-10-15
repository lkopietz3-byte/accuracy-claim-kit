// Small text helpers for scope wording. Every loop is linear in the input
// length, which is bounded by the caps below: a match is judged by the one or
// two code points next to it, never by re-reading the text around it.

export const MAX_NAME_LENGTH = 200
export const MAX_TEXT_LENGTH = 2000
/** Most characters in a label (agreement pairs) or a stratum name. Very long equal-length strings collide in V8 Map and Set hashing. */
export const MAX_LABEL_LENGTH = 1000

// Typographic variants that copied web text carries, folded to the ASCII
// character a person would type. NFKC runs first, so full-width forms and the
// non-breaking hyphen (U+2011 becomes U+2010) are already plain by then.
const APOSTROPHES = /[‘’‛′ʼ]/g
const DOUBLE_QUOTES = /[“”]/g
const DASHES = /[‐-―⁃−⸺⸻]/g
// Characters with no visible form of their own (zero-width space, joiners, word
// joiner, direction marks, BOM, variation selectors, tag characters, the Hangul
// and Mongolian fillers, the soft hyphen). They are dropped before comparison,
// so one next to a name cannot make it look like a clean word boundary
// ("MMLU", ZWSP, "-Pro") and one inside a name copied from the web does not
// break the match.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu
// toLowerCase writes a Greek capital sigma as the final form when it ends a word
// and as the ordinary one otherwise, and "word" depends on the characters around
// it, so the same name folds two ways ("ΟΔΥΣΣΕΥΣ" alone, "ΟΔΥΣΣΕΥΣ's" in a sentence).
const FINAL_SIGMA = /\u03c2/g

/**
 * Folds a string for comparison: NFKC (so full-width and compatibility forms
 * match their plain forms), lower case, typographic quotes and apostrophes to
 * ' and ", every dash variant and the minus sign to -, every invisible
 * default-ignorable character (including the soft hyphen) dropped, a Greek
 * final sigma written as an ordinary one (lower-casing picks between them by
 * the word around it), and any run of whitespace becomes one space. Look-alike
 * letters from other scripts are NOT folded.
 */
export function foldText(text: string): string {
  const plain = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(FINAL_SIGMA, '\u03c3')
    .replace(INVISIBLE, '')
    .replace(APOSTROPHES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
  const words = plain.split(/\s+/)
  return words.filter((word) => word !== '').join(' ')
}

// A string that is echoed into a statement or an explanation must read the same
// to a person as it does to the kit. C0 and C1 controls (newlines, NUL, escape),
// line and paragraph separators, and the bidirectional embedding, override and
// isolate characters can reorder or hide the text around them, so they throw.
// The horizontal tab is plain spacing and stays, like the direction marks
// (U+200E, U+200F) and joiners: scripts written right to left need them.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

const LINE_BREAK = /[\n\r\u0085\u2028\u2029]/u

/**
 * Throws RangeError when `value` holds a control or bidirectional-formatting
 * character, naming the field, the code point and where it sits (never echoing
 * the string itself). `lineAdvice` is added when the character is a line break,
 * for a field a caller is likely to paste from wrapped text.
 */
export function assertPlainText(value: string, name: string, lineAdvice?: string): void {
  const found = UNSAFE_TEXT.exec(value)
  if (found === null) return
  const code = (found[0].codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')
  const advice = lineAdvice !== undefined && LINE_BREAK.test(found[0]) ? `; ${lineAdvice}` : ''
  throw new RangeError(`${name} must not contain a control or bidirectional-formatting character (U+${code} at position ${String(found.index)})${advice}`)
}

const WORDISH = /[\p{L}\p{N}\p{M}]/u
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
/** Characters that join a name to a suffix or prefix without a space: MMLU-Pro, MMLU_pro, MMLU/pro, MMLU.pro. */
const JOINERS = '-_/.'

function isWordish(codePoint: number | undefined): boolean {
  return codePoint !== undefined && WORDISH.test(String.fromCodePoint(codePoint))
}

/** The code point that ends just before `index`, surrogate-aware; undefined at the start. */
function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(index - 2)
  }
  return low
}

/** The code point that starts at `index`, surrogate-aware; undefined past the end. */
function codePointAfter(text: string, index: number): number | undefined {
  return index >= text.length ? undefined : text.codePointAt(index)
}

const unitOf = (codePoint: number): number => (codePoint > 0xffff ? 2 : 1)
const PLUS = 0x2b
const isJoiner = (codePoint: number | undefined): boolean => codePoint !== undefined && JOINERS.includes(String.fromCodePoint(codePoint))

/**
 * True when the folded `name` appears in the folded `text` as its own word or
 * phrase. The characters next to a match may not continue it:
 *  - a letter, digit or combining mark next to a name that starts or ends with
 *    one ("test" is not found inside "latest");
 *  - a "+" straight after the match ("HumanEval" is not "HumanEval+");
 *  - one of - _ / . straight before or after the match when a letter or digit
 *    sits on the far side of it ("MMLU" is not "MMLU-Pro" or "mini-MMLU", but a
 *    full stop that ends a sentence, as in "on CIFAR-10.", is fine).
 * A suffix set off by a space ("SWE-bench Verified") cannot be told apart from
 * ordinary words; declare the full name for such a set.
 */
export function mentionsName(text: string, name: string): boolean {
  const hay = foldText(text)
  const needle = foldText(name)
  if (needle === '') return false
  const first = needle.codePointAt(0)
  const lastStart = needle.length - unitOf(codePointBefore(needle, needle.length) as number)
  const last = needle.codePointAt(lastStart)
  const needsStart = isWordish(first)
  const needsEnd = isWordish(last)
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return false
    from = at + 1
    const end = at + needle.length
    const before = codePointBefore(hay, at)
    const after = codePointAfter(hay, end)
    if (needsStart && isWordish(before)) continue
    if (needsEnd && isWordish(after)) continue
    if (after === PLUS) continue
    if (isJoiner(after) && isWordish(codePointAfter(hay, end + 1))) continue
    if (isJoiner(before) && isWordish(codePointBefore(hay, at - (before !== undefined && before > 0xffff ? 2 : 1)))) continue
    return true
  }
}

/**
 * Reads a required string of at most `max` characters that holds at least one
 * letter or digit once folded: a name made only of punctuation or invisible
 * characters would be "found" in almost any text.
 */
export function readName(value: unknown, name: string, max = MAX_NAME_LENGTH): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  if (value.length > max) throw new RangeError(`${name} must be at most ${max} characters`)
  assertPlainText(value, name)
  const folded = foldText(value)
  if (folded === '') throw new RangeError(`${name} must not be blank`)
  if (!HAS_LETTER_OR_DIGIT.test(folded)) throw new RangeError(`${name} must contain at least one letter or digit`)
  return value
}
