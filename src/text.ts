// Small text helpers for scope wording. Everything is linear in the input
// length and bounded by the caps below.

export const MAX_NAME_LENGTH = 200
export const MAX_TEXT_LENGTH = 2000

/**
 * Folds a string for comparison: NFKC (so full-width and compatibility forms
 * match their plain forms), lower case, and any run of whitespace becomes one
 * space. Look-alike letters from other scripts are NOT folded.
 */
export function foldText(text: string): string {
  const words = text.normalize('NFKC').toLowerCase().split(/\s+/)
  return words.filter((word) => word !== '').join(' ')
}

/**
 * True when the folded `name` appears in the folded `text` as its own word or
 * phrase: the characters next to a match may not be letters or digits when the
 * name itself starts or ends with one, so "test" is not found inside "latest".
 */
export function mentionsName(text: string, name: string): boolean {
  const hay = foldText(text)
  const needle = foldText(name)
  if (needle === '') return false
  const wordChar = /[\p{L}\p{N}]/u
  const first = [...needle][0] as string
  const last = [...needle].at(-1) as string
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return false
    const before = [...hay.slice(0, at)].at(-1)
    const after = [...hay.slice(at + needle.length)][0]
    const startsOk = !wordChar.test(first) || before === undefined || !wordChar.test(before)
    const endsOk = !wordChar.test(last) || after === undefined || !wordChar.test(after)
    if (startsOk && endsOk) return true
    from = at + 1
  }
}

/** Reads a required, non-blank string of at most `max` characters. */
export function readName(value: unknown, name: string, max = MAX_NAME_LENGTH): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  if (value.length > max) throw new RangeError(`${name} must be at most ${max} characters`)
  if (foldText(value) === '') throw new RangeError(`${name} must not be blank`)
  return value
}
