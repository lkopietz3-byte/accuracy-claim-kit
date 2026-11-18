import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyClaimInput, AccuracyVerdict, ClaimMetric } from '../src/index.js'

const HUMAN = { provenance: { source: 'human' } } as const

function fixed(metric: ClaimMetric, n: number, correct: number, value: number, sampling: 'complete' | 'held-out-split'): AccuracyClaimInput {
  return {
    ...HUMAN,
    claim: { metric, value, text: 'Measured on BenchX' },
    sample: { n, correct },
    sampling,
    benchmark: { name: 'BenchX' },
  }
}

// These percentages are from the integer fractions, not from the formatter.
// Rounding an interior rate to an absolute 0% or 100% misstates the evidence.
const BOUNDARIES: readonly (readonly [ClaimMetric, number, number, string])[] = [
  ['accuracy', 999999990, 0.99999999, '99.999999%'],
  ['accuracy', 10, 0.00000001, '0.000001%'],
  ['error-rate', 999999990, 0.00000001, '0.000001%'],
  ['error-rate', 10, 0.99999999, '99.999999%'],
]

describe('observed rates keep nonzero and imperfect counts distinct from exact endpoints', () => {
  for (const sampling of ['complete', 'held-out-split'] as const) {
    it.each(BOUNDARIES)(`${sampling}: %s with %s correct has no false absolute percentage`, (metric, correct, value, shown) => {
      const r = assessAccuracyClaim(fixed(metric, 1000000000, correct, value, sampling))
      expect(r.verdict).toBe('supported')
      expect(r.reasons).toEqual(['census-matches-count'])
      expect(r.interval).toBeNull()
      expect(r.conservativeBound).toBeNull()
      expect(r.suggestedStatement).toContain(`: ${shown} ${metric === 'accuracy' ? 'accuracy' : 'error rate'}.`)
      expect(r.explanation[0]).toContain(`, ${shown})`)
    })
  }

  it.each([
    ['accuracy', 1, '99.999999%'],
    ['error-rate', 0, '0.000001%'],
  ] as const)('an impossible absolute %s claim stays contradicted while the replacement describes the counts', (metric, value, shown) => {
    const r = assessAccuracyClaim(fixed(metric, 1000000000, 999999990, value, 'complete'))
    expect(r.verdict).toBe('contradicted')
    expect(r.reasons).toEqual(['claim-differs-from-count'])
    expect(r.suggestedStatement).toContain(`: ${shown} `)
    expect(r.explanation[0]).toContain(`, ${shown})`)
  })

  it.each([
    ['accuracy', 1000000000, 1, '100.00%'],
    ['accuracy', 0, 0, '0.00%'],
    ['error-rate', 1000000000, 0, '0.00%'],
    ['error-rate', 0, 1, '100.00%'],
    ['accuracy', 799000000, 0.799, '79.90%'],
    ['error-rate', 799000000, 0.201, '20.10%'],
  ] as const)('%s with %s correct preserves real endpoints and ordinary rounding', (metric, correct, value, shown) => {
    const r = assessAccuracyClaim(fixed(metric, 1000000000, correct, value, 'complete'))
    expect(r.verdict).toBe('supported')
    expect(r.suggestedStatement).toContain(`: ${shown} `)
    expect(r.explanation[0]).toContain(`, ${shown})`)
  })

  it.each([
    ['accuracy', '99.99999999999999%', 1],
    ['error-rate', '0.00000000000001%', 0],
  ] as const)('%s with one failure at the largest safe count still describes an interior rate', (metric, shown, value) => {
    const r = assessAccuracyClaim(fixed(metric, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, value, 'complete'))
    expect(r.verdict).toBe('contradicted')
    expect(r.suggestedStatement).toContain(`: ${shown} `)
    expect(r.explanation[0]).toContain(`, ${shown})`)
  })

  it.each([
    ['accuracy', 0.999995, '499999 of 500000, 99.9998%'],
    ['error-rate', 0.000005, '1 of 500000, 0.0002%'],
  ] as const)('sample advice quotes the non-absolute observed %s rate', (metric, value, observed) => {
    const r = assessAccuracyClaim({ ...HUMAN, sampling: 'random', claim: { metric, value }, sample: { n: 500000, correct: 499999 } })
    expect(r.verdict).toBe('overstated')
    expect(r.reasons).toEqual(['claim-beyond-conservative-bound'])
    expect(r.explanation[0]).toContain(`observed rate (${observed})`)
  })

  it.each(BOUNDARIES)('sample explanation identifies the actual %s point claim near an endpoint', (metric, correct, value, shown) => {
    const r = assessAccuracyClaim({ ...HUMAN, sampling: 'random', claim: { metric, value }, sample: { n: 1000000000, correct } })
    expect(r.verdict).toBe('supported')
    expect(r.reasons).toEqual(['matches-observed-rate'])
    expect(r.explanation[0]).toContain(`The claimed ${shown}`)
  })

  it.each([
    ['accuracy', 999999990, 0.99999999, '99.999999%'],
    ['error-rate', 999999990, 1e-8, '0.000001%'],
  ] as const)('the text mismatch note does not rename an interior %s figure as absolute', (metric, correct, value, shown) => {
    const input = fixed(metric, 1000000000, correct, value, 'complete')
    input.claim.text = '99% on BenchX'
    const r = assessAccuracyClaim(input)
    expect(r.verdict).toBe('supported')
    expect(r.reasons).toEqual(['census-matches-count', 'text-figure-differs'])
    expect(r.explanation[1]).toContain(`figure judged (${shown})`)
  })

  it.each([
    [{}, 'supported', ['census-matches-count', 'precision-too-fine']],
    [{ strictPrecision: true }, 'overstated', ['precision-too-fine']],
    [{ conservative: true }, 'overstated', ['precision-too-fine']],
  ] as const)('formatting does not change fixed-set precision enforcement: %j', (options, verdict: AccuracyVerdict, reasons) => {
    const input = fixed('accuracy', 500000, 499999, 0.999998, 'complete')
    input.claim.display = '99.999800%'
    const r = assessAccuracyClaim(input, options)
    expect(r.verdict).toBe(verdict)
    expect(r.reasons).toEqual(reasons)
    expect(r.suggestedStatement).toContain(': 99.9998% accuracy.')
  })
})
