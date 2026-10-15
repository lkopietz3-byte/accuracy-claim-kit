import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyClaimInput, AssessOptions } from '../src/index.js'
import raw from './fixtures/field-regression.json' with { type: 'json' }

// A small, fast slice of the field benchmark in bench/ (FDA 510(k) decision
// summary rates, each judged by an oracle that shares no code with src/). The
// full corpus, about ten thousand cases, runs under `npm run bench`.
// Regenerate this file with `python3 -I bench/fda/build.py --subset`.

interface FieldRow {
  suite: 'variants-default' | 'variants-strictPrecision' | 'variants-conservative' | 'declared' | 'complete-set' | 'strata'
  id: string
  source: string
  input: AccuracyClaimInput
  options: AssessOptions
  expected: { verdict: string; reasons?: string[] }
}

const rows = raw as unknown as FieldRow[]

function check(row: FieldRow): string[] {
  const r = assessAccuracyClaim(row.input, row.options)
  const problems: string[] = []
  if (r.verdict !== row.expected.verdict) problems.push(`${row.suite} ${row.id}: oracle ${row.expected.verdict}, kit ${r.verdict} [${r.reasons.join(', ')}] (${row.source})`)
  else if (row.expected.verdict === 'refused' && row.expected.reasons !== undefined) {
    const got = [...r.reasons].sort()
    if (JSON.stringify(got) !== JSON.stringify(row.expected.reasons)) {
      problems.push(`${row.suite} ${row.id}: refusal reasons oracle [${row.expected.reasons.join(', ')}], kit [${got.join(', ')}]`)
    }
  }
  return problems
}

describe('field corpus: the kit agrees with an independent oracle on real published rates', () => {
  it('is a real slice: every suite and every verdict is present', () => {
    expect(rows.length).toBeGreaterThan(400)
    const suites = new Set(rows.map((r) => r.suite))
    expect([...suites].sort()).toEqual(['complete-set', 'declared', 'strata', 'variants-conservative', 'variants-default', 'variants-strictPrecision'])
    const verdicts = new Set(rows.map((r) => r.expected.verdict))
    expect([...verdicts].sort()).toEqual(['contradicted', 'overstated', 'refused', 'supported'])
    expect(new Set(rows.map((r) => r.id)).size).toBeGreaterThan(300)
  })

  for (const suite of ['variants-default', 'variants-strictPrecision', 'variants-conservative', 'declared', 'complete-set', 'strata'] as const) {
    it(`${suite}: every row gets the oracle's verdict`, () => {
      const mine = rows.filter((r) => r.suite === suite)
      expect(mine.length).toBeGreaterThan(10)
      const problems = mine.flatMap(check)
      expect(problems).toEqual([])
    })
  }

  it('field:F1 a value written as printed percent / 100 is the printed figure (42 field rows)', () => {
    const div = rows.filter((r) => r.suite === 'variants-default' && r.id.endsWith('::as-printed-div100'))
    expect(div.length).toBe(42)
    expect(div.flatMap(check)).toEqual([])
    // Most are honest reports of an observed rate; the rest are refusals or absolute figures the oracle also names.
    expect(div.filter((r) => r.expected.verdict === 'supported').length).toBeGreaterThan(20)
  })

  it('no claim the counts do not carry comes back supported (false passes on the slice)', () => {
    const notCarried = rows.filter((r) => r.suite === 'variants-default' && (r.expected.verdict === 'overstated' || r.expected.verdict === 'contradicted'))
    expect(notCarried.length).toBeGreaterThan(30)
    const falsePasses = notCarried.filter((r) => assessAccuracyClaim(r.input, r.options).verdict === 'supported').map((r) => r.id)
    expect(falsePasses).toEqual([])
  })
})
