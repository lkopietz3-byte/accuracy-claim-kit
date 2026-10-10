import { describe, expect, it } from 'vitest'
import {
  cohenKappa,
  gwetAC1,
  percentAgreement,
  wilsonInterval,
  zForConfidence,
} from '../src/index.js'
import type { AgreementResult } from '../src/index.js'
import { normalQuantile } from '../src/normal.js'
import { expandMatrix, vectors } from './vectors.js'

function relErr(actual: number, expected: number): number {
  return expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected)
}

function valueOf(result: AgreementResult): number | null {
  return result.status === 'defined' ? result.value : null
}

describe('inverse normal CDF against statistics.NormalDist().inv_cdf', () => {
  it('matches at every reference point to 1e-12 relative', () => {
    expect(vectors.normalQuantile.length).toBeGreaterThan(250)
    for (const [p, expected] of vectors.normalQuantile) {
      const actual = normalQuantile(p)
      expect(relErr(actual, expected), `p = ${String(p)}`).toBeLessThan(1e-12)
    }
  })

  it('is exactly 0 at 0.5 and odd about it', () => {
    expect(Object.is(normalQuantile(0.5), 0)).toBe(true)
    // 1 - p is exact for p in [0.5, 1), so these pairs are exact mirrors.
    for (const p of [0.5 + 1e-12, 0.9, 0.99, 0.999999, 1 - 2 ** -40]) {
      expect(normalQuantile(p)).toBe(-normalQuantile(1 - p))
    }
  })

  it('rejects p outside the open interval', () => {
    for (const p of [0, 1, -0.1, 1.1, Number.NaN, Infinity, -Infinity]) {
      expect(() => normalQuantile(p)).toThrow(RangeError)
    }
    expect(() => normalQuantile('0.5' as unknown as number)).toThrow(TypeError)
  })
})

describe('z for a confidence level', () => {
  it('matches the reference to 1e-12 relative', () => {
    for (const [c, expected] of vectors.zForConfidence) {
      expect(relErr(zForConfidence(c), expected), `confidence = ${String(c)}`).toBeLessThan(1e-12)
    }
  })

  it('is the familiar 1.96 at 95%', () => {
    expect(zForConfidence(0.95)).toBeCloseTo(1.959963984540054, 12)
  })

  it('rejects confidence outside (0, 1)', () => {
    for (const c of [0, 1, -0.5, 2, Number.NaN, Infinity]) {
      expect(() => zForConfidence(c)).toThrow(RangeError)
    }
    expect(() => zForConfidence('0.95' as unknown as number)).toThrow(TypeError)
  })
})

describe('Wilson interval against an independent 60-digit decimal implementation', () => {
  it('matches every vector (low, high, point)', () => {
    expect(vectors.wilson.length).toBeGreaterThan(800)
    for (const v of vectors.wilson) {
      const r = wilsonInterval(v.successes, v.n, { confidence: v.confidence })
      const label = `${String(v.successes)}/${String(v.n)} @ ${String(v.confidence)}`
      expect(Math.abs(r.low - v.low), `low ${label}`).toBeLessThanOrEqual(1e-15 + 1e-12 * v.low)
      expect(Math.abs(r.high - v.high), `high ${label}`).toBeLessThanOrEqual(1e-15 + 1e-12 * v.high)
      expect(r.point).toBe(v.point)
    }
  })

  it('keeps relative accuracy for limits near 0 (tiny error rates at huge n)', () => {
    let checked = 0
    for (const v of vectors.wilson) {
      const r = wilsonInterval(v.successes, v.n, { confidence: v.confidence })
      if (v.successes > 0 && v.low < 1e-3) {
        expect(relErr(r.low, v.low), `low ${String(v.successes)}/${String(v.n)}`).toBeLessThan(1e-12)
        checked += 1
      }
      if (v.successes < v.n && v.high < 1e-3) {
        expect(relErr(r.high, v.high), `high ${String(v.successes)}/${String(v.n)}`).toBeLessThan(1e-12)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('reproduces the Newcombe (1998) Table I Wilson rows to 4 decimals', () => {
    for (const v of vectors.wilsonPublished) {
      const r = wilsonInterval(v.successes, v.n, { confidence: v.confidence })
      expect(Math.round(r.low * 1e4) / 1e4).toBe(v.low4)
      expect(Math.round(r.high * 1e4) / 1e4).toBe(v.high4)
    }
  })

  it('has the closed forms at the edges: [0, z2/(n+z2)] and [n/(n+z2), 1]', () => {
    for (const v of vectors.wilsonAnalytic) {
      const none = wilsonInterval(0, v.n)
      const all = wilsonInterval(v.n, v.n)
      expect(none.low).toBe(0)
      expect(Math.abs(none.high - v.zeroUpper)).toBeLessThan(1e-15)
      expect(all.high).toBe(1)
      expect(Math.abs(all.low - v.allLower)).toBeLessThan(1e-15)
    }
  })

  it('returns the inputs and the z it used', () => {
    const r = wilsonInterval(499, 500)
    expect(r).toMatchObject({ successes: 499, n: 500, confidence: 0.95 })
    expect(r.z).toBeCloseTo(1.959963984540054, 12)
  })
})

describe('Wilson interval properties', () => {
  const ns = [1, 2, 3, 7, 10, 29, 30, 100, 999, 10_000, 1_000_000]
  const confidences = [0.5, 0.8, 0.9, 0.95, 0.99, 0.999]

  function counts(n: number): number[] {
    return [...new Set([0, 1, 2, Math.floor(n / 3), Math.floor(n / 2), n - 2, n - 1, n])].filter(
      (s) => s >= 0 && s <= n,
    )
  }

  it('contains the point estimate and stays within [0, 1]', () => {
    for (const n of ns)
      for (const c of confidences)
        for (const s of counts(n)) {
          const r = wilsonInterval(s, n, { confidence: c })
          expect(r.low).toBeGreaterThanOrEqual(0)
          expect(r.high).toBeLessThanOrEqual(1)
          expect(r.low).toBeLessThanOrEqual(r.point)
          expect(r.point).toBeLessThanOrEqual(r.high)
          expect(r.low).toBeLessThan(r.high)
        }
  })

  it('is symmetric under successes <-> n - successes (to within 1e-15)', () => {
    for (const n of ns)
      for (const c of confidences)
        for (const s of counts(n)) {
          const a = wilsonInterval(s, n, { confidence: c })
          const b = wilsonInterval(n - s, n, { confidence: c })
          expect(Math.abs(a.low - (1 - b.high))).toBeLessThanOrEqual(1e-15)
          expect(Math.abs(a.high - (1 - b.low))).toBeLessThanOrEqual(1e-15)
        }
  })

  it('narrows as n grows at a fixed rate', () => {
    for (const rate of [0.5, 0.9, 0.99, 0.5 / 3]) {
      let previous = Infinity
      for (const n of [30, 60, 120, 600, 6000, 60_000, 600_000]) {
        const r = wilsonInterval(Math.round(n * rate), n)
        const width = r.high - r.low
        expect(width).toBeLessThan(previous)
        previous = width
      }
    }
  })

  it('widens with confidence', () => {
    let previous = 0
    for (const c of confidences) {
      const r = wilsonInterval(45, 50, { confidence: c })
      expect(r.high - r.low).toBeGreaterThan(previous)
      previous = r.high - r.low
    }
  })

  it('moves monotonically with the success count', () => {
    let low = -1
    let high = -1
    for (let s = 0; s <= 40; s++) {
      const r = wilsonInterval(s, 40)
      expect(r.low).toBeGreaterThanOrEqual(low)
      expect(r.high).toBeGreaterThanOrEqual(high)
      low = r.low
      high = r.high
    }
  })

  it('has exact edge behavior at 0 and n for every n', () => {
    for (const n of ns) {
      const none = wilsonInterval(0, n)
      expect(Object.is(none.low, 0)).toBe(true)
      expect(none.point).toBe(0)
      expect(none.high).toBeGreaterThan(0)
      const all = wilsonInterval(n, n)
      expect(all.high).toBe(1)
      expect(all.point).toBe(1)
      expect(all.low).toBeLessThan(1)
    }
  })

  it('stays finite and ordered for huge n', () => {
    for (const n of [1e12, 1e15, Number.MAX_SAFE_INTEGER]) {
      for (const s of [0, 1, Math.floor(n / 2), n - 1, n]) {
        const r = wilsonInterval(s, n)
        expect(Number.isFinite(r.low) && Number.isFinite(r.high)).toBe(true)
        expect(r.low).toBeLessThanOrEqual(r.point)
        expect(r.high).toBeGreaterThanOrEqual(r.point)
      }
    }
  })
})

describe('Wilson interval input validation', () => {
  it('throws RangeError for bad counts', () => {
    const bad: [number, number][] = [
      [1.5, 10], [1, 10.5], [-1, 10], [11, 10], [0, 0], [0, -5], [Number.NaN, 10], [1, Number.NaN],
      [Infinity, 10], [1, Infinity], [1, Number.MAX_SAFE_INTEGER + 1], [2 ** 53, 2 ** 53],
    ]
    for (const [s, n] of bad) expect(() => wilsonInterval(s, n), `${String(s)}/${String(n)}`).toThrow(RangeError)
  })

  it('throws TypeError for non-number counts', () => {
    for (const bad of ['5', null, undefined, {}, [], true, 5n, new Number(5)]) {
      expect(() => wilsonInterval(bad as number, 10)).toThrow(TypeError)
      expect(() => wilsonInterval(1, bad as number)).toThrow(TypeError)
    }
  })

  it('throws for bad confidence and bad options', () => {
    for (const c of [0, 1, -0.1, 1.5, Number.NaN, Infinity]) {
      expect(() => wilsonInterval(5, 10, { confidence: c })).toThrow(RangeError)
    }
    expect(() => wilsonInterval(5, 10, { confidence: '0.9' as unknown as number })).toThrow(TypeError)
    expect(() => wilsonInterval(5, 10, null as unknown as undefined)).toThrow(TypeError)
  })

  it('reads -0 as 0', () => {
    const r = wilsonInterval(-0, 10)
    expect(Object.is(r.successes, 0)).toBe(true)
    expect(Object.is(r.low, 0)).toBe(true)
  })

  it('uses 0.95 when confidence is undefined', () => {
    expect(wilsonInterval(5, 10, { confidence: undefined }).confidence).toBe(0.95)
  })
})

describe('agreement statistics against exact-fraction references', () => {
  it('matches percent agreement, kappa and AC1 for every case', () => {
    expect(vectors.agreement.length).toBeGreaterThan(40)
    for (const v of vectors.agreement) {
      const pairs = expandMatrix(v.labels, v.matrix)
      const options = v.categories === undefined ? undefined : { categories: v.categories }
      const pct = percentAgreement(pairs)
      const kappa = cohenKappa(pairs)
      const ac1 = gwetAC1(pairs, options)
      expect(pct.n, v.name).toBe(v.expected.n)
      expect(pct.agreements, v.name).toBe(v.expected.agreements)
      for (const [name, got, want] of [
        ['percent', valueOf(pct), v.expected.percent],
        ['kappa', valueOf(kappa), v.expected.kappa],
        ['ac1', valueOf(ac1), v.expected.ac1],
      ] as const) {
        if (want === null) {
          expect(got, `${v.name} ${name} should be undefined`).toBeNull()
        } else {
          expect(got, `${v.name} ${name} should be defined`).not.toBeNull()
          expect(Math.abs((got as number) - want), `${v.name} ${name}`).toBeLessThanOrEqual(2e-15)
        }
      }
    }
  })

  it('reproduces the published textbook kappa values', () => {
    const published = vectors.agreement.filter((v) => v.published?.kappa !== undefined)
    expect(published.length).toBe(5)
    for (const v of published) {
      const k = valueOf(cohenKappa(expandMatrix(v.labels, v.matrix))) as number
      expect(Math.abs(k - (v.published?.kappa as number)), v.name).toBeLessThan(5.1e-5)
    }
  })

  it('reports the counts it used', () => {
    const r = cohenKappa([['a', 'a'], ['a', 'b'], ['b', 'b'], ['c', 'c']])
    expect(r).toMatchObject({ statistic: 'cohen-kappa', status: 'defined', n: 4, agreements: 3, categories: 3 })
  })
})

describe('agreement statistics when they are undefined', () => {
  it('kappa is undefined, never NaN, when both raters use one identical label', () => {
    const r = cohenKappa([['a', 'a'], ['a', 'a'], ['a', 'a']])
    expect(r).toMatchObject({ status: 'undefined', value: null, reason: 'expected-agreement-is-1', n: 3, agreements: 3 })
  })

  it('kappa is 0 (defined) when the raters each use a different single label', () => {
    expect(valueOf(cohenKappa([['a', 'b'], ['a', 'b']]))).toBe(0)
  })

  it('AC1 is undefined with one category and defined once Q is declared', () => {
    const pairs: [string, string][] = [['a', 'a'], ['a', 'a']]
    expect(gwetAC1(pairs)).toMatchObject({ status: 'undefined', reason: 'single-category' })
    expect(valueOf(gwetAC1(pairs, { categories: 2 }))).toBe(1)
  })

  it('every statistic is undefined for no pairs', () => {
    for (const f of [percentAgreement, cohenKappa, gwetAC1]) {
      expect(f([])).toMatchObject({ status: 'undefined', value: null, reason: 'no-pairs', n: 0 })
    }
  })

  it('never returns NaN or -0 over a sweep of small tables', () => {
    for (let a = 0; a <= 4; a++)
      for (let b = 0; b <= 4; b++)
        for (let c = 0; c <= 4; c++)
          for (let d = 0; d <= 4; d++) {
            const pairs = expandMatrix(['x', 'y'], [[a, b], [c, d]])
            for (const r of [percentAgreement(pairs), cohenKappa(pairs), gwetAC1(pairs)]) {
              if (r.status === 'defined') {
                expect(Number.isNaN(r.value)).toBe(false)
                expect(Object.is(r.value, -0)).toBe(false)
                expect(r.value).toBeGreaterThanOrEqual(-1)
                expect(r.value).toBeLessThanOrEqual(1)
              } else {
                expect(r.value).toBeNull()
              }
            }
          }
  })
})

describe('agreement input validation', () => {
  it('rejects non-array and malformed pairs', () => {
    expect(() => cohenKappa('ab' as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa(null as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa([['a']] as unknown as [])).toThrow(RangeError)
    expect(() => cohenKappa([['a', 'b', 'c']] as unknown as [])).toThrow(RangeError)
    expect(() => cohenKappa(['ab'] as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa([{ 0: 'a', 1: 'b', length: 2 }] as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa(new Array(2) as unknown as [])).toThrow(TypeError)
  })

  it('rejects non-primitive and non-finite labels', () => {
    expect(() => cohenKappa([[null, 'a']] as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa([[undefined, 'a']] as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa([[{}, 'a']] as unknown as [])).toThrow(TypeError)
    expect(() => cohenKappa([[Number.NaN, 1]])).toThrow(RangeError)
    expect(() => cohenKappa([[1, Infinity]])).toThrow(RangeError)
  })

  it('keeps 1 and "1" apart, and treats 0 and -0 as one label', () => {
    expect(percentAgreement([[1, '1']])).toMatchObject({ agreements: 0 })
    expect(percentAgreement([[0, -0]])).toMatchObject({ agreements: 1 })
  })

  it('rejects an AC1 category count below the labels seen', () => {
    expect(() => gwetAC1([['a', 'b'], ['c', 'c']], { categories: 2 })).toThrow(RangeError)
    expect(() => gwetAC1([['a', 'b']], { categories: 0 })).toThrow(RangeError)
    expect(() => gwetAC1([['a', 'b']], { categories: 2.5 })).toThrow(RangeError)
    expect(() => gwetAC1([['a', 'b']], { categories: '2' as unknown as number })).toThrow(TypeError)
  })
})

describe('confidence levels near the bottom of the double range', () => {
  it('z for Number.MIN_VALUE is Number.MIN_VALUE, not 0', () => {
    expect(zForConfidence(Number.MIN_VALUE)).toBe(Number.MIN_VALUE)
  })

  it('z for 1e-300 and 1e-100 follow sqrt(pi/2) * c', () => {
    expect(relErr(zForConfidence(1e-300), 1.2533141373155e-300)).toBeLessThan(1e-12)
    expect(relErr(zForConfidence(1e-100), 1.2533141373155e-100)).toBeLessThan(1e-12)
  })

  it('the interval stays finite and ordered at the smallest confidence', () => {
    const r = wilsonInterval(3, 30, { confidence: Number.MIN_VALUE })
    expect(Number.isFinite(r.low) && Number.isFinite(r.high)).toBe(true)
    expect(r.low).toBeLessThanOrEqual(r.point)
    expect(r.high).toBeGreaterThanOrEqual(r.point)
  })

  it('is continuous where the formula switches near c = 1e-9', () => {
    const below = zForConfidence(0.999999e-9)
    const above = zForConfidence(1.000001e-9)
    expect(relErr(above, below)).toBeLessThan(2.1e-6)
    expect(relErr(zForConfidence(1e-9), 1.2533141373155004e-9)).toBeLessThan(1e-14)
  })
})

describe('very small confidence levels keep their digits', () => {
  it('z for 1e-16 is sqrt(pi/2) * 1e-16, not 0', () => {
    const z = zForConfidence(1e-16)
    expect(Math.abs(z - 1.2533141373155002e-16) / 1.2533141373155002e-16).toBeLessThan(1e-12)
  })

  it('wilsonInterval(0, 30, { confidence: 1e-16 }) is a tiny but nonzero interval', () => {
    const r = wilsonInterval(0, 30, { confidence: 1e-16 })
    expect(r.z).toBeGreaterThan(1e-16)
    expect(r.low).toBe(0)
    expect(Math.abs(r.high - 5.235987755982989e-34) / 5.235987755982989e-34).toBeLessThan(1e-9)
  })

  it('is monotone through the c = 0.5 switch between the two forms', () => {
    const cs = [0.4, 0.49, 0.499999, 0.5, 0.500001, 0.51, 0.6]
    const zs = cs.map((c) => zForConfidence(c))
    for (let i = 1; i < zs.length; i++) expect(zs[i] as number).toBeGreaterThan(zs[i - 1] as number)
  })
})
