import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput, AssessOptions } from '../src/index.js'

// Regression rows for the findings of the round 1 audit. Every row name starts
// with the finding id it pins, so `vitest -t "field:F1"` runs one finding.

function sampled(
  claim: AccuracyClaimInput['claim'],
  sample: AccuracyClaimInput['sample'],
  extra: Partial<AccuracyClaimInput> = {},
): AccuracyClaimInput {
  return { claim, sample, provenance: { source: 'human' }, sampling: 'random', ...extra }
}

function census(
  claim: AccuracyClaimInput['claim'],
  sample: AccuracyClaimInput['sample'],
  name = 'Foo set',
  extra: Partial<AccuracyClaimInput> = {},
): AccuracyClaimInput {
  return {
    claim: { text: `Scores well on the ${name}`, ...claim },
    sample,
    provenance: { source: 'human' },
    sampling: 'complete',
    benchmark: { name },
    ...extra,
  }
}

function outcome(r: AccuracyAssessment): string {
  return `${r.verdict} [${r.reasons.join(', ')}]`
}

describe('field:F1 a value computed as printedPercent / 100 is the printed figure', () => {
  it('field:F1 755 of 913 printed "82.7%" with value 82.7 / 100 is supported, like the literal 0.827', () => {
    const literal = assessAccuracyClaim(
      sampled({ metric: 'accuracy', value: 0.827, display: '82.7%' }, { n: 913, correct: 755 }),
    )
    expect(outcome(literal)).toBe('supported [matches-observed-rate, precision-too-fine]')
    for (const value of [82.7 / 100, 82.7 * 0.01]) {
      const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value, display: '82.7%' }, { n: 913, correct: 755 }))
      expect(outcome(r)).toBe(outcome(literal))
    }
  })

  it('field:F1 the same figure on the complete-set path is census-matches-count, not claim-differs-from-count', () => {
    for (const value of [0.827, 82.7 / 100, 82.7 * 0.01]) {
      const r = assessAccuracyClaim(census({ metric: 'accuracy', value, display: '82.7%' }, { n: 913, correct: 755 }))
      expect(outcome(r)).toBe('supported [census-matches-count]')
    }
    for (const display of ['about 82.7%', '~82.7%', '≈82.7%', 'approximately 82.7%']) {
      const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 82.7 / 100, display }, { n: 913, correct: 755 }))
      expect(r.verdict, display).toBe('supported')
    }
  })

  it('field:F1 a value one ulp below the figure is the figure too, and the explanation does not call it more favorable', () => {
    const value = 0.827 - 2 ** -53
    expect(value).not.toBe(0.827)
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value, display: '82.7%' }, { n: 913, correct: 755 }))
    expect(outcome(r)).toBe('supported [matches-observed-rate, precision-too-fine]')
    expect(r.explanation[0]).not.toMatch(/more favorable/)
    expect(r.assessedValue).toBe(value)
  })

  it('field:F1 a noisy value with no display reads as the figure it nearly is', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 82.7 / 100 }, { n: 913, correct: 755 }))
    expect(outcome(r)).toBe('supported [matches-observed-rate]')
    const c = assessAccuracyClaim(census({ metric: 'accuracy', value: 82.7 / 100 }, { n: 913, correct: 755 }))
    expect(outcome(c)).toBe('supported [census-matches-count]')
  })

  it('field:F1 a value that really is more favorable than the print is still judged as its own figure', () => {
    // display "82.7%" allows 0.8265 to 0.8275; 0.8274 is inside that but is not what 755 / 913 rounds to at four digits
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.8274, display: '82.7%' }, { n: 913, correct: 755 }))
    expect(r.verdict).toBe('overstated')
  })

  // Deterministic stand-in for the field simulation of honest one-decimal reports:
  // every value spelling of a printed percent must give the verdict of the literal.
  it('field:F1 no honest one-decimal report flips with the way its value was computed (sample and complete set)', () => {
    const sizes = [30, 99, 500, 913, 1000, 1946, 2000]
    let compared = 0
    let noisy = 0
    for (const n of sizes) {
      const step = Math.max(1, Math.floor(n / 150))
      for (let k = 0; k <= n; k += step) {
        for (const metric of ['accuracy', 'error-rate'] as const) {
          const pct = ((k / n) * 100).toFixed(1)
          const literal = Number(`${pct}e-2`)
          const display = `${pct}%`
          const spellings = [Number(pct) / 100, Number(pct) * 0.01, Number(pct) / 100 + 0, +(Number(pct) / 100).toPrecision(15)]
          const counts = metric === 'accuracy' ? { n, correct: k } : { n, errors: k }
          const wantSample = outcome(assessAccuracyClaim(sampled({ metric, value: literal, display }, counts), { minN: 1 }))
          const wantCensus = outcome(assessAccuracyClaim(census({ metric, value: literal, display }, counts)))
          for (const value of spellings) {
            if (value !== literal) noisy += 1
            expect(outcome(assessAccuracyClaim(sampled({ metric, value, display }, counts), { minN: 1 })), `${metric} ${k}/${n} ${display} ${String(value)}`).toBe(wantSample)
            expect(outcome(assessAccuracyClaim(census({ metric, value, display }, counts))), `census ${metric} ${k}/${n} ${display} ${String(value)}`).toBe(wantCensus)
            compared += 1
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(2000)
    expect(noisy).toBeGreaterThan(200) // the sweep does contain noisy values
  })
})

// Used by later groups in this file.
export type { AssessOptions }
