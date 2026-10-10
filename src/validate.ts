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
