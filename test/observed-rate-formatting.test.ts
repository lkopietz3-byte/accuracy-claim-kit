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
    expect(r.explanation[0]).toContain('print the observed rate, or')
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

const ZERO_PERCENT = /(?<![\d.])0(?:\.0+)?%/
const HUNDRED_PERCENT = /(?<![\d.])100(?:\.0+)?%/

describe('Wilson interval wording preserves cautious rounding without false endpoints', () => {
  it.each([
    ['accuracy', 0.99, '99%', 'at least 99.99999% accurate', '99.99999% to 99.9999995%'],
    ['error-rate', 0.01, '1%', 'at most 0.00001% error rate', '0.0000005% to 0.00001%'],
  ] as const)('a near-perfect %s sample shows interior limits and the cautious headline', (metric, value, display, headline, interval) => {
    const r = assessAccuracyClaim({
      ...HUMAN, sampling: 'random', claim: { metric, value, display },
      sample: { n: 1_000_000_000, ...(metric === 'accuracy' ? { correct: 999_999_990 } : { errors: 10 }) },
    })
    expect(r.suggestedStatement).toContain(`${headline} (95% Wilson interval ${interval},`)
    for (const line of [r.suggestedStatement, ...r.explanation]) {
      expect(line).not.toMatch(ZERO_PERCENT)
      expect(line).not.toMatch(HUNDRED_PERCENT)
    }
  })

  it.each([
    ['accuracy', 0.99, '99.99999% to 100.00000%'],
    ['error-rate', 0.01, '0.00000% to 0.00001%'],
  ] as const)('a perfect sample preserves the actual %s interval endpoint', (metric, value, interval) => {
    const r = assessAccuracyClaim({ ...HUMAN, sampling: 'random', claim: { metric, value }, sample: { n: 1_000_000_000, correct: 1_000_000_000 } })
    expect(r.suggestedStatement).toContain(`95% Wilson interval ${interval},`)
  })

  it('uses words when even 15 decimals cannot show a positive Wilson lower limit', () => {
    const r = assessAccuracyClaim({
      ...HUMAN, sampling: 'random', claim: { metric: 'accuracy', value: 0.000001 },
      sample: { n: Number.MAX_SAFE_INTEGER, correct: 1 },
    }, { confidence: 1 - Number.EPSILON })
    expect(r.interval?.low).toBeGreaterThan(0)
    expect(r.interval?.low).toBeLessThan(1e-17)
    expect(r.suggestedStatement).toContain('at least just above 0% accurate')
    expect(r.suggestedStatement).toContain('Wilson interval just above 0% to ')
  })

  it('uses a numerical upper limit at the largest representable interior proportion', () => {
    const n = Number.MAX_SAFE_INTEGER
    const r = assessAccuracyClaim({ ...HUMAN, sampling: 'random', claim: { metric: 'accuracy', value: 0.99 }, sample: { n, correct: n - 1 } })
    expect(r.suggestedStatement).toContain('to 99.99999999999999%,')
  })

  it.each([
    ['accuracy', 0.01, 'at least 1%', /lower end \(0\.\d+%\)/],
    ['error-rate', 0.99, 'at most 99%', /upper end \(99\.\d+%\)/],
  ] as const)('describes the interior %s limit without advising a figure that exceeds strict precision', (metric, value, display, limit) => {
    const r = assessAccuracyClaim({
      ...HUMAN, sampling: 'random', claim: { metric, value, display }, sample: { n: 30, correct: 1 },
    }, { strictPrecision: true })
    expect(r.verdict).toBe('overstated')
    expect(r.explanation[0]).toMatch(limit)
    expect(r.explanation[0]).toContain('report the counts')
    expect(r.explanation[0]).not.toContain('print the bound rounded')
  })

  it.each([{}, { strictPrecision: true }, { conservative: true }])('seeded sample and complete-set wording stays off false endpoints with %j', (options) => {
    let seed = 0x9e3779b9
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const sizes = [10, 1_000_000_000_000]
    for (let exponent = 1; exponent < 12; exponent++) {
      for (let i = 0; i < 4; i++) sizes.push(Math.floor(10 ** exponent * (1 + 9 * next())))
    }
    for (const n of sizes) {
      const near = 3 + Math.floor(next() * 5)
      for (const correct of new Set([0, 1, 2, near, n - near, n - 2, n - 1, n])) {
        for (const metric of ['accuracy', 'error-rate'] as const) {
          const successes = metric === 'accuracy' ? correct : n - correct
          // Use interior claims so any endpoint in the text comes from the counts.
          const observed = Math.max(1, Math.min(n - 1, successes)) / n
          for (const claim of [
            { metric, value: observed },
            metric === 'accuracy' ? { metric, value: 0.99, display: '99.00000%' } : { metric, value: 0.01, display: '1.00000%' },
          ]) {
            for (const sampling of ['random', 'complete'] as const) {
              const r = assessAccuracyClaim({
                ...HUMAN, sampling, claim: { ...claim, text: 'Measured on BenchX' }, sample: { n, correct },
                ...(sampling === 'complete' ? { benchmark: { name: 'BenchX' } } : {}),
              }, options)
              const context = `${sampling} ${metric}, ${successes} of ${n}, claim ${claim.value}`
              for (const line of [r.suggestedStatement, ...r.explanation]) {
                if (successes !== 0) expect(line, context).not.toMatch(ZERO_PERCENT)
                if (successes !== n) expect(line, context).not.toMatch(HUNDRED_PERCENT)
              }
            }
          }
        }
      }
    }
  })
})

it.each([
  [0.99999999, '98%', '98%', '99.999999%'],
  [0.01, '99.999999%', '99.999999%', '1%'],
  [1e-8, '2%', '2%', '0.000001%'],
  [1e-32, '2%', '2%', '1e-30%'],
] as const)('a mismatched display reports its percentage and the value %s without a false endpoint', (value, display, printedDisplay, printedValue) => {
  expect(() => assessAccuracyClaim({ ...HUMAN, sampling: 'random', claim: { metric: 'accuracy', value, display } })).toThrow(
    `claim.display "${display}" (${printedDisplay}) does not match claim.value ${String(value)} (${printedValue}):`,
  )
})
