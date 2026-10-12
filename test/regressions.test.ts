import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput, AssessOptions } from '../src/index.js'
import { vectors } from './vectors.js'

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

describe('field:F1 noisy values against the exact-rational grid (generate_vectors.py)', () => {
  it('field:F1 every spelling of an honest one-decimal report, with and without a display, gets the verdict the oracle gives', () => {
    expect(vectors.noisyGrid.length).toBeGreaterThan(1000)
    let withDisplay = 0
    let withoutDisplay = 0
    for (const g of vectors.noisyGrid) {
      const label = `${g.metric} ${g.display ?? '(no display)'} value ${JSON.stringify(g.value)} ${String(g.k)}/${String(g.n)}`
      const claim =
        g.display === undefined ? { metric: g.metric, value: g.value } : { metric: g.metric, value: g.value, display: g.display }
      const counts = g.metric === 'accuracy' ? { n: g.n, correct: g.k } : { n: g.n, errors: g.k }
      expect(assessAccuracyClaim(census(claim, counts)).verdict, `census ${label}`).toBe(g.census)
      if (!g.nearLimit) {
        expect(assessAccuracyClaim(sampled(claim, counts), { minN: 1 }).verdict, `interval ${label}`).toBe(g.interval)
      }
      if (g.display === undefined) withoutDisplay += 1
      else withDisplay += 1
    }
    expect(withDisplay).toBeGreaterThan(400)
    expect(withoutDisplay).toBeGreaterThan(400)
  })
})

describe('false-pass:F1 a value with no display is never read coarser than a whole percent', () => {
  const big = { n: 1_000_000, correct: 851_000 }

  it('false-pass:F1 value 0.9 on 851000 of 1000000 is contradicted, 0.851 is still supported', () => {
    const coarse = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9 }, big))
    expect(outcome(coarse)).toBe('contradicted [claim-outside-interval]')
    expect(coarse.explanation.join(' ')).not.toMatch(/printed/)
    const exact = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.851 }, big))
    expect(outcome(exact)).toBe('supported [matches-observed-rate]')
    expect(exact.explanation.join(' ')).not.toMatch(/printed/)
    // a whole percent that is a faithful rounding of the observed rate is still honest
    expect(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.85 }, big)).verdict).toBe('supported')
  })

  it('false-pass:F1 every one-digit value, both metric directions, is judged at a whole percent or finer', () => {
    for (let tenth = 1; tenth <= 9; tenth++) {
      const value = tenth / 10
      const acc = assessAccuracyClaim(sampled({ metric: 'accuracy', value }, big))
      // 85.1%: only a value within half a point of it can match; the rest is above the interval or below the bound
      if (value > 0.851) expect(acc.verdict, `accuracy ${String(value)}`).toBe('contradicted')
      else expect(acc.reasons, `accuracy ${String(value)}`).toEqual(['claim-within-bound', 'claim-worse-than-counts'].slice(0, acc.reasons.length))
      const err = assessAccuracyClaim(sampled({ metric: 'error-rate', value }, { n: 1_000_000, errors: 149_000 }))
      if (value < 0.149) expect(err.verdict, `error ${String(value)}`).toBe('contradicted')
      else expect(err.verdict, `error ${String(value)}`).toBe('supported')
    }
    const errorMatch = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.149 }, { n: 1_000_000, errors: 149_000 }))
    expect(outcome(errorMatch)).toBe('supported [matches-observed-rate]')
  })

  it('false-pass:F1 on the complete-set path value 0.9 against 851 of 1000 is claim-differs-from-count', () => {
    const wrong = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.9 }, { n: 1000, correct: 851 }))
    expect(outcome(wrong)).toBe('contradicted [claim-differs-from-count]')
    const right = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.851 }, { n: 1000, correct: 851 }))
    expect(outcome(right)).toBe('supported [census-matches-count]')
    expect(right.explanation.join(' ')).not.toMatch(/printed/)
    expect(assessAccuracyClaim(census({ metric: 'accuracy', value: 0.85 }, { n: 1000, correct: 851 })).verdict).toBe('supported')
    const err = assessAccuracyClaim(census({ metric: 'error-rate', value: 0.1 }, { n: 1000, errors: 149 }))
    expect(outcome(err)).toBe('contradicted [claim-differs-from-count]')
  })

  it('false-pass:F1 other spellings of the same coarse value read the same', () => {
    for (const value of [0.9, 0.90, 9e-1, 0.9000000000000001, 0.8999999999999999, 90 / 100, 90 * 0.01]) {
      expect(assessAccuracyClaim(sampled({ metric: 'accuracy', value }, big)).verdict, String(value)).toBe('contradicted')
      expect(assessAccuracyClaim(census({ metric: 'accuracy', value }, { n: 1000, correct: 851 })).verdict, String(value)).toBe('contradicted')
    }
  })
})

// Used by later groups in this file.
export type { AssessOptions }
