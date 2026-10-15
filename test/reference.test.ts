import { describe, expect, it } from 'vitest'
import { cohenKappa, gwetAC1, percentAgreement, wilsonInterval, zForConfidence } from '../src/index.js'
import type { AgreementResult } from '../src/index.js'
import raw from './fixtures/reference.json' with { type: 'json' }
import { expandMatrix } from './vectors.js'

// Cross-check against widely used libraries. test/fixtures/reference.json is written
// by scripts/reference/gen.py (statsmodels, scipy, scikit-learn, irrCAC; the versions
// are in the file). The kit has no runtime dependency on any of them; this only reads
// numbers they produced. The bar is a maximum absolute difference of 1e-12.

const TOLERANCE = 1e-12

type Row = [successes: number, n: number, confidence: number, smLow: number, smHigh: number, spLow: number, spHigh: number]
interface RefAgreement {
  name: string
  labels: string[]
  matrix: number[][]
  categories?: number
  n: number
  agreements: number
  sklearn_percent: number | null
  sklearn_kappa: number | null
  irrcac_table: { percent: number | null; kappa: number | null; ac1: number | null }
  irrcac_raw: { percent: number | null; kappa: number | null; ac1: number | null }
}
interface Reference {
  versions: Record<string, string>
  referencesAgreeWithEachOther: { wilsonMaxAbsDiffStatsmodelsVsScipy: number }
  z: [number, number][]
  wilson: Row[]
  agreement: RefAgreement[]
}
const ref = raw as unknown as Reference

function valueOf(r: AgreementResult): number | null {
  return r.status === 'defined' ? r.value : null
}

describe('reference libraries: provenance', () => {
  it('names the version of every library that produced the numbers', () => {
    for (const lib of ['numpy', 'pandas', 'scipy', 'scikit-learn', 'statsmodels', 'irrCAC']) {
      expect(ref.versions[lib], lib).toMatch(/^\d+\.\d+/)
    }
  })

  it('the two Wilson references agree with each other to well under the bar', () => {
    expect(ref.referencesAgreeWithEachOther.wilsonMaxAbsDiffStatsmodelsVsScipy).toBeLessThan(TOLERANCE / 100)
  })
})

describe('Wilson interval against statsmodels and scipy', () => {
  it('has a broad grid (at least 3,000 cases, sizes from 1 to 1e12, levels from 50% to 99.99%)', () => {
    expect(ref.wilson.length).toBeGreaterThanOrEqual(3000)
    expect(Math.min(...ref.wilson.map((r) => r[1]))).toBe(1)
    expect(Math.max(...ref.wilson.map((r) => r[1]))).toBeGreaterThanOrEqual(1e12)
    expect(new Set(ref.wilson.map((r) => r[2])).size).toBeGreaterThanOrEqual(8)
    expect(ref.wilson.some((r) => r[0] === 0)).toBe(true)
    expect(ref.wilson.some((r) => r[0] === r[1])).toBe(true)
  })

  it('max absolute difference in the lower and upper limit is at most 1e-12', () => {
    let worst = 0
    let where = ''
    for (const [k, n, confidence, smLow, smHigh, spLow, spHigh] of ref.wilson) {
      const r = wilsonInterval(k, n, { confidence })
      const diff = Math.max(Math.abs(r.low - smLow), Math.abs(r.high - smHigh), Math.abs(r.low - spLow), Math.abs(r.high - spHigh))
      if (diff > worst) {
        worst = diff
        where = `${String(k)}/${String(n)} at ${String(confidence)}`
      }
    }
    expect(worst, where).toBeLessThanOrEqual(TOLERANCE)
  })

  it('z for a confidence level matches scipy.stats.norm.isf to 1e-12', () => {
    expect(ref.z.length).toBeGreaterThanOrEqual(9)
    for (const [c, z] of ref.z) expect(Math.abs(zForConfidence(c) - z), `confidence ${String(c)}`).toBeLessThanOrEqual(TOLERANCE)
  })

  it('includes the three Wilson rows Newcombe (1998) Table I prints (81/263, 15/148, 0/20), as computed by the libraries', () => {
    // The paper's own 4-decimal figures are not reproduced here; the rows are the libraries' output at 95%.
    for (const [k, n] of [[81, 263], [15, 148], [0, 20]] as const) {
      expect(ref.wilson.some((r) => r[0] === k && r[1] === n && r[2] === 0.95), `${String(k)}/${String(n)}`).toBe(true)
    }
  })
})

describe('agreement against scikit-learn and irrCAC', () => {
  it('has a broad grid (at least 1,000 matrices, 2 to 8 categories, 1 to 1,000 items, unused categories, undefined cases)', () => {
    expect(ref.agreement.length).toBeGreaterThanOrEqual(1000)
    expect(new Set(ref.agreement.map((a) => a.labels.length)).size).toBeGreaterThanOrEqual(7)
    expect(Math.max(...ref.agreement.map((a) => a.n))).toBeGreaterThanOrEqual(1000)
    expect(ref.agreement.filter((a) => a.categories !== undefined).length).toBeGreaterThan(100)
    expect(ref.agreement.filter((a) => a.sklearn_kappa === null).length).toBeGreaterThan(50)
    expect(ref.agreement.some((a) => a.name.startsWith('documentation: irrCAC 3x3'))).toBe(true)
    expect(ref.agreement.some((a) => a.name.startsWith('documentation: irrCAC 4x4'))).toBe(true)
  })

  function compare(name: string, got: number | null, references: (number | null)[], worst: { value: number; where: string }, counts: { compared: number; undef: number; disputed: number }, label: string, disputed: string[]): void {
    const defined = references.filter((x): x is number => x !== null)
    if (defined.length === 0) {
      // every library leaves it undefined: so must the kit, with no number
      expect(got, `${label} ${name} should be undefined`).toBeNull()
      counts.undef += 1
      return
    }
    if (defined.length < references.length) {
      // the libraries disagree about whether it is defined (a degenerate table): not a numeric comparison
      counts.disputed += 1
      disputed.push(`${label} ${name}`)
      return
    }
    expect(got, `${label} ${name} should be defined`).not.toBeNull()
    for (const x of defined) {
      const diff = Math.abs((got as number) - x)
      if (diff > worst.value) {
        worst.value = diff
        worst.where = `${label} ${name}`
      }
    }
    counts.compared += 1
  }

  it('percent agreement, kappa and AC1 differ from every library by at most 1e-12', () => {
    const worst = { value: 0, where: '' }
    const counts = { compared: 0, undef: 0, disputed: 0 }
    const disputed: string[] = []
    for (const a of ref.agreement) {
      const pairs = expandMatrix(a.labels, a.matrix)
      expect(pairs.length, a.name).toBe(a.n)
      const pct = percentAgreement(pairs)
      const kappa = cohenKappa(pairs)
      const ac1 = gwetAC1(pairs, a.categories === undefined ? undefined : { categories: a.categories })
      expect(pct.agreements, a.name).toBe(a.agreements)
      compare('percent', valueOf(pct), [a.sklearn_percent, a.irrcac_table.percent], worst, counts, a.name, disputed)
      compare('kappa', valueOf(kappa), [a.sklearn_kappa, a.irrcac_table.kappa, a.irrcac_raw.kappa], worst, counts, a.name, disputed)
      compare('ac1', valueOf(ac1), [a.irrcac_table.ac1, a.irrcac_raw.ac1], worst, counts, a.name, disputed)
    }
    expect(worst.value, worst.where).toBeLessThanOrEqual(TOLERANCE)
    expect(counts.compared).toBeGreaterThan(3500)
    expect(counts.undef).toBeGreaterThan(100)
    // The libraries disagree with each other only on degenerate tables. irrCAC's raw class returns
    // AC1 = 1 when every item has one category (Gwet's formula divides by Q - 1 = 0, and its table
    // class returns nothing); the kit calls that undefined. The next test pins that.
    expect(counts.disputed).toBeGreaterThan(0)
    expect(disputed.every((d) => d.endsWith(' ac1') || d.endsWith(' percent'))).toBe(true)
  })

  it('AC1 is undefined (single-category), not 1, whenever the data has one category, even where irrCAC raw says 1', () => {
    let checked = 0
    for (const a of ref.agreement) {
      const seen = new Set(expandMatrix(a.labels, a.matrix).flat()).size
      const q = a.categories ?? seen
      if (q >= 2) continue
      const r = gwetAC1(expandMatrix(a.labels, a.matrix), a.categories === undefined ? undefined : { categories: a.categories })
      expect(r, a.name).toMatchObject({ status: 'undefined', reason: 'single-category' })
      checked += 1
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('the irrCAC documentation example (3x3 table) has Gwet AC1 0.84933 and percent agreement 0.89', () => {
    const a = ref.agreement.find((x) => x.name.startsWith('documentation: irrCAC 3x3'))
    expect(a).toBeDefined()
    const pairs = expandMatrix((a as RefAgreement).labels, (a as RefAgreement).matrix)
    expect(Math.round((valueOf(gwetAC1(pairs)) as number) * 1e5) / 1e5).toBe(0.84933)
    expect(valueOf(percentAgreement(pairs))).toBe(0.89)
  })
})
