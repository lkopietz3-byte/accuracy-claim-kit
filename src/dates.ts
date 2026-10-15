// Calendar-date handling with no clock: callers pass both dates in.

import { clip } from './validate.js'

const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days since 1970-01-01 (UTC) for a real "YYYY-MM-DD" date. TypeError / RangeError otherwise. */
export function dayNumber(value: unknown, name: string): number {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a "YYYY-MM-DD" string`)
  const m = DATE.exec(value)
  if (m === null) throw new RangeError(`${name} must look like "2026-10-10"; got "${clip(value, 40)}"`)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1000) throw new RangeError(`${name} year must be 1000 or later`)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`${name} is not a real calendar date: "${value}"`)
  }
  return Math.round(date.getTime() / DAY_MS)
}
