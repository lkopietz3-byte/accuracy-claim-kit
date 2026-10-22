import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AssessOptions } from '../src/index.js'

// Regression rows for the run 10 review. Every row name starts with the finding
// id it pins, so `vitest -t "run10:P2"` runs one finding.

const HUMAN = { provenance: { source: 'human' }, sampling: 'random' } as const

function acc(display: string, n: number, correct: number, options?: AssessOptions): AccuracyAssessment {
  return assessAccuracyClaim(
    { claim: { metric: 'accuracy', value: parseFloat(display) / 100, display }, sample: { n, correct }, ...HUMAN },
    options,
  )
}

function err(display: string, n: number, errors: number, options?: AssessOptions): AccuracyAssessment {
  return assessAccuracyClaim(
    { claim: { metric: 'error-rate', value: parseFloat(display.replace(/^[^\d]*/, '')) / 100, display }, sample: { n, errors }, ...HUMAN },
    options,
  )
}

/** The figures the first explanation tells the reader to print, read back out of its words. */
function advised(r: AccuracyAssessment): string[] {
  const text = r.explanation[0] as string
  const out: string[] = []
  const observed = /print the observed rate(?: \(([^)]+)\))?, or/.exec(text)
  if (observed !== null) {
    // without its own parentheses the advice points at the observed figure quoted earlier
    out.push(observed[1] ?? (/observed rate \(\d+ of \d+, ([\d.]+%)\)/.exec(text) as RegExpExecArray)[1] as string)
  }
  const bound = /go (?:down|up) to the (?:lower|upper) end \(([^)]+)\)/.exec(text)
  if (bound !== null) out.push(bound[1] as string)
  return out
}

const OPTION_SETS: readonly (readonly [string, AssessOptions | undefined])[] = [
  ['default', undefined],
  ['strictPrecision', { strictPrecision: true }],
  ['conservative', { conservative: true }],
  ['strictPrecision+conservative', { strictPrecision: true, conservative: true }],
]

describe('run10:P2 advice is only a figure the same assessment would pass', () => {
  it('run10:P2 499 of 500 claimed as 99% with strictPrecision does not advise 99.8%, which the same assessment rejects', () => {
    const r = acc('99%', 500, 499, { strictPrecision: true })
    expect(r.verdict).toBe('overstated')
    const text = r.explanation[0] as string
    expect(text).not.toContain('print the observed rate')
    expect(text).toContain('go down to the lower end (98%)')
    // the two figures a reader could reach for are both refused, so neither may be advised
    expect(acc('99.8%', 500, 499, { strictPrecision: true }).reasons).toContain('precision-too-fine')
    expect(acc('100%', 500, 499, { strictPrecision: true }).verdict).toBe('contradicted')
    // the advised figure passes
    expect(acc('98%', 500, 499, { strictPrecision: true }).verdict).toBe('supported')
  })

  it('run10:P2 the same counts under conservative never advise the observed rate and name the bound at whole percents', () => {
    const text = acc('99%', 500, 499, { conservative: true }).explanation[0] as string
    expect(text).not.toContain('print the observed rate')
    expect(text).toContain('go down to the lower end (98%)')
  })

  it('run10:P2 the default options still advise the observed rate for 499 of 500, where it is a pass', () => {
    const r = acc('99%', 500, 499)
    expect(r.explanation[0]).toContain('print the observed rate, or go down to the lower end (98.87%)')
    expect(acc('99.8%', 500, 499).verdict).toBe('supported')
  })

  it('run10:P2 with strictPrecision the observed rate is advised, with its figure, when an allowed display can match it', () => {
    const r = acc('99%', 1000, 996, { strictPrecision: true })
    expect(r.explanation[0]).toContain('print the observed rate (99.6%), or go down to the lower end (98.9%)')
    expect(acc('99.6%', 1000, 996, { strictPrecision: true }).verdict).toBe('supported')
  })

  it('run10:P2 a whole-percent tie keeps both neighbors as the observed rate, so 199 of 200 under strictPrecision advises the one that passes', () => {
    const r = acc('98%', 200, 199, { strictPrecision: true })
    for (const figure of advised(r)) {
      expect(acc(figure, 200, 199, { strictPrecision: true }).verdict, figure).toBe('supported')
    }
  })

  it('run10:P2 a point so near 100% that three decimals print 100.000% is spelled out with more digits in default mode, never as an absolute 100%', () => {
    const r = acc('99.9995%', 500000, 499999)
    expect(r.verdict).toBe('overstated')
    const figures = advised(r)
    expect(figures.length).toBe(2)
    for (const figure of figures) {
      expect(figure).not.toBe('100.000%')
      expect(acc(figure, 500000, 499999).verdict, figure).toBe('supported')
    }
  })

  it('run10:P2 sweep: every figure advised under any option set is a pass under that option set, higher and lower is better', () => {
    const sizes = [30, 50, 100, 200, 500, 1000, 5000, 100000]
    const failures: string[] = []
    let advisedCount = 0
    for (const [label, options] of OPTION_SETS) {
      for (const n of sizes) {
        for (const wrong of [0, 1, 2, 3, 5, Math.round(n * 0.02), Math.round(n * 0.1), n - 1, n - 2]) {
          if (wrong < 0 || wrong > n) continue
          for (const display of ['99%', '98%', '99.5%', '97.5%', '95%', '90%', '99.9%', '99.99%', '75%', '50%', '10%', '1%', '0.1%']) {
            const a = acc(display, n, n - wrong, options)
            for (const figure of a.verdict === 'overstated' && a.reasons.includes('claim-beyond-conservative-bound') ? advised(a) : []) {
              advisedCount += 1
              if (acc(figure, n, n - wrong, options).verdict !== 'supported') failures.push(`${label} accuracy ${display} ${String(n - wrong)}/${String(n)} advised ${figure}`)
            }
            const e = err(`about ${display}`, n, wrong, options)
            const e2 = err(`at most ${display}`, n, wrong, options)
            for (const r of [e, e2]) {
              for (const figure of r.verdict === 'overstated' && r.reasons.includes('claim-beyond-conservative-bound') ? advised(r) : []) {
                advisedCount += 1
                if (err(`at most ${figure}`, n, wrong, options).verdict !== 'supported' && err(figure, n, wrong, options).verdict !== 'supported') {
                  failures.push(`${label} error ${display} ${String(wrong)}/${String(n)} advised ${figure}`)
                }
              }
            }
          }
        }
      }
    }
    expect(advisedCount).toBeGreaterThan(100)
    expect(failures).toEqual([])
  })
})
