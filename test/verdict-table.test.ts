import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  assessAccuracyClaim,
  cohenKappa,
  COMPARISON_TOLERANCE,
  maxDisplayDecimals,
  wilsonInterval,
} from '../src/index.js'
import type {
  AccuracyClaimInput,
  AccuracyVerdict,
  AssessOptions,
  ReasonCode,
} from '../src/index.js'
import { gwetAC1, percentAgreement } from '../src/index.js'
import { pctCeil, pctFloor } from '../src/format.js'
import { vectors } from './vectors.js'

// Verdict regression table. Each row is one honest input that must pass or one
// bad input that must be flagged. "refused" means "cannot tell", never "false".

type Over = Partial<AccuracyClaimInput>

function input(over: Over = {}): AccuracyClaimInput {
  return {
    claim: { metric: 'accuracy', value: 0.98 },
    sample: { n: 1000, correct: 990 },
    provenance: { source: 'human', raters: 2 },
    sampling: 'random',
    ...over,
  }
}

function accuracy(value: number, display?: string): AccuracyClaimInput['claim'] {
  return display === undefined ? { metric: 'accuracy', value } : { metric: 'accuracy', value, display }
}
function errorRate(value: number, display?: string): AccuracyClaimInput['claim'] {
  return display === undefined ? { metric: 'error-rate', value } : { metric: 'error-rate', value, display }
}

interface Row {
  name: string
  input: AccuracyClaimInput
  options?: AssessOptions
  verdict: AccuracyVerdict
  reasons: ReasonCode[]
}

const bad = {
  strata: [
    { name: 'english', n: 1000, correct: 980 },
    { name: 'tagalog', n: 30, correct: 10 },
  ],
}

const rows: Row[] = [
  // ---- refused ---------------------------------------------------------
  {
    name: '0.2% error with zero human labels (model-labeled)',
    input: input({ claim: errorRate(0.002, '0.2%'), sample: { n: 1000, errors: 2 }, provenance: { source: 'model' } }),
    verdict: 'refused',
    reasons: ['no-human-labels'],
  },
  {
    name: 'label source unknown',
    input: input({ provenance: { source: 'unknown' } }),
    verdict: 'refused',
    reasons: ['unknown-label-source'],
  },
  {
    name: 'mixed labels are not split out',
    input: input({ provenance: { source: 'mixed' } }),
    verdict: 'refused',
    reasons: ['mixed-label-source'],
  },
  {
    name: 'ranked-sample 99% claim',
    input: input({ claim: accuracy(0.99, '99%'), sampling: 'ranked' }),
    verdict: 'refused',
    reasons: ['ranked-sample'],
  },
  {
    name: 'convenience sample',
    input: input({ sampling: 'convenience' }),
    verdict: 'refused',
    reasons: ['convenience-sample'],
  },
  {
    name: 'sampling unknown',
    input: input({ sampling: 'unknown' }),
    verdict: 'refused',
    reasons: ['unknown-sampling'],
  },
  {
    name: 'n = 29 is below the default minimum of 30',
    input: input({ claim: accuracy(0.5), sample: { n: 29, correct: 29 } }),
    verdict: 'refused',
    reasons: ['sample-too-small'],
  },
  {
    name: 'n = 50 is below a caller minimum of 100',
    input: input({ claim: accuracy(0.5), sample: { n: 50, correct: 50 } }),
    options: { minN: 100 },
    verdict: 'refused',
    reasons: ['sample-too-small'],
  },
  {
    name: 'merged strata hiding a bad stratum',
    input: input({ claim: accuracy(0.9), sample: { n: 1030, correct: 990 }, ...bad }),
    verdict: 'refused',
    reasons: ['merged-strata-differ'],
  },
  {
    name: 'retractions known but not in the counts',
    input: input({ retractions: { count: 3, includedInSample: false } }),
    verdict: 'refused',
    reasons: ['retractions-not-included'],
  },
  {
    name: 'kappa 0.6 below a required 0.8',
    input: input({ provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: 0.6 } } }),
    options: { minAgreement: 0.8 },
    verdict: 'refused',
    reasons: ['agreement-below-minimum'],
  },
  {
    name: 'agreement required but not supplied',
    input: input(),
    options: { minAgreement: 0.8 },
    verdict: 'refused',
    reasons: ['agreement-missing'],
  },
  {
    name: 'agreement required but undefined for these labels',
    input: input({
      provenance: { source: 'human', agreement: cohenKappa([['a', 'a'], ['a', 'a']]) },
    }),
    options: { minAgreement: 0.5 },
    verdict: 'refused',
    reasons: ['agreement-undefined'],
  },
  {
    name: 'every failed precondition is listed, not just the first',
    input: input({
      provenance: { source: 'model' },
      sampling: 'ranked',
      sample: { n: 10, correct: 10 },
      retractions: { count: 1, includedInSample: false },
    }),
    verdict: 'refused',
    reasons: ['no-human-labels', 'ranked-sample', 'sample-too-small', 'retractions-not-included'],
  },
  {
    name: 'a refusal outranks an obviously false claim',
    input: input({ claim: accuracy(0.99), sample: { n: 1000, correct: 600 }, sampling: 'convenience' }),
    verdict: 'refused',
    reasons: ['convenience-sample'],
  },

  // ---- supported -------------------------------------------------------
  {
    name: '990/1000 claimed as 98%',
    input: input({ claim: accuracy(0.98, '98%') }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'a claim far below the evidence is supported (understated)',
    input: input({ claim: accuracy(0.5) }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'error rate 10/1000 claimed as 2%',
    input: input({ claim: errorRate(0.02, '2%'), sample: { n: 1000, errors: 10 } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'correct and errors both given and consistent',
    input: input({ sample: { n: 1000, correct: 990, errors: 10 } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'strata whose intervals overlap are not a refusal',
    input: input({
      claim: accuracy(0.9),
      sample: { n: 200, correct: 193 },
      strata: [{ name: 'a', n: 100, correct: 98 }, { name: 'b', n: 100, correct: 95 }],
    }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'retractions that are counted are fine',
    input: input({ retractions: { count: 3, includedInSample: true } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'zero retractions need no inclusion',
    input: input({ retractions: { count: 0, includedInSample: false } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'agreement exactly at the required minimum passes',
    input: input({ provenance: { source: 'human', agreement: { statistic: 'gwet-ac1', value: 0.8 } } }),
    options: { minAgreement: 0.8 },
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'low agreement is not a refusal when no minimum is set',
    input: input({ provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: 0.1 } } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'n = 30 exactly meets the minimum',
    input: input({ claim: accuracy(0.5), sample: { n: 30, correct: 30 } }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },
  {
    name: 'stratified sampling is accepted',
    input: input({ sampling: 'stratified' }),
    verdict: 'supported',
    reasons: ['claim-within-bound'],
  },

  // ---- overstated ------------------------------------------------------
  {
    name: '499/500 claimed as "99.8%": inside the interval and printed too finely',
    input: input({ claim: accuracy(0.998, '99.8%'), sample: { n: 500, correct: 499 } }),
    verdict: 'overstated',
    reasons: ['claim-beyond-conservative-bound', 'precision-too-fine'],
  },
  {
    name: '499/500 claimed as 99% (above the 98.88% lower end)',
    input: input({ claim: accuracy(0.99, '99%'), sample: { n: 500, correct: 499 } }),
    verdict: 'overstated',
    reasons: ['claim-beyond-conservative-bound'],
  },
  {
    name: '499/500 claimed as "98.5%": the value is safe but the decimal is not',
    input: input({ claim: accuracy(0.985, '98.5%'), sample: { n: 500, correct: 499 } }),
    verdict: 'overstated',
    reasons: ['precision-too-fine'],
  },
  {
    name: '500/500 claimed as 100% (an interval never reaches certainty)',
    input: input({ claim: accuracy(1, '100%'), sample: { n: 500, correct: 500 } }),
    verdict: 'overstated',
    reasons: ['claim-beyond-conservative-bound'],
  },
  {
    name: 'error rate 1/500 claimed as 0.2%',
    input: input({ claim: errorRate(0.002, '0.2%'), sample: { n: 500, errors: 1 } }),
    verdict: 'overstated',
    reasons: ['claim-beyond-conservative-bound', 'precision-too-fine'],
  },
  {
    name: 'error rate 0/100 claimed as 0%',
    input: input({ claim: errorRate(0, '0%'), sample: { n: 100, errors: 0 } }),
    verdict: 'overstated',
    reasons: ['claim-beyond-conservative-bound'],
  },

  // ---- contradicted ----------------------------------------------------
  {
    name: '900/1000 claimed as 95%',
    input: input({ claim: accuracy(0.95, '95%'), sample: { n: 1000, correct: 900 } }),
    verdict: 'contradicted',
    reasons: ['claim-outside-interval'],
  },
  {
    name: 'error rate 100/1000 claimed as 2%',
    input: input({ claim: errorRate(0.02, '2%'), sample: { n: 1000, errors: 100 } }),
    verdict: 'contradicted',
    reasons: ['claim-outside-interval'],
  },
  {
    name: '499/500 claimed as 100% is above the interval top',
    input: input({ claim: accuracy(1), sample: { n: 500, correct: 499 } }),
    verdict: 'contradicted',
    reasons: ['claim-outside-interval'],
  },
  {
    name: 'contradicted and over-precise lists both',
    input: input({ claim: accuracy(0.951, '95.1%'), sample: { n: 1000, correct: 900 } }),
    verdict: 'contradicted',
    reasons: ['claim-outside-interval', 'precision-too-fine'],
  },
]

describe('verdict table', () => {
  for (const row of rows) {
    it(`${row.verdict}: ${row.name}`, () => {
      const r = assessAccuracyClaim(row.input, row.options)
      expect(r.verdict).toBe(row.verdict)
      expect(r.reasons).toEqual(row.reasons)
      expect(r.explanation).toHaveLength(r.reasons.length)
      expect(r.suggestedStatement.length).toBeGreaterThan(0)
      if (row.verdict === 'refused') {
        expect(r.interval).toBeNull()
        expect(r.conservativeBound).toBeNull()
        expect(r.suggestedStatement).not.toMatch(/\d/)
      } else {
        expect(r.interval).not.toBeNull()
        expect(r.conservativeBound).not.toBeNull()
      }
    })
  }

  it('covers all four verdicts', () => {
    expect(new Set(rows.map((r) => r.verdict))).toEqual(
      new Set(['refused', 'supported', 'overstated', 'contradicted']),
    )
  })
})

describe('suggested statements', () => {
  it('floors an accuracy bound and never rounds the evidence upward', () => {
    const r = assessAccuracyClaim(input({ claim: accuracy(0.998, '99.8%'), sample: { n: 500, correct: 499 } }))
    // The lower limit is 98.8759...%, so it prints as 98.8, not 98.9.
    expect(r.suggestedStatement).toBe(
      'At least 98.8% accurate (95% Wilson interval 98.87% to 99.97%, n = 500, human labels, random sample)',
    )
  })

  it('ceils an error-rate bound and names the stratified sample and the agreement', () => {
    const r = assessAccuracyClaim(
      input({
        claim: errorRate(0.02),
        sample: { n: 1000, errors: 10 },
        sampling: 'stratified',
        provenance: { source: 'human', agreement: { statistic: 'gwet-ac1', value: 0.912 } },
      }),
    )
    expect(r.suggestedStatement).toBe(
      'At most 1.9% error rate (95% Wilson interval 0.54% to 1.84%, n = 1000, human labels, stratified sample, Gwet AC1 0.91)',
    )
  })

  it('uses the caller confidence level in the text', () => {
    const r = assessAccuracyClaim(input(), { confidence: 0.99 })
    expect(r.suggestedStatement).toContain('99% Wilson interval')
    const r2 = assessAccuracyClaim(input(), { confidence: 0.999 })
    expect(r2.suggestedStatement).toContain('99.9% Wilson interval')
  })

  it('says why a refusal has no figure, without a number', () => {
    const r = assessAccuracyClaim(input({ sampling: 'ranked', provenance: { source: 'model' } }))
    expect(r.suggestedStatement).toBe(
      'No accuracy figure can be supported from this evidence: the labels were not checked by people; the sample was picked by rank, not at random.',
    )
  })

  it('the stated bound is never better than the interval limit', () => {
    for (const g of vectors.verdictGrid.slice(0, 400)) {
      const r = assessAccuracyClaim(gridInput(g), { confidence: g.confidence })
      if (r.verdict === 'refused') continue
      const m = /^At (?:least|most) (\d+(?:\.\d+)?)%/.exec(r.suggestedStatement)
      expect(m).not.toBeNull()
      const stated = Number((m as RegExpExecArray)[1]) / 100
      if (g.metric === 'accuracy') expect(stated).toBeLessThanOrEqual(g.low + 1e-9)
      else expect(stated).toBeGreaterThanOrEqual(g.high - 1e-9)
    }
  })
})

describe('boundaries are decided with a documented tolerance', () => {
  const sample = { n: 1000, correct: 990 }
  const iv = wilsonInterval(990, 1000)
  const errIv = wilsonInterval(10, 1000)
  const verdictFor = (claim: AccuracyClaimInput['claim'], s: AccuracyClaimInput['sample'] = sample): AccuracyVerdict =>
    assessAccuracyClaim(input({ claim, sample: s })).verdict

  it('has a tolerance far below any possible interval width', () => {
    expect(COMPARISON_TOLERANCE).toBe(1e-12)
  })

  it('accuracy exactly at the lower limit is supported, just past it is not', () => {
    expect(verdictFor(accuracy(iv.low))).toBe('supported')
    expect(verdictFor(accuracy(iv.low + COMPARISON_TOLERANCE / 2))).toBe('supported')
    expect(verdictFor(accuracy(iv.low + 1e-9))).toBe('overstated')
    expect(verdictFor(accuracy(iv.low - 1e-9))).toBe('supported')
  })

  it('accuracy exactly at the upper limit is overstated, just past it is contradicted', () => {
    expect(verdictFor(accuracy(iv.high))).toBe('overstated')
    expect(verdictFor(accuracy(iv.high + COMPARISON_TOLERANCE / 2))).toBe('overstated')
    expect(verdictFor(accuracy(iv.high + 1e-9))).toBe('contradicted')
  })

  it('error rate exactly at the upper limit is supported, just below it is not', () => {
    const s = { n: 1000, errors: 10 }
    expect(verdictFor(errorRate(errIv.high), s)).toBe('supported')
    expect(verdictFor(errorRate(errIv.high - COMPARISON_TOLERANCE / 2), s)).toBe('supported')
    expect(verdictFor(errorRate(errIv.high - 1e-9), s)).toBe('overstated')
  })

  it('error rate exactly at the lower limit is overstated, just below it is contradicted', () => {
    const s = { n: 1000, errors: 10 }
    expect(verdictFor(errorRate(errIv.low), s)).toBe('overstated')
    expect(verdictFor(errorRate(errIv.low - COMPARISON_TOLERANCE / 2), s)).toBe('overstated')
    expect(verdictFor(errorRate(errIv.low - 1e-9), s)).toBe('contradicted')
  })

  it('mirrors: accuracy on n-k correct behaves like error rate on k errors', () => {
    const a = assessAccuracyClaim(input({ claim: accuracy(0.985), sample: { n: 1000, correct: 990 } }))
    const e = assessAccuracyClaim(input({ claim: errorRate(0.015), sample: { n: 1000, errors: 10 } }))
    expect(a.verdict).toBe(e.verdict)
  })

  it('agreement is compared with the same tolerance', () => {
    const prov = (value: number): AccuracyClaimInput['provenance'] => ({
      source: 'human',
      agreement: { statistic: 'cohen-kappa', value },
    })
    expect(assessAccuracyClaim(input({ provenance: prov(0.8 - 1e-13) }), { minAgreement: 0.8 }).verdict).toBe('supported')
    expect(assessAccuracyClaim(input({ provenance: prov(0.8 - 1e-9) }), { minAgreement: 0.8 }).verdict).toBe('refused')
  })

  it('strata that only touch are not a refusal', () => {
    // identical strata: the highest low is below the lowest high
    const r = assessAccuracyClaim(
      input({
        claim: accuracy(0.5),
        sample: { n: 200, correct: 180 },
        strata: [{ name: 'a', n: 100, correct: 90 }, { name: 'b', n: 100, correct: 90 }],
      }),
    )
    expect(r.verdict).toBe('supported')
  })
})

describe('display precision', () => {
  it('maxDisplayDecimals counts decimals whose last digit is at least a tenth of the width', () => {
    expect(maxDisplayDecimals(0.3)).toBe(0)
    expect(maxDisplayDecimals(0.0109)).toBe(0)
    expect(maxDisplayDecimals(0.01)).toBe(1) // exactly 1 point wide: one tenth is 0.1, allowed
    expect(maxDisplayDecimals(0.0100001)).toBe(0)
    expect(maxDisplayDecimals(0.001)).toBe(2)
    expect(maxDisplayDecimals(0.0001)).toBe(3)
    expect(maxDisplayDecimals(0)).toBe(15)
  })

  it('rejects a bad width', () => {
    expect(() => maxDisplayDecimals(-1)).toThrow(RangeError)
    expect(() => maxDisplayDecimals(2)).toThrow(RangeError)
    expect(() => maxDisplayDecimals(Number.NaN)).toThrow(RangeError)
    expect(() => maxDisplayDecimals('1' as unknown as number)).toThrow(TypeError)
  })

  it('whole-percent figures are never called too precise', () => {
    const r = assessAccuracyClaim(input({ claim: accuracy(0.5, '50%'), sample: { n: 30, correct: 30 } }))
    expect(r.verdict).toBe('supported')
  })

  it('the same figure passes with enough data', () => {
    // 9980/10000: the interval is about 0.18 points wide, so one decimal is fine.
    const ok = assessAccuracyClaim(input({ claim: accuracy(0.996, '99.6%'), sample: { n: 10_000, correct: 9980 } }))
    expect(ok.verdict).toBe('supported')
    const tooFine = assessAccuracyClaim(input({ claim: accuracy(0.996, '99.60%'), sample: { n: 10_000, correct: 9980 } }))
    expect(tooFine.reasons).toEqual(['precision-too-fine'])
  })

  it('accepts spacing around the percent figure', () => {
    expect(assessAccuracyClaim(input({ claim: accuracy(0.98, ' 98 % ') })).verdict).toBe('supported')
  })
})

describe('python grid cross-check (independent restatement of the rules)', () => {
  it('agrees on every row', () => {
    expect(vectors.verdictGrid.length).toBeGreaterThan(500)
    for (const g of vectors.verdictGrid) {
      const r = assessAccuracyClaim(gridInput(g), { confidence: g.confidence })
      expect(r.verdict, `${g.metric} ${String(g.correct ?? g.errors)}/${String(g.n)} ${g.tag} claim ${String(g.claim)}`).toBe(
        g.expected,
      )
      expect(Math.abs((r.interval?.low as number) - g.low)).toBeLessThan(1e-14)
      expect(Math.abs((r.interval?.high as number) - g.high)).toBeLessThan(1e-14)
    }
  })
})

function gridInput(g: (typeof vectors.verdictGrid)[number]): AccuracyClaimInput {
  return input({
    claim: { metric: g.metric, value: g.claim },
    sample: g.metric === 'accuracy' ? { n: g.n, correct: g.correct } : { n: g.n, errors: g.errors },
  })
}

describe('hostile inputs', () => {
  const throwsFor = (over: Over, kind: ErrorConstructor, options?: AssessOptions): void => {
    expect(() => assessAccuracyClaim(input(over), options)).toThrow(kind)
  }

  it('rejects NaN, infinities and out-of-range claim values', () => {
    for (const value of [Number.NaN, Infinity, -Infinity, -0.001, 1.001, 99.8]) {
      throwsFor({ claim: accuracy(value) }, RangeError)
    }
    throwsFor({ claim: accuracy('0.9' as unknown as number) }, TypeError)
  })

  it('reads -0 as 0 and never returns it', () => {
    const r = assessAccuracyClaim(input({ claim: errorRate(-0), sample: { n: 100, errors: 0 } }))
    expect(Object.is(r.claimed, 0)).toBe(true)
    expect(r.verdict).toBe('overstated')
    const r2 = assessAccuracyClaim(input({ sample: { n: 1000, correct: 990, errors: -0 + 10 } }))
    expect(r2.verdict).toBe('supported')
    expect(() => assessAccuracyClaim(input({ sample: { n: -0, correct: 0 } }))).toThrow(RangeError)
  })

  it('rejects bad counts', () => {
    throwsFor({ sample: { n: 100.5, correct: 50 } }, RangeError)
    throwsFor({ sample: { n: 100, correct: 50.5 } }, RangeError)
    throwsFor({ sample: { n: 100, correct: 101 } }, RangeError)
    throwsFor({ sample: { n: 100, errors: 101 } }, RangeError)
    throwsFor({ sample: { n: 100, correct: -1 } }, RangeError)
    throwsFor({ sample: { n: 0, correct: 0 } }, RangeError)
    throwsFor({ sample: { n: Number.NaN, correct: 0 } }, RangeError)
    throwsFor({ sample: { n: 100, correct: Number.NaN } }, RangeError)
    throwsFor({ sample: { n: 100, correct: 60, errors: 60 } }, RangeError)
    throwsFor({ sample: { n: 100 } }, TypeError)
    throwsFor({ sample: { n: 100, correct: '50' as unknown as number } }, TypeError)
    throwsFor({ sample: { n: 100, correct: null as unknown as number } }, TypeError)
    throwsFor({ sample: { n: 2 ** 53, correct: 1 } }, RangeError)
  })

  it('rejects wrong shapes at every level', () => {
    for (const bad of [null, undefined, 5, 'x', [], true]) {
      expect(() => assessAccuracyClaim(bad as unknown as AccuracyClaimInput)).toThrow(TypeError)
      throwsFor({ claim: bad as unknown as AccuracyClaimInput['claim'] }, TypeError)
      throwsFor({ sample: bad as unknown as AccuracyClaimInput['sample'] }, TypeError)
      throwsFor({ provenance: bad as unknown as AccuracyClaimInput['provenance'] }, TypeError)
    }
    throwsFor({ sample: new Number(5) as unknown as AccuracyClaimInput['sample'] }, TypeError)
  })

  it('rejects unknown or wrongly cased enum values', () => {
    throwsFor({ claim: { metric: 'precision' as 'accuracy', value: 0.9 } }, RangeError)
    throwsFor({ provenance: { source: 'Human' as 'human' } }, RangeError)
    throwsFor({ sampling: 'Random' as 'random' }, RangeError)
    throwsFor({ sampling: undefined as unknown as 'random' }, TypeError)
    throwsFor({ provenance: { source: 5 as unknown as 'human' } }, TypeError)
  })

  it('rejects a display that is malformed or disagrees with the value', () => {
    for (const display of ['abc', '99.8', '', '%', '1e2%', '99.8 percent', '-5%', '99.8%%', '0x10%', '٩٩%']) {
      throwsFor({ claim: accuracy(0.998, display) }, RangeError)
    }
    throwsFor({ claim: accuracy(0.998, '50%') }, RangeError)
    throwsFor({ claim: accuracy(0.998, 'x'.repeat(100_000)) }, RangeError)
    throwsFor({ claim: accuracy(0.998, 99.8 as unknown as string) }, TypeError)
    // rounding either way inside half a unit is a match
    expect(assessAccuracyClaim(input({ claim: accuracy(0.9984, '99.8%') })).reasons).toContain('precision-too-fine')
  })

  it('rejects bad strata, retractions, raters and agreement', () => {
    throwsFor({ strata: [] }, RangeError)
    throwsFor({ strata: 'x' as unknown as [] }, TypeError)
    throwsFor({ strata: [{ name: 'a', n: 500, correct: 495 }] }, RangeError) // does not add up
    throwsFor({ strata: [{ name: '', n: 1000, correct: 990 }] }, RangeError)
    throwsFor({ strata: [{ name: 5 as unknown as string, n: 1000, correct: 990 }] }, TypeError)
    throwsFor({ strata: [null as unknown as { name: string; n: number; correct: number }] }, TypeError)
    throwsFor({ strata: [{ name: 'a', n: 500, correct: 495 }, { name: 'a', n: 500, correct: 495 }] }, RangeError)
    throwsFor({ strata: new Array(2) }, TypeError)
    throwsFor({ retractions: { count: -1, includedInSample: true } }, RangeError)
    throwsFor({ retractions: { count: 1.5, includedInSample: true } }, RangeError)
    throwsFor({ retractions: { count: 1001, includedInSample: true } }, RangeError) // more than n
    throwsFor({ retractions: { count: 1, includedInSample: 'no' as unknown as boolean } }, TypeError)
    throwsFor({ retractions: { count: 1 } as unknown as { count: number; includedInSample: boolean } }, TypeError)
    throwsFor({ provenance: { source: 'human', raters: 0 } }, RangeError)
    throwsFor({ provenance: { source: 'human', raters: 1.5 } }, RangeError)
    throwsFor({ provenance: { source: 'human', agreement: { statistic: 'kappa', value: 0.5 } as never } }, RangeError)
    throwsFor({ provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: 1.5 } } }, RangeError)
    throwsFor({ provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: Number.NaN } } }, RangeError)
    throwsFor({ provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: '0.5' as unknown as number } } }, TypeError)
  })

  it('does not let huge strata sums round into agreement with the total', () => {
    const big = Number.MAX_SAFE_INTEGER
    throwsFor(
      {
        sample: { n: big, correct: big - 1 },
        strata: [
          { name: 'a', n: big - 1, correct: big - 2 },
          { name: 'b', n: 2, correct: 1 },
        ],
      },
      RangeError,
    )
  })

  it('rejects bad options', () => {
    for (const minN of [0, -1, 1.5, Number.NaN, Infinity]) throwsFor({}, RangeError, { minN })
    for (const confidence of [0, 1, Number.NaN, 2]) throwsFor({}, RangeError, { confidence })
    for (const minAgreement of [2, -2, Number.NaN]) throwsFor({}, RangeError, { minAgreement })
    throwsFor({}, TypeError, { minN: '30' as unknown as number })
    throwsFor({}, TypeError, null as unknown as AssessOptions)
  })

  it('keeps a huge n finite', () => {
    for (const n of [1e12, 1e15, Number.MAX_SAFE_INTEGER]) {
      const r = assessAccuracyClaim(input({ claim: accuracy(0.5), sample: { n, correct: Math.floor(n * 0.9) } }))
      expect(r.verdict).toBe('supported')
      expect(Number.isFinite(r.interval?.low)).toBe(true)
      expect(Number.isFinite(r.interval?.high)).toBe(true)
      expect(r.suggestedStatement).not.toMatch(/NaN|Infinity|e\+/)
    }
  })

  it('never returns NaN, Infinity or -0 anywhere in a sweep', () => {
    for (const n of [30, 31, 100, 1000, 12_345]) {
      for (const k of [0, 1, Math.floor(n / 2), n - 1, n]) {
        for (const metric of ['accuracy', 'error-rate'] as const) {
          for (const value of [0, 0.001, 0.5, 0.999, 1]) {
            const r = assessAccuracyClaim(
              input({ claim: { metric, value }, sample: { n, correct: k } }),
            )
            const nums = [r.claimed, r.interval?.low, r.interval?.high, r.conservativeBound].filter(
              (x): x is number => x !== null && x !== undefined,
            )
            for (const x of nums) {
              expect(Number.isFinite(x)).toBe(true)
              expect(Object.is(x, -0)).toBe(false)
            }
            expect(r.suggestedStatement).not.toMatch(/NaN|Infinity|undefined|-0/)
          }
        }
      }
    }
  })
})

describe('inputs are read once', () => {
  /** Wraps a value in Proxies that count property reads, recursively. */
  function counting<T extends object>(target: T, counts: Map<string, number>, path = ''): T {
    return new Proxy(target, {
      get(obj, key, receiver) {
        const name = `${path}.${String(key)}`
        counts.set(name, (counts.get(name) ?? 0) + 1)
        const value: unknown = Reflect.get(obj, key, receiver)
        if (typeof value === 'object' && value !== null && typeof key === 'string') {
          return counting(value, counts, name)
        }
        return value
      },
      has() {
        throw new Error('has trap must not be used')
      },
      ownKeys() {
        throw new Error('ownKeys trap must not be used')
      },
    })
  }

  const full: AccuracyClaimInput = {
    claim: { metric: 'accuracy', value: 0.98, display: '98%' },
    sample: { n: 1030, correct: 990 },
    provenance: { source: 'human', raters: 2, agreement: { statistic: 'cohen-kappa', value: 0.9 } },
    sampling: 'stratified',
    strata: [
      { name: 'a', n: 1000, correct: 970 },
      { name: 'b', n: 30, correct: 20 },
    ],
    retractions: { count: 2, includedInSample: true },
  }

  it('reads every property of a Proxy input at most once, and never lists keys', () => {
    const counts = new Map<string, number>()
    const opts = counting({ confidence: 0.9, minN: 30, minAgreement: 0.5 }, counts, 'options')
    const r = assessAccuracyClaim(counting(full, counts, 'input'), opts)
    expect(r.verdict).toBeDefined()
    for (const [name, count] of counts) {
      // array "length" is read once per array, indexes once each
      expect(count, name).toBe(1)
    }
    expect(counts.size).toBeGreaterThan(20)
  })

  it('judges the first value of a getter that changes on every read', () => {
    let reads = 0
    const flip = {
      get n(): number {
        reads += 1
        return reads === 1 ? 1000 : -5
      },
      correct: 990,
    }
    const r = assessAccuracyClaim(input({ sample: flip }))
    expect(reads).toBe(1)
    expect(r.n).toBe(1000)
    expect(r.verdict).toBe('supported')
  })

  it('judges the first source and sampling of getters that flip', () => {
    let a = 0
    let b = 0
    const prov = {
      get source(): string {
        a += 1
        return a === 1 ? 'human' : 'model'
      },
    }
    const root = {
      claim: accuracy(0.98),
      sample: { n: 1000, correct: 990 },
      provenance: prov,
      get sampling(): string {
        b += 1
        return b === 1 ? 'random' : 'ranked'
      },
    }
    const r = assessAccuracyClaim(root as unknown as AccuracyClaimInput)
    expect(r.verdict).toBe('supported')
    expect([a, b]).toEqual([1, 1])
  })

  it('lets an error thrown by the caller own getter propagate unchanged', () => {
    const boom = new Error('getter failed')
    const sample = {
      n: 1000,
      get correct(): number {
        throw boom
      },
    }
    expect(() => assessAccuracyClaim(input({ sample }))).toThrow(boom)
  })

  it('accepts null-prototype objects, class instances and inherited fields', () => {
    const nullProto = Object.assign(Object.create(null) as object, {
      claim: Object.assign(Object.create(null) as object, accuracy(0.98)),
      sample: Object.assign(Object.create(null) as object, { n: 1000, correct: 990 }),
      provenance: Object.assign(Object.create(null) as object, { source: 'human' }),
      sampling: 'random',
    })
    expect(assessAccuracyClaim(nullProto as AccuracyClaimInput).verdict).toBe('supported')

    class Sample {
      readonly n = 1000
      get correct(): number {
        return 990
      }
    }
    expect(assessAccuracyClaim(input({ sample: new Sample() })).verdict).toBe('supported')

    const proto = { n: 1000, correct: 990 }
    expect(assessAccuracyClaim(input({ sample: Object.create(proto) as { n: number; correct: number } })).verdict).toBe(
      'supported',
    )
  })

  it('ignores toJSON, then and unrelated keys', () => {
    const noisy = {
      ...input(),
      toJSON(): never {
        throw new Error('toJSON must not be called')
      },
      then(): never {
        throw new Error('then must not be called')
      },
      extra: { surprise: true },
    }
    expect(assessAccuracyClaim(noisy).verdict).toBe('supported')
  })

  it('does not change a frozen input and returns the same output twice', () => {
    const deepFreeze = <T extends object>(o: T): T => {
      for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v)
      return Object.freeze(o)
    }
    const frozen = deepFreeze(JSON.parse(JSON.stringify(full)) as AccuracyClaimInput)
    const a = assessAccuracyClaim(frozen, { minAgreement: 0.5 })
    const b = assessAccuracyClaim(frozen, { minAgreement: 0.5 })
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('caller strings with lone surrogates and zero-width characters stay inside the message', () => {
    const name = `${'x'.repeat(59)}😀 tail`
    const r = assessAccuracyClaim(
      input({
        claim: accuracy(0.9),
        sample: { n: 1030, correct: 990 },
        strata: [
          { name, n: 1000, correct: 980 },
          { name: 'ok​', n: 30, correct: 10 },
        ],
      }),
    )
    expect(r.reasons).toEqual(['merged-strata-differ'])
    expect(r.explanation[0]).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })
})

describe('seeded fuzz: only TypeError, RangeError or a well-formed result', () => {
  it('survives 6000 inputs built from awkward values', () => {
    let state = 20_261_010
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state / 2 ** 32
    }
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T
    const numbers = [0, -0, 1, 2, 29, 30, 31, 100, 999, 1000, 1e12, 0.5, 0.998, 1.5, -1, Number.NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_SAFE_INTEGER]
    const junk = [undefined, null, '5', {}, [], true, 5n, 'random', 'human', '99.8%', Symbol('s')]
    const maybe = <T,>(good: T): unknown => (next() < 0.97 ? good : pick(junk))
    const some = (): number => (next() < 0.9 ? pick([0.5, 0.9, 0.998, 0, 1]) : pick(numbers))
    let results = 0
    let throws = 0
    for (let i = 0; i < 6000; i++) {
      const n = next() < 0.9 ? pick([20, 30, 31, 100, 1000, 1e12]) : pick(numbers)
      const raw = {
        claim: maybe({ metric: next() < 0.95 ? pick(['accuracy', 'error-rate']) : 'x', value: some(), display: next() < 0.5 ? undefined : pick(['99.8%', '98%', 'x', '50.5%']) }),
        sample: maybe({ n, correct: next() < 0.5 ? Math.floor(n * next()) : undefined, errors: next() < 0.5 ? Math.floor(n * next()) : undefined }),
        provenance: maybe({ source: next() < 0.95 ? pick(['human', 'model', 'mixed', 'unknown']) : 'x', raters: next() < 0.5 ? pick(numbers) : undefined }),
        sampling: maybe(next() < 0.97 ? pick(['random', 'stratified', 'ranked', 'convenience', 'unknown']) : 'x'),
        strata: next() < 0.8 ? undefined : maybe([{ name: pick(['a', 'b', '']), n: pick(numbers), correct: pick(numbers) }]),
        retractions: next() < 0.8 ? undefined : maybe({ count: pick(numbers), includedInSample: pick([true, false, 'y']) }),
      }
      try {
        const r = assessAccuracyClaim(raw as AccuracyClaimInput, { minN: pick([undefined, 1, 30, 0, 1e9]) })
        results += 1
        expect(['supported', 'overstated', 'contradicted', 'refused']).toContain(r.verdict)
        expect(r.reasons.length).toBeGreaterThan(0)
        expect(r.explanation).toHaveLength(r.reasons.length)
        expect(Number.isFinite(r.claimed) && Number.isFinite(r.n)).toBe(true)
        expect(r.suggestedStatement).not.toMatch(/NaN|Infinity|undefined|\[object/)
        if (r.verdict === 'refused') expect(r.interval).toBeNull()
        else expect((r.interval?.low as number) <= (r.interval?.high as number)).toBe(true)
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          throws += 1
          continue
        }
        throw error
      }
    }
    expect(results).toBeGreaterThan(300)
    expect(throws).toBeGreaterThan(300)
  })
})

describe('other realms and array proxies', () => {
  it('accepts an input built in another realm', () => {
    const foreign = vm.runInNewContext(`({
      claim: { metric: 'accuracy', value: 0.98 },
      sample: { n: 1030, correct: 990 },
      provenance: { source: 'human' },
      sampling: 'random',
      strata: [{ name: 'a', n: 1000, correct: 980 }, { name: 'b', n: 30, correct: 10 }],
    })`) as AccuracyClaimInput
    expect(assessAccuracyClaim(foreign).reasons).toEqual(['merged-strata-differ'])
  })

  it('reads kappa pairs from a foreign array and from an array Proxy once each', () => {
    const foreign = vm.runInNewContext(`[['a','a'],['a','b'],['b','b']]`) as [string, string][]
    expect(cohenKappa(foreign)).toMatchObject({ n: 3, agreements: 2 })
    const reads = new Map<string, number>()
    const proxied = new Proxy(
      [['a', 'a'], ['a', 'b'], ['b', 'b']] as [string, string][],
      {
        get(t, k, r) {
          reads.set(String(k), (reads.get(String(k)) ?? 0) + 1)
          return Reflect.get(t, k, r) as unknown
        },
      },
    )
    expect(cohenKappa(proxied)).toMatchObject({ n: 3 })
    expect(reads.get('length')).toBe(1)
    for (const k of ['0', '1', '2']) expect(reads.get(k)).toBe(1)
  })
})

describe('scales linearly on hostile sizes', () => {
  function cpuMs(work: () => void): number {
    const before = process.cpuUsage()
    work()
    const after = process.cpuUsage(before)
    return (after.user + after.system) / 1000
  }

  function best(work: () => void): number {
    work() // warm up
    return Math.min(cpuMs(work), cpuMs(work), cpuMs(work))
  }

  it('kappa, AC1 and percent agreement: 20k vs 80k pairs stay under 16x', () => {
    const make = (n: number): [string, string][] =>
      Array.from({ length: n }, (_, i) => [`c${i % 7}`, `c${(i * 3) % 5}`] as [string, string])
    const small = make(20_000)
    const big = make(80_000)
    const run = (p: [string, string][]) => (): void => {
      cohenKappa(p)
    }
    const t1 = Math.max(best(run(small)), 0.5)
    const t2 = best(run(big))
    expect(t2 / t1).toBeLessThan(16)
  })

  it('strata: 20k vs 80k strata stay under 16x', () => {
    const make = (k: number): AccuracyClaimInput =>
      input({
        claim: accuracy(0.5),
        sample: { n: 100 * k, correct: 95 * k },
        strata: Array.from({ length: k }, (_, i) => ({ name: `s${i}`, n: 100, correct: 95 })),
      })
    const small = make(20_000)
    const big = make(80_000)
    const t1 = Math.max(best(() => assessAccuracyClaim(small)), 0.5)
    const t2 = best(() => assessAccuracyClaim(big))
    expect(t2 / t1).toBeLessThan(16)
  })

  it('a 100k-character name or display is cut or rejected in constant time', () => {
    const long = 'a'.repeat(100_000)
    const r = assessAccuracyClaim(
      input({
        claim: accuracy(0.9),
        sample: { n: 1030, correct: 990 },
        strata: [
          { name: long, n: 1000, correct: 980 },
          { name: 'b', n: 30, correct: 10 },
        ],
      }),
    )
    expect(r.explanation[0]?.length).toBeLessThan(400)
  })
})

// ---- codex review round (07521bf): each block failed on that commit -------

const B: AccuracyClaimInput = {
  claim: { metric: 'accuracy', value: 0.98 },
  sample: { n: 1000, correct: 990 },
  provenance: { source: 'human' },
  sampling: 'random',
}

describe('a captured length is validated before any loop', () => {
  const lying = (length: unknown, element: unknown = ['a', 'a']): unknown[] =>
    new Proxy([] as unknown[], {
      get: (_t, k) => (k === 'length' ? length : element),
    })

  it('rejects Infinity, NaN, negative, fractional and oversized pair lengths quickly', () => {
    for (const length of [Infinity, Number.NaN, -1, 1.5, 2 ** 32, 1e9, '3', null]) {
      for (const f of [percentAgreement, cohenKappa, gwetAC1]) {
        expect(() => f(lying(length) as [string, string][]), `${String(length)}`).toThrow(
          length === '3' || length === null ? TypeError : RangeError,
        )
      }
    }
  })

  it('rejects a pair that claims a wrong length', () => {
    const pair = new Proxy(['a', 'a'], { get: (t, k) => (k === 'length' ? Infinity : Reflect.get(t, k) as unknown) })
    expect(() => percentAgreement([pair as unknown as [string, string]])).toThrow(RangeError)
  })

  it('rejects a bad strata length', () => {
    for (const length of [Infinity, Number.NaN, -1, 1.5, 1e9]) {
      const strata = lying(length, { name: 'a', n: 10, correct: 5 })
      expect(() => assessAccuracyClaim({ ...B, strata: strata as never })).toThrow(RangeError)
    }
  })

  it('still accepts real arrays and honest proxies', () => {
    expect(percentAgreement([['a', 'a']])).toMatchObject({ n: 1, value: 1 })
    const honest = new Proxy([['a', 'a'], ['a', 'b']] as [string, string][], {})
    expect(percentAgreement(honest)).toMatchObject({ n: 2, value: 0.5 })
  })
})

describe('the printed display is judged as well as the value', () => {
  it('"100%" over a 0.996 value on 1000/1000 is overstated, not supported', () => {
    const r = assessAccuracyClaim({
      ...B,
      claim: { metric: 'accuracy', value: 0.996, display: '100%' },
      sample: { n: 1000, correct: 1000 },
    })
    expect(r.verdict).toBe('overstated')
    expect(r.reasons).toEqual(['claim-beyond-conservative-bound'])
    expect(r.assessedValue).toBe(1)
    expect(r.claimed).toBe(0.996)
    expect(r.explanation[0]).toContain('printed figure')
  })

  it('"0%" over a 0.004 error rate with zero errors is overstated', () => {
    const r = assessAccuracyClaim({
      ...B,
      claim: { metric: 'error-rate', value: 0.004, display: '0%' },
      sample: { n: 1000, errors: 0 },
    })
    expect(r.verdict).toBe('overstated')
    expect(r.assessedValue).toBe(0)
  })

  it('a printed figure above the interval is contradicted even if the value is not', () => {
    const r = assessAccuracyClaim({
      ...B,
      claim: { metric: 'accuracy', value: 0.9949, display: '99%' },
      sample: { n: 1000, correct: 900 },
    })
    expect(r.verdict).toBe('contradicted')
  })

  it('uses the value when it is the more favorable of the two', () => {
    const r = assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 0.985, display: '98%' } })
    expect(r.assessedValue).toBe(0.985)
    expect(r.verdict).toBe('overstated')
  })

  it('leaves a consistent, honest claim supported', () => {
    const r = assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 0.98, display: '98%' } })
    expect(r.verdict).toBe('supported')
    expect(r.assessedValue).toBe(0.98)
  })

  it('still throws when value and display disagree by more than rounding', () => {
    expect(() => assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 0.9, display: '100%' } })).toThrow(RangeError)
  })

  it('without a display, assessedValue is the value', () => {
    expect(assessAccuracyClaim(B).assessedValue).toBe(0.98)
  })
})

describe('an undefined agreement statistic must be well formed and cannot pass a gate', () => {
  const prov = (agreement: unknown): AccuracyClaimInput['provenance'] =>
    ({ source: 'human', agreement }) as AccuracyClaimInput['provenance']

  it('throws unless an undefined statistic has value null', () => {
    for (const value of [Number.NaN, 0, 1, '0.5', {}, [], undefined, Infinity]) {
      expect(
        () => assessAccuracyClaim({ ...B, provenance: prov({ statistic: 'cohen-kappa', status: 'undefined', value }) }),
        `${typeof value}:${JSON.stringify(value) ?? 'undefined'}`,
      ).toThrow(/value/)
    }
  })

  it('a kit-made undefined result is accepted, and refused when a minimum is set', () => {
    const undef = cohenKappa([['a', 'a'], ['a', 'a']])
    expect(assessAccuracyClaim({ ...B, provenance: prov(undef) }).verdict).toBe('supported')
    const r = assessAccuracyClaim({ ...B, provenance: prov(undef) }, { minAgreement: 0.1 })
    expect(r.verdict).toBe('refused')
    expect(r.reasons).toEqual(['agreement-undefined'])
  })

  it('a defined statistic with a malformed value still throws', () => {
    for (const value of [Number.NaN, '0.5', null, {}]) {
      expect(() => assessAccuracyClaim({ ...B, provenance: prov({ statistic: 'gwet-ac1', value }) })).toThrow()
    }
  })
})

describe('formatted bounds never cross the bound', () => {
  it('n = 1e14 all correct does not print 100%', () => {
    const r = assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 0.5 }, sample: { n: 1e14, correct: 1e14 } })
    expect(r.suggestedStatement).not.toMatch(/^At least 100/)
    expect(r.suggestedStatement).toMatch(/^At least 99\.9999/)
    expect(r.interval?.low).toBeLessThan(1)
  })

  it('floors and ceils exactly, with no slack', () => {
    expect(pctFloor(0.9999999999999999, 4)).toBe('99.9999%')
    expect(pctCeil(1e-17, 2)).toBe('0.01%')
    expect(pctFloor(0.98, 0)).toBe('97%') // the double 0.98 is a hair below 98%
    expect(pctCeil(0.98, 0)).toBe('98%')
    expect(pctFloor(0.5, 0)).toBe('50%')
    expect(pctCeil(0.5, 3)).toBe('50.000%')
    expect(pctCeil(1, 2)).toBe('100.00%')
    expect(pctFloor(0, 3)).toBe('0.000%')
    expect(pctFloor(0.123456, 2)).toBe('12.34%')
    expect(pctCeil(0.123456, 2)).toBe('12.35%')
  })

  it('every explanation figure for a limit is rounded outward too', () => {
    const r = assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 0.998, display: '99.8%' }, sample: { n: 500, correct: 499 } })
    expect(r.explanation[0]).toContain('(98.875%)') // limit is 98.8759...%
  })
})

describe('confidence labels', () => {
  const label = (confidence: number): string => {
    const r = assessAccuracyClaim(B, { confidence })
    return /\((.*?) Wilson interval/.exec(r.suggestedStatement)?.[1] as string
  }

  it('never prints 100%', () => {
    expect(label(1 - Number.EPSILON / 2)).toBe('99.999999999%')
    expect(label(0.9999999999999999)).not.toBe('100%')
  })

  it('keeps ordinary levels tidy', () => {
    expect(label(0.95)).toBe('95%')
    expect(label(0.9)).toBe('90%')
    expect(label(0.99)).toBe('99%')
    expect(label(0.999)).toBe('99.9%')
    expect(label(0.57)).toBe('57%')
    expect(label(0.6827)).toBe('68.27%')
  })
})

// ---- final review round (e2c5be2) ------------------------------------------

describe('display agreement with the value is exact, with no tolerance', () => {
  const withDisplay = (value: number, display: string): AccuracyClaimInput => ({
    ...B,
    claim: { metric: 'accuracy', value, display },
  })

  it('rejects a display that is off by more than half a unit of its last digit, however slightly', () => {
    for (const display of ['98.00000000009%', '98.0000000001%', '97.9999999999%']) {
      expect(() => assessAccuracyClaim(withDisplay(0.98, display)), display).toThrow(RangeError)
    }
    // the same gap at a coarser digit is inside the allowance
    expect(assessAccuracyClaim(withDisplay(0.98, '98%')).verdict).toBe('supported')
    expect(() => assessAccuracyClaim(withDisplay(0.98, '98.0%'))).not.toThrow()
  })

  it('compares against the exact value of the double', () => {
    // the double nearest 0.985 is a hair below it, so "99%" is just over half a unit away
    expect(() => assessAccuracyClaim(withDisplay(0.985, '99%'))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(withDisplay(0.985, '98%'))).not.toThrow()
    // ...and the double nearest 0.9985 is a hair above it, so "99.8%" is just over half a unit away
    expect(() => assessAccuracyClaim(withDisplay(0.9985, '99.8%'))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(withDisplay(0.9985, '99.9%'))).not.toThrow()
  })
})

describe('a display must be a percent from 0 to 100, checked on its digits', () => {
  it('rejects anything above 100% or below 0%', () => {
    for (const display of [
      '100.00000000001%', '100.000000000000001%', '100.1%', '101%', '999%', '-0%', '-1%', '+5%', '-0.0%',
    ]) {
      const value = display.startsWith('100.0') ? 1 : 0.5
      expect(() => assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value, display } }), display).toThrow(RangeError)
    }
  })

  it('accepts exactly 100% and 0%, in any spelling of zeros', () => {
    for (const display of ['100%', '100.0%', '100.000000000000000%']) {
      const r = assessAccuracyClaim({ ...B, claim: { metric: 'accuracy', value: 1, display }, sample: { n: 1000, correct: 1000 } })
      expect(r.assessedValue).toBe(1)
    }
    const r = assessAccuracyClaim({ ...B, claim: { metric: 'error-rate', value: 0, display: '0.0%' }, sample: { n: 1000, errors: 0 } })
    expect(r.assessedValue).toBe(0)
  })
})

describe('a refusal reports the figure that would have been judged', () => {
  it('accuracy: value 0.996 printed as 100% gives assessedValue 1', () => {
    const r = assessAccuracyClaim({
      ...B,
      claim: { metric: 'accuracy', value: 0.996, display: '100%' },
      sampling: 'convenience',
    })
    expect(r.verdict).toBe('refused')
    expect(r.claimed).toBe(0.996)
    expect(r.assessedValue).toBe(1)
  })

  it('error rate: value 0.004 printed as 0% gives assessedValue 0', () => {
    const r = assessAccuracyClaim({
      ...B,
      claim: { metric: 'error-rate', value: 0.004, display: '0%' },
      provenance: { source: 'model' },
    })
    expect(r.verdict).toBe('refused')
    expect(r.assessedValue).toBe(0)
  })
})
