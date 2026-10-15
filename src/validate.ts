// Small input readers shared by every public function. Wrong runtime type
// throws TypeError; right type but unusable value throws RangeError. Nothing
// here coerces: a string "5" is not a count, a Number object is not a number.

export const MAX_COUNT = Number.MAX_SAFE_INTEGER

/**
 * Most elements read from one caller-supplied array (pairs or strata). A
 * Proxy can claim any length, and a loop that trusts it can run for as long as
 * the caller likes, so a length is checked before it is used.
 */
export const MAX_ITEMS = 10_000_000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be a plain object`)
  }
  return value
}

/**
 * Throws TypeError for a built-in object that is not a plain record (a Map, a
 * boxed Number or String, a Date, a Set). Such a value has no own keys, so for
 * an object whose fields are all optional and whose absence turns a check off
 * (the options) it would read as "nothing was asked for" and fail open. Class
 * instances, null-prototype objects, Proxies of plain objects and objects from
 * another realm are plain. The caller's Symbol.toStringTag is read once here.
 */
export function assertPlainObject(value: Record<string, unknown>, name: string): void {
  const tag = Object.prototype.toString.call(value)
  if (tag !== '[object Object]') throw new TypeError(`${name} must be a plain object, got ${tag}`)
}

/** Reads a whole number in [min, MAX_COUNT]. Normalizes -0 to 0. */
export function readCount(value: unknown, name: string, min = 0): number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`)
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a whole number, got ${String(value)}`)
  }
  if (value < min || value > MAX_COUNT) {
    throw new RangeError(`${name} must be between ${min} and ${MAX_COUNT}, got ${String(value)}`)
  }
  return value + 0 // turns -0 into 0
}

/** Validates a captured `.length`: a whole number from 0 to MAX_ITEMS. */
export function readLength(value: unknown, name: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name}.length must be a number`)
  }
  if (!Number.isInteger(value) || value < 0 || value > MAX_ITEMS) {
    throw new RangeError(`${name}.length must be a whole number from 0 to ${MAX_ITEMS}, got ${String(value)}`)
  }
  return value + 0
}

/** Reads a finite number in [min, max], inclusive. Normalizes -0 to 0. */
export function readFiniteInRange(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`)
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}, got ${String(value)}`)
  }
  return value + 0
}

/** Reads a number strictly between 0 and 1 (a confidence level). */
export function readOpenUnit(value: unknown, name: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`)
  }
  if (!Number.isFinite(value) || !(value > 0) || !(value < 1)) {
    throw new RangeError(`${name} must be a number strictly between 0 and 1, got ${String(value)}`)
  }
  return value
}

/** Cuts a caller-supplied string for use in a message without splitting a surrogate pair. */
export function clip(text: string, max = 60): string {
  if (text.length <= max) return text
  let end = max
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${text.slice(0, end)}...`
}

/** Keys longer than this are reported but never searched for a near match. */
const MAX_SUGGEST_LENGTH = 64

/** Lower case with everything but letters and digits removed, so "min_agreement" and "minAgreement" compare equal. */
function simplify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Levenshtein distance between two short strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      row.push(Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + cost))
    }
    previous = row
  }
  return previous[b.length] as number
}

/** The allowed key a misspelled `key` most likely meant, or undefined when nothing is close. */
export function nearestKey(key: string, allowed: readonly string[]): string | undefined {
  if (key.length > MAX_SUGGEST_LENGTH) return undefined
  const wanted = simplify(key)
  if (wanted === '') return undefined
  let best: string | undefined
  let bestScore = Infinity
  for (const candidate of allowed) {
    const other = simplify(candidate)
    const raw = editDistance(wanted, other)
    let distance = raw
    // "maxAge" for "maxAgeDays": one name inside the other
    if (Math.min(wanted.length, other.length) >= 5 && (wanted.includes(other) || other.includes(wanted))) {
      distance = Math.min(distance, 1)
    }
    const limit = wanted.length <= 4 ? 1 : 2
    // the closest wins; a tie goes to the one that differs least as written
    const score = distance * 1000 + raw
    if (distance <= limit && score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/**
 * Throws a TypeError naming the first own enumerable key of `value` that is not
 * in `allowed`, with the closest allowed key when there is one. A misspelled
 * optional key ("retraction", "maxAgeDay") would otherwise be ignored and turn
 * the check it configures off. Keys are listed once and no value is read, so a
 * getter is never triggered; inherited and symbol keys are not looked at.
 */
export function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    const near = nearestKey(key, allowed)
    const hint = near === undefined ? '.' : `; did you mean "${near}"?`
    throw new TypeError(`${label} has an unknown key "${clip(key)}"${hint} Allowed keys: ${allowed.join(', ')}.`)
  }
}
