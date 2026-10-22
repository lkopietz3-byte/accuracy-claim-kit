import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim, wilsonInterval } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput, UnsupportedMetric } from '../src/index.js'

// Regression rows for the round 9 findings. Every row name starts with the
// finding id it pins, so `vitest -t "first5:F1"` runs one finding.

const HUMAN = { provenance: { source: 'human' }, sampling: 'random' } as const

function acc(value: number, display: string | undefined, n: number, correct: number, text?: string): AccuracyAssessment {
  return assessAccuracyClaim({
    claim: { metric: 'accuracy', value, ...(display === undefined ? {} : { display }), ...(text === undefined ? {} : { text }) },
    sample: { n, correct },
    ...HUMAN,
  })
}

function err(value: number, display: string, n: number, errors: number, text?: string): AccuracyAssessment {
  return assessAccuracyClaim({
    claim: { metric: 'error-rate', value, display, ...(text === undefined ? {} : { text }) },
    sample: { n, errors },
    ...HUMAN,
  })
}

function outcome(r: AccuracyAssessment): string {
  return `${r.verdict} [${r.reasons.join(', ')}]`
}

describe('first5:F1 an overstated figure below the observed rate says so', () => {
  it('first5:F1 996 of 1000 claimed as 99% is overstated, and the explanation says it is below the observed rate and what to print', () => {
    const r = acc(0.99, '99%', 1000, 996)
    expect(outcome(r)).toBe('overstated [claim-beyond-conservative-bound]')
    const text = r.explanation[0] as string
    expect(text).toContain('above its lower end')
    expect(text).toContain('below the observed rate (996 of 1000, 99.600%)')
    expect(text).toContain('print the observed rate, or go down to the lower end (98.')
  })

  it('first5:F1 the 990 of 1000 example: 98% and 99.0% pass, 98.5% is overstated with the below-observed explanation, 99.5% is contradicted', () => {
    expect(outcome(acc(0.98, '98%', 1000, 990))).toBe('supported [claim-within-bound]')
    expect(outcome(acc(0.99, '99.0%', 1000, 990))).toBe('supported [matches-observed-rate, precision-too-fine]')
    const middle = acc(0.985, '98.5%', 1000, 990)
    expect(middle.verdict).toBe('overstated')
    expect(middle.explanation[0]).toContain('below the observed rate (990 of 1000, 99.000%)')
    expect(outcome(acc(0.995, '99.5%', 1000, 990))).toContain('contradicted')
  })

  it('first5:F1 a figure above the observed rate keeps the old explanation with no below-observed sentence', () => {
    const r = acc(0.997, '99.7%', 1000, 996)
    expect(r.verdict).toBe('overstated')
    expect(r.explanation[0]).not.toContain('observed rate')
  })

  it('first5:F1 the advice never recommends a figure the same assessment rejects: an absolute observed rate, conservative mode, strict precision', () => {
    // 1000 of 1000 observed is 100%, which a sample can never show: only the lower end is offered
    const absolute = acc(0.998, '99.8%', 1000, 1000)
    expect(absolute.verdict).toBe('overstated')
    const absoluteText = absolute.explanation[0] as string
    expect(absoluteText).toContain('also below the observed rate (1000 of 1000, 100.000%)')
    expect(absoluteText).not.toContain('print the observed rate')
    expect(absoluteText).toContain('go down to the lower end (')
    // conservative mode accepts only a claim at or below the lower end, and prints it at the permitted precision
    const base: AccuracyClaimInput = {
      claim: { metric: 'accuracy', value: 0.99, display: '99%' },
      sample: { n: 1000, correct: 996 },
      ...HUMAN,
    }
    for (const options of [{ conservative: true }, { strictPrecision: true }] as const) {
      const r = assessAccuracyClaim(base, options)
      expect(r.verdict).toBe('overstated')
      const text = r.explanation[0] as string
      expect(text).toContain('go down to the lower end (98.9%)')
      if ('conservative' in options) expect(text).not.toContain('print the observed rate')
      // following the advice passes the same gate
      const followed = assessAccuracyClaim({ ...base, claim: { metric: 'accuracy', value: 0.989, display: '98.9%' } }, options)
      expect(followed.verdict).toBe('supported')
    }
    // the error-rate mirror offers the upper end at the permitted precision
    const mirror = assessAccuracyClaim(
      { claim: { metric: 'error-rate', value: 0.01, display: 'at most 1%' }, sample: { n: 1000, errors: 5 }, ...HUMAN },
      { strictPrecision: true },
    )
    expect(mirror.explanation[0]).toContain('go up to the upper end (1.2%)')
  })

  it('first5:F1 the error-rate mirror says the figure is above the observed rate: about 1 in 100 and at most 1% on 5 of 1000 errors', () => {
    for (const [value, display] of [[0.01, 'about 1 in 100'], [0.01, 'at most 1%']] as const) {
      const r = err(value, display, 1000, 5)
      expect(r.verdict, display).toBe('overstated')
      const text = r.explanation[0] as string
      expect(text, display).toContain('above the observed rate (5 of 1000, 0.500%)')
      expect(text, display).toContain('print the observed rate, or go up to the upper end (')
    }
  })
})

describe('first5:F2 the documented lower end is the figure the kit prints and accepts', () => {
  it('first5:F2 990 of 1000: 98.16%+ is supported, 98.17%+ is overstated, and the explanation prints 98.16%', () => {
    expect(acc(0.9816, '98.16%+', 1000, 990).verdict).toBe('supported')
    const r = acc(0.9817, '98.17%+', 1000, 990)
    expect(r.verdict).toBe('overstated')
    expect(r.explanation[0]).toContain('print the bound rounded down: 98.16%')
    expect(r.suggestedStatement).toContain('at least 98.16%')
  })
})

describe('first5:F4 the text-figure scan: the Arabic percent sign is read, the unread wordings are documented', () => {
  it('first5:F4 99.9٪ (Arabic percent sign) beside a 95% claim adds text-figure-differs, as 99.9% does', () => {
    for (const text of ['99.9% accurate', '99.9٪ accurate']) {
      expect(acc(0.95, '95%', 1000, 950, text).reasons, text).toContain('text-figure-differs')
    }
    expect(acc(0.95, '95%', 1000, 950, '95٪ accurate').reasons).not.toContain('text-figure-differs')
  })
})

describe('first5:F6 an exact rounding tie accepts both neighbors', () => {
  it('first5:F6 the ties the fuzz found: 42 errors in 48, 197 of 200, 120 of 128', () => {
    expect(err(0.875, '87%', 48, 42).verdict).toBe('supported')
    expect(err(0.875, '88%', 48, 42).verdict).toBe('supported')
    expect(acc(0.985, '98%', 200, 197).verdict).toBe('supported')
    expect(acc(0.985, '99%', 200, 197).verdict).toBe('supported')
    expect(acc(0.9375, '93.7%', 128, 120).verdict).toBe('supported')
    expect(acc(0.9375, '93.8%', 128, 120).verdict).toBe('supported')
    // one unit past the tie is not the observed rate
    expect(acc(0.939, '93.9%', 128, 120).verdict).not.toBe('supported')
  })
})

describe('first5:F7 first5:F8 TypeScript use', () => {
  it('first5:F8 UnsupportedMetric is importable from the package root and names what Claim.metric and the result carry', () => {
    const name: UnsupportedMetric = 'f1'
    const r = assessAccuracyClaim({
      claim: { metric: name, value: 0.9 },
      sample: { n: 1000, correct: 900 },
      ...HUMAN,
    })
    const echoed: AccuracyAssessment['metric'] = r.metric
    expect(echoed).toBe('f1')
    expect(r.verdict).toBe('refused')
  })
})

describe('hunt:R9-AC-01 all but one right at the largest sample sizes is contradicted at 100%', () => {
  const sizes = [2 ** 52, 2 ** 52 + 1, 4_503_599_627_370_497, 9_007_199_254_740_990, Number.MAX_SAFE_INTEGER]

  it('hunt:R9-AC-01 the upper limit with one failure stays below 1, and a claim of exactly 100% is contradicted', () => {
    for (const n of sizes) {
      expect(wilsonInterval(n - 1, n).high, String(n)).toBeLessThan(1)
      const r = acc(1, '100%', n, n - 1)
      expect(outcome(r), String(n)).toBe('contradicted [claim-outside-interval]')
      expect(r.explanation[0], String(n)).not.toContain('every item was right')
    }
  })

  it('hunt:R9-AC-01 the mirror error-rate claim of 0% with one error is contradicted, and the explanation says one item was wrong', () => {
    for (const n of sizes) {
      expect(outcome(err(0, '0%', n, 1)), String(n)).toBe('contradicted [claim-outside-interval]')
    }
    const r = acc(1, '100%', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)
    expect(r.explanation[0]).toContain('above the top of the 95% Wilson interval, which is just under 100% because not every item was counted right')
    expect(r.explanation[0]).not.toContain('(')
  })

  it('hunt:R9-AC-01 every item right is still overstated at 100%, and s = n still gives high exactly 1', () => {
    for (const n of sizes) {
      expect(wilsonInterval(n, n).high, String(n)).toBe(1)
      expect(outcome(acc(1, '100%', n, n)), String(n)).toBe('overstated [claim-beyond-conservative-bound]')
    }
    expect(acc(1, '100%', 500, 500).explanation[0]).toContain('even when every item was right (500 of 500)')
  })

  it('hunt:R9-AC-01 the interval keeps low <= point <= high below 1 for every failure count near the edge', () => {
    for (const n of sizes) {
      for (const failures of [1, 2, 3, 1000]) {
        const w = wilsonInterval(n - failures, n)
        expect(w.low, `${String(n)} ${String(failures)}`).toBeLessThanOrEqual(w.point)
        expect(w.point, `${String(n)} ${String(failures)}`).toBeLessThanOrEqual(w.high)
        expect(w.high, `${String(n)} ${String(failures)}`).toBeLessThan(1)
      }
    }
  })
})

describe('hunt:R9-AC-03 an approximate 100% or 0% in claim.text keeps its rounding band, and a plain one is absolute', () => {
  it('hunt:R9-AC-03 on the sample path 100% beside 99.6% is flagged, and about, ~, approximately, roughly and around 100% are the documented exemption', () => {
    expect(acc(0.996, '99.6%', 1000, 996, '100% accurate').reasons).toContain('text-figure-differs')
    for (const text of ['about 100% accurate', '~100% accurate', '≈100% accurate', 'approximately 100% accurate', 'roughly 100% accurate', 'around 100% accurate']) {
      expect(acc(0.996, '99.6%', 1000, 996, text).reasons, text).not.toContain('text-figure-differs')
    }
  })

  it('hunt:R9-AC-03 the error-rate mirror: 0% beside 0.4% is flagged, about 0% is the exemption, and either is fine at exactly 0', () => {
    expect(err(0.004, '0.4%', 1000, 4, '0% errors').reasons).toContain('text-figure-differs')
    expect(err(0.004, '0.4%', 1000, 4, 'about 0% errors').reasons).not.toContain('text-figure-differs')
    expect(err(0, '0%', 1000, 0, '0% errors').reasons).not.toContain('text-figure-differs')
    expect(err(0, '0%', 1000, 0, '~0% errors').reasons).not.toContain('text-figure-differs')
  })

  it('hunt:R9-AC-03 an approximate figure far from the value is still flagged', () => {
    expect(acc(0.996, '99.6%', 1000, 996, 'about 90% accurate').reasons).toContain('text-figure-differs')
  })
})
