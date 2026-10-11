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

/** Reads a required, non-blank string of at most `max` characters. */
export function readName(value: unknown, name: string, max = MAX_NAME_LENGTH): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  if (value.length > max) throw new RangeError(`${name} must be at most ${max} characters`)
  if (foldText(value) === '') throw new RangeError(`${name} must not be blank`)
  return value
}
