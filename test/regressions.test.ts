import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput, AssessOptions } from '../src/index.js'
import { cohenKappa, gwetAC1, percentAgreement, wilsonInterval } from '../src/index.js'
import { foldText, mentionsName } from '../src/text.js'
import { confidenceLabel } from '../src/format.js'
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

function cpuMs(work: () => void): number {
  const before = process.cpuUsage()
  work()
  const after = process.cpuUsage(before)
  return (after.user + after.system) / 1000
}

function bestCpuMs(work: () => void, trials = 5): number {
  work() // warm up
  let best = Infinity
  for (let i = 0; i < trials; i++) best = Math.min(best, cpuMs(work))
  return best
}

/** A complete-set claim whose scope check runs mentionsName on `text` against `name`. */
function scoped(name: string, text: string, extra: Partial<AccuracyClaimInput> = {}): AccuracyClaimInput {
  return census({ metric: 'accuracy', value: 0.799, display: '79.9%', text }, { n: 50_000, correct: 39_950 }, name, extra)
}

describe('false-pass:F5 typographic quotes and dashes fold before name matching', () => {
  const cases: [string, string, string][] = [
    ["Humanity's Last Exam", 'Scores 79.9% on Humanity’s Last Exam', 'right single quote in the text'],
    ['Humanity’s Last Exam', "Scores 79.9% on Humanity's Last Exam", 'right single quote in the name'],
    ["Humanity's Last Exam", 'Scores 79.9% on Humanity‘s Last Exam', 'left single quote'],
    ["Humanity's Last Exam", 'Scores 79.9% on Humanity‛s Last Exam', 'single high-reversed-9 quote'],
    ["Humanity's Last Exam", 'Scores 79.9% on Humanity′s Last Exam', 'prime'],
    ["Humanity's Last Exam", 'Scores 79.9% on Humanityʼs Last Exam', 'modifier letter apostrophe'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR–10', 'en dash'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR—10', 'em dash'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR‐10', 'hyphen U+2010'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR‑10', 'non-breaking hyphen'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR‒10', 'figure dash'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR―10', 'horizontal bar'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR−10', 'minus sign'],
    ['CIFAR-10', 'Scores 79.9% on CIFAR－10', 'full-width hyphen-minus'],
    ['CIFAR–10', 'Scores 79.9% on CIFAR-10', 'en dash in the name'],
    ['ImageNet', 'Scores 79.9% on Image­Net', 'soft hyphen inside the word'],
    ['The "Hard" Set', 'Scores 79.9% on The “Hard” Set', 'curly double quotes'],
  ]
  for (const [name, text, what] of cases) {
    it(`false-pass:F5 ${what}: the claim names the benchmark`, () => {
      const r = assessAccuracyClaim(scoped(name, text))
      expect(outcome(r)).toBe('supported [census-matches-count]')
    })
  }

  it('false-pass:F5 foldText maps the variants to ASCII and drops the soft hyphen', () => {
    expect(foldText('‘a’ “b”')).toBe("'a' \"b\"")
    expect(foldText('a‐b‑c‒d–e—f―g−h')).toBe('a-b-c-d-e-f-g-h')
    expect(foldText('co­operate')).toBe('cooperate')
  })

  it('false-pass:F5 a name that is really different is still not found', () => {
    expect(assessAccuracyClaim(scoped('CIFAR-10', 'Scores 79.9% on CIFAR–00')).reasons).toEqual(['claim-not-scoped-to-benchmark'])
  })

  it('false-pass:F5 population identifiers fold the same way', () => {
    const r = assessAccuracyClaim({
      claim: { metric: 'accuracy', value: 0.98 },
      sample: { n: 1000, correct: 990 },
      provenance: { source: 'human' },
      sampling: 'random',
      population: { claimed: 'adults’ notes', evaluated: "adults' notes" },
    })
    expect(r.verdict).toBe('supported')
  })
})

describe('false-pass:F3 a longer name that starts with the declared name is not the declared name', () => {
  it('false-pass:F3 MMLU vs MMLU-Pro, HumanEval vs HumanEval+, ImageNet vs ImageNet-V2 are refused', () => {
    for (const [name, text] of [
      ['MMLU', 'Scores 79.9% on MMLU-Pro'],
      ['HumanEval', 'Scores 79.9% on HumanEval+'],
      ['HumanEval', 'Scores 79.9% on HumanEval++'],
      ['ImageNet', 'Scores 79.9% on ImageNet-V2'],
      ['SWE-bench', 'Resolves 79.9% of SWE-bench-Lite'],
      ['MMLU', 'Scores 79.9% on MMLU_pro'],
      ['MMLU', 'Scores 79.9% on MMLU/pro'],
      ['MMLU', 'Scores 79.9% on MMLU.pro'],
      ['CIFAR-10', 'Scores 79.9% on CIFAR-10.2'],
      ['CIFAR-10', 'Scores 79.9% on CIFAR-10-C'],
      ['MMLU', 'Scores 79.9% on MMLU–Pro'],
    ] as const) {
      const r = assessAccuracyClaim(scoped(name, text))
      expect(outcome(r), `${name} / ${text}`).toBe('refused [claim-not-scoped-to-benchmark]')
    }
  })

  it('false-pass:F3 the same joiner or a plus before the name is a different name too', () => {
    for (const [name, text] of [
      ['HumanEval', 'Scores 79.9% on mini-HumanEval'],
      ['MMLU', 'Scores 79.9% on multi_MMLU'],
      ['MMLU', 'Scores 79.9% on cais/MMLU'],
    ] as const) {
      expect(assessAccuracyClaim(scoped(name, text)).reasons, `${name} / ${text}`).toEqual(['claim-not-scoped-to-benchmark'])
    }
  })

  it('false-pass:F3 clean endings stay clean: a period, comma, bracket or end of text', () => {
    for (const [name, text] of [
      ['CIFAR-10', 'Scores 79.9% on CIFAR-10.'],
      ['MMLU', 'Scores 79.9% on MMLU, a broad exam'],
      ['MMLU', 'Scores 79.9% on (MMLU)'],
      ['MMLU', 'Scores 79.9% on MMLU: five-shot'],
      ['MMLU', 'Scores 79.9% on MMLU.'],
      ['MMLU', 'On MMLU. Scores 79.9%'],
      ['MMLU', 'Scores 79.9% on MMLU - five-shot'],
      ['MMLU', 'Scores 79.9% on MMLU-'],
      ['HumanEval+', 'Scores 79.9% on HumanEval+'],
      ['HumanEval+', 'Scores 79.9% on HumanEval+.'],
      ['MMLU', 'Scores 79.9% on the MMLU set'],
    ] as const) {
      expect(outcome(assessAccuracyClaim(scoped(name, text))), `${name} / ${text}`).toBe('supported [census-matches-count]')
    }
  })

  it('false-pass:F3 a later occurrence that is clean still counts', () => {
    expect(mentionsName('MMLU-Pro is harder than MMLU, which we score 79.9% on', 'MMLU')).toBe(true)
    expect(mentionsName('MMLU-Pro and MMLU+ and HumanEval', 'MMLU')).toBe(false)
  })

  it('false-pass:F3 documented limit: a suffix after a space cannot be detected', () => {
    // README: declare the full name ("SWE-bench Verified") when the set is a named variant.
    expect(assessAccuracyClaim(scoped('SWE-bench', 'Resolves 79.9% of SWE-bench Verified')).verdict).toBe('supported')
    expect(assessAccuracyClaim(scoped('SWE-bench Verified', 'Resolves 79.9% of SWE-bench')).reasons).toEqual(['claim-not-scoped-to-benchmark'])
  })

  it('false-pass:F3 surrogate pairs next to a match are one character', () => {
    // a letter outside the BMP (U+1D400 mathematical bold A normalizes to "a" under NFKC), emoji and an astral letter
    expect(mentionsName('x \u{1F600}MMLU\u{1F600} y', 'MMLU')).toBe(true)
    expect(mentionsName('x \u{10400}MMLU y', 'MMLU')).toBe(false) // Deseret letter before: part of a word
    expect(mentionsName('x MMLU\u{10400} y', 'MMLU')).toBe(false)
    expect(mentionsName('x MMLU\uD800 y', 'MMLU')).toBe(true) // a lone surrogate is not a letter
  })
})

describe('hostile:F1 and codex:CX-1 the name matcher is linear in the claim text', () => {
  const heavy = (length: number): AccuracyClaimInput =>
    census({ metric: 'accuracy', value: 0.9, text: 'ﷺ'.repeat(length) }, { n: 1000, correct: 900 }, 'ل')

  it('hostile:F1 codex:CX-1 U+FDFA x 2000 against the name U+0644 is refused in well under a second of CPU', () => {
    const input = heavy(2000)
    let r: AccuracyAssessment | undefined
    const ms = bestCpuMs(() => {
      r = assessAccuracyClaim(input)
    }, 3)
    expect(r?.reasons).toEqual(['claim-not-scoped-to-benchmark'])
    expect(ms).toBeLessThan(250) // 3,800 ms before the fix; about 1 ms after
  })

  it('hostile:F1 codex:CX-1 CPU time grows less than 6x for 4x the text (500, 1000, 2000 characters)', () => {
    // fail fast, before the repeated loops, if one call is already slow
    expect(cpuMs(() => assessAccuracyClaim(heavy(2000)))).toBeLessThan(250)
    const time = (length: number): number => {
      const input = heavy(length)
      return bestCpuMs(() => {
        for (let i = 0; i < 10; i++) assessAccuracyClaim(input)
      }, 4)
    }
    const t500 = Math.max(time(500), 2)
    const t1000 = time(1000)
    const t2000 = time(2000)
    expect(t2000 / t500).toBeLessThan(6)
    expect(t1000 / t500).toBeLessThan(6)
  })

  it('hostile:F1 a text full of matches that are all rejected is linear too', () => {
    const run = (reps: number) => (): void => {
      mentionsName('ab'.repeat(reps), 'b')
    }
    const t1 = Math.max(bestCpuMs(run(5000)), 0.5)
    const t2 = bestCpuMs(run(20_000))
    expect(t2 / t1).toBeLessThan(6)
  })
})

describe('hostile:F3 a benchmark name needs a letter or a digit', () => {
  it('hostile:F3 ".", "%", U+200B, "  -  " and a lone surrogate are rejected', () => {
    for (const name of ['.', '%', '​', '  -  ', '\uDE00', '---', '()', '​‍']) {
      expect(() => assessAccuracyClaim(scoped(name, `Our system is 90% accurate ${name}`)), JSON.stringify(name)).toThrow(RangeError)
    }
  })

  it('hostile:F3 population identifiers need one too', () => {
    const withScope = (claimed: string, evaluated: string): AccuracyClaimInput => ({
      claim: { metric: 'accuracy', value: 0.98 },
      sample: { n: 1000, correct: 990 },
      provenance: { source: 'human' },
      sampling: 'random',
      population: { claimed, evaluated },
    })
    expect(() => assessAccuracyClaim(withScope('.', '.'))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(withScope('​', '​'))).toThrow(RangeError)
    expect(assessAccuracyClaim(withScope('adults', 'adults')).verdict).toBe('supported')
  })

  it('hostile:F3 real names behave as before, including digits, punctuation and other scripts', () => {
    for (const name of ['MyBench', '2048', 'C++ tests', 'テスト', 'x']) {
      expect(outcome(assessAccuracyClaim(scoped(name, `Scores 79.9% on ${name}`))), name).toBe('supported [census-matches-count]')
    }
    expect(assessAccuracyClaim(scoped('MyBench', 'Our system is 79.9% accurate')).reasons).toEqual(['claim-not-scoped-to-benchmark'])
  })
})

describe('hostile:F2 label and stratum-name length is capped', () => {
  const long = (length: number, i: number): string => 'x'.repeat(length - 8) + String(i).padStart(8, '0')

  it('hostile:F2 a label over 1000 characters throws RangeError in percentAgreement, cohenKappa and gwetAC1', () => {
    const pairs = (length: number): [string, string][] => [[long(length, 1), long(length, 1)], ['a', 'b']]
    for (const fn of [percentAgreement, cohenKappa, gwetAC1]) {
      expect(() => fn(pairs(1001))).toThrow(RangeError)
      expect(() => fn(pairs(1001))).toThrow(/1000/)
      expect(() => fn(pairs(1000))).not.toThrow()
    }
    expect(() => percentAgreement([['a', long(1001, 2)]])).toThrow(RangeError)
  })

  it('hostile:F2 2000 labels of 20000 characters are rejected at the first one, in under 10 ms', () => {
    const labels = Array.from({ length: 2000 }, (_, i) => long(20_000, i))
    const pairsList = labels.map((s): [string, string] => [s, s])
    const ms = bestCpuMs(() => {
      try {
        percentAgreement(pairsList)
      } catch {
        /* expected */
      }
    })
    expect(() => percentAgreement(pairsList)).toThrow(RangeError)
    expect(ms).toBeLessThan(10)
  })

  it('hostile:F2 a stratum name over 1000 characters throws RangeError, 20000-character names at k = 2000 in under 10 ms', () => {
    const strataOf = (length: number, k: number): { name: string; n: number; correct: number }[] =>
      Array.from({ length: k }, (_, i) => ({ name: long(length, i), n: 100, correct: 90 }))
    const make = (length: number, k: number): AccuracyClaimInput =>
      sampled(
        { metric: 'accuracy', value: 0.5 },
        { n: 100 * k, correct: 90 * k },
        { sampling: 'stratified', strata: strataOf(length, k) },
      )
    expect(() => assessAccuracyClaim(make(1001, 2))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(make(1001, 2))).toThrow(/1000/)
    expect(() => assessAccuracyClaim(make(1000, 2))).not.toThrow()
    const hostile = make(20_000, 2000)
    const ms = bestCpuMs(() => {
      try {
        assessAccuracyClaim(hostile)
      } catch {
        /* expected */
      }
    })
    expect(() => assessAccuracyClaim(hostile)).toThrow(RangeError)
    expect(ms).toBeLessThan(10)
  })

  it('hostile:F2 numbers and booleans are labels of no length; strings at the cap are still fine', () => {
    expect(percentAgreement([[1, 1], [true, false]]).status).toBe('defined')
    expect(percentAgreement([['x'.repeat(1000), 'x'.repeat(1000)]]).status).toBe('defined')
  })
})

describe('hostile:F4 false-pass:F7 docs-release:D1 an unknown key throws instead of switching a gate off', () => {
  const honest = (): AccuracyClaimInput => ({
    claim: { metric: 'accuracy', value: 0.998, display: '99.8%' },
    sample: { n: 500, correct: 499 },
    provenance: { source: 'human' },
    sampling: 'random',
  })
  const withKey = (key: string, value: unknown): AccuracyClaimInput => ({ ...honest(), [key]: value })
  const retractions = { count: 3, includedInSample: false }

  // [what it is, call, the key reported, the nearest valid key (or null)]
  const typos: [string, () => unknown, string, string | null][] = [
    ['input.retraction', () => assessAccuracyClaim(withKey('retraction', retractions)), 'retraction', 'retractions'],
    ['input.retractons (D1)', () => assessAccuracyClaim(withKey('retractons', retractions)), 'retractons', 'retractions'],
    ['input.populations', () => assessAccuracyClaim(withKey('populations', { claimed: 'a', evaluated: 'b' })), 'populations', 'population'],
    ['input.sampleing', () => assessAccuracyClaim({ ...honest(), sampling: undefined, sampleing: 'x' } as unknown as AccuracyClaimInput), 'sampleing', 'sampling'],
    ['input.scope', () => assessAccuracyClaim(withKey('scope', { claimed: 'a', evaluated: 'b' })), 'scope', null],
    ['input.stratum', () => assessAccuracyClaim(withKey('stratum', [{ name: 'a', n: 500, correct: 499 }])), 'stratum', 'strata'],
    ['input.evaluatedat', () => assessAccuracyClaim(withKey('evaluatedat', '2020-01-01')), 'evaluatedat', 'evaluatedAt'],
    ['options.maxAgeDay', () => assessAccuracyClaim(honest(), { maxAgeDay: 30, now: '2026-10-12' } as AssessOptions), 'maxAgeDay', 'maxAgeDays'],
    ['options.maxAge', () => assessAccuracyClaim(honest(), { maxAge: 30, now: '2026-10-12' } as AssessOptions), 'maxAge', 'maxAgeDays'],
    ['options.minAgreemnt', () => assessAccuracyClaim(honest(), { minAgreemnt: 0.8 } as AssessOptions), 'minAgreemnt', 'minAgreement'],
    ['options.min_agreement', () => assessAccuracyClaim(honest(), { min_agreement: 0.8 } as AssessOptions), 'min_agreement', 'minAgreement'],
    ['options.minn', () => assessAccuracyClaim(honest(), { minn: 5000 } as AssessOptions), 'minn', 'minN'],
    ['options.min_n', () => assessAccuracyClaim(honest(), { min_n: 5000 } as AssessOptions), 'min_n', 'minN'],
    ['options.requireScoped', () => assessAccuracyClaim(honest(), { requireScoped: true } as AssessOptions), 'requireScoped', 'requireScope'],
    ['options.conservativ', () => assessAccuracyClaim(honest(), { conservativ: true } as AssessOptions), 'conservativ', 'conservative'],
    ['options.strictPrecison (D1)', () => assessAccuracyClaim(honest(), { strictPrecison: true } as AssessOptions), 'strictPrecison', 'strictPrecision'],
    ['options.confidnce', () => assessAccuracyClaim(honest(), { confidnce: 0.9 } as AssessOptions), 'confidnce', 'confidence'],
    ['claim.interval', () => assessAccuracyClaim({ ...honest(), claim: { ...honest().claim, interval: [0.999, 1] } as AccuracyClaimInput['claim'] }), 'interval', null],
    ['claim.dispaly', () => assessAccuracyClaim({ ...honest(), claim: { metric: 'accuracy', value: 0.998, dispaly: '99.8%' } as unknown as AccuracyClaimInput['claim'] }), 'dispaly', 'display'],
    ['sample.total', () => assessAccuracyClaim({ ...honest(), sample: { n: 500, correct: 499, total: 100_000 } as AccuracyClaimInput['sample'] }), 'total', null],
    ['sample.errros', () => assessAccuracyClaim({ ...honest(), sample: { n: 500, correct: 499, errros: 1 } as AccuracyClaimInput['sample'] }), 'errros', 'errors'],
    ['provenance.rater', () => assessAccuracyClaim({ ...honest(), provenance: { source: 'human', rater: 2 } as AccuracyClaimInput['provenance'] }), 'rater', 'raters'],
    ['provenance.agrement', () => assessAccuracyClaim({ ...honest(), provenance: { source: 'human', agrement: { statistic: 'cohen-kappa', value: 0.1 } } as AccuracyClaimInput['provenance'] }), 'agrement', 'agreement'],
    ['provenance.agreement.valu', () => assessAccuracyClaim({ ...honest(), provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', valu: 0.1 } } as unknown as AccuracyClaimInput['provenance'] }), 'valu', 'value'],
    ['retractions.included', () => assessAccuracyClaim(withKey('retractions', { count: 22, included: false })), 'included', 'includedInSample'],
    ['retractions.includedInSampel', () => assessAccuracyClaim(withKey('retractions', { count: 22, includedInSample: false, includedInSampel: true })), 'includedInSampel', 'includedInSample'],
    ['benchmark.title', () => assessAccuracyClaim({ ...honest(), sampling: 'complete', benchmark: { name: 'Foo', title: 'x' } as AccuracyClaimInput['benchmark'] }), 'title', null],
    ['population.claim', () => assessAccuracyClaim(withKey('population', { claim: 'a', claimed: 'a', evaluated: 'a' })), 'claim', 'claimed'],
    ['strata[1].corect', () => assessAccuracyClaim({ ...honest(), sampling: 'stratified', strata: [{ name: 'a', n: 250, correct: 250 }, { name: 'b', n: 250, correct: 249, corect: 1 }] as unknown as AccuracyClaimInput['strata'] }), 'corect', 'correct'],
    ['wilsonInterval confidnce (D1)', () => wilsonInterval(5, 10, { confidnce: 0.99 } as never), 'confidnce', 'confidence'],
    ['gwetAC1 catagories (D1)', () => gwetAC1([['a', 'a'], ['a', 'b']], { catagories: 5 } as never), 'catagories', 'categories'],
  ]
  for (const [what, call, key, nearest] of typos) {
    it(`hostile:F4 ${what} throws a TypeError naming the key${nearest === null ? '' : ' and the nearest valid key'}`, () => {
      let error: unknown
      try {
        call()
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(TypeError)
      const message = (error as TypeError).message
      expect(message).toContain(`"${key}"`)
      if (nearest !== null) expect(message).toContain(`did you mean "${nearest}"`)
      else expect(message).not.toContain('did you mean')
      expect(message).toMatch(/Allowed keys: /)
    })
  }

  it('hostile:F4 every key the kit does read is still accepted, including its own results as agreement input', () => {
    const kappa = cohenKappa([['a', 'a'], ['b', 'b'], ['a', 'b'], ['a', 'a']])
    const full: AccuracyClaimInput = {
      claim: { metric: 'accuracy', value: 0.99, display: '99%', text: 'On Foo set' },
      sample: { n: 1000, correct: 990, errors: 10 },
      provenance: { source: 'human', raters: 2, agreement: kappa },
      sampling: 'stratified',
      strata: [{ name: 'a', n: 600, correct: 594, errors: 6 }, { name: 'b', n: 400, correct: 396, errors: 4 }],
      retractions: { count: 1, includedInSample: true },
      population: { claimed: 'x', evaluated: 'x' },
      evaluatedAt: '2026-10-01',
    }
    const options: AssessOptions = { confidence: 0.9, minN: 30, minAgreement: 0.1, maxAgeDays: 90, now: '2026-10-12', strictPrecision: false, conservative: false, requireScope: true }
    expect(() => assessAccuracyClaim(full, options)).not.toThrow()
    const bench = census({ metric: 'accuracy', value: 0.99 }, { n: 1000, correct: 990 })
    expect(() => assessAccuracyClaim(bench)).not.toThrow()
    expect(() => wilsonInterval(5, 10, { confidence: 0.9 })).not.toThrow()
    expect(() => gwetAC1([['a', 'b']], { categories: 3 })).not.toThrow()
    expect(() => assessAccuracyClaim(full, {})).not.toThrow()
  })

  it('hostile:F4 undefined values for a known key and symbol or non-enumerable keys are not unknown keys', () => {
    const base = {
      claim: { metric: 'accuracy', value: 0.98, display: undefined, text: undefined },
      sample: { n: 1000, correct: 990, errors: undefined },
      provenance: { source: 'human', raters: undefined, agreement: undefined },
      sampling: 'random',
      strata: undefined,
      retractions: undefined,
      benchmark: undefined,
      population: undefined,
      evaluatedAt: undefined,
    } as AccuracyClaimInput
    Object.defineProperty(base, 'hidden', { value: 1, enumerable: false })
    Object.defineProperty(base, Symbol('s'), { value: 1, enumerable: true })
    expect(assessAccuracyClaim(base, { confidence: undefined, minN: undefined, minAgreement: undefined, maxAgeDays: undefined, now: undefined }).verdict).toBe('supported')
  })

  it('hostile:F4 a very long unknown key is cut in the message and costs no suggestion search', () => {
    const key = 'k'.repeat(100_000)
    let error: unknown
    try {
      assessAccuracyClaim(withKey(key, 1))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message.length).toBeLessThan(400)
    expect(cpuMs(() => { try { assessAccuracyClaim(withKey(key, 1)) } catch { /* expected */ } })).toBeLessThan(20)
  })

  it('hostile:F4 a result lists which gates ran', () => {
    const none = assessAccuracyClaim(honest())
    expect(none.checks).toEqual({ retractions: 'not-supplied', scope: 'not-supplied', age: 'not-supplied', agreement: 'not-supplied', strata: 'not-supplied' })
    const all = assessAccuracyClaim(
      {
        ...honest(),
        sampling: 'stratified',
        strata: [{ name: 'a', n: 250, correct: 250 }, { name: 'b', n: 250, correct: 249 }],
        retractions: { count: 0, includedInSample: true },
        population: { claimed: 'x', evaluated: 'x' },
        evaluatedAt: '2026-10-01',
        provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: 0.9 } },
      },
      { maxAgeDays: 30, now: '2026-10-12', minAgreement: 0.5 },
    )
    expect(all.checks).toEqual({ retractions: 'applied', scope: 'applied', age: 'applied', agreement: 'applied', strata: 'applied' })
    // a statistic that is only echoed, or an evaluation date with no maximum age, is not a gate
    const echoed = assessAccuracyClaim({ ...honest(), evaluatedAt: '2026-10-01', provenance: { source: 'human', agreement: { statistic: 'cohen-kappa', value: 0.9 } } })
    expect(echoed.checks.age).toBe('not-supplied')
    expect(echoed.checks.agreement).toBe('not-supplied')
  })

  it('hostile:F4 refused and complete-set results carry the checks too', () => {
    const refused = assessAccuracyClaim({ ...honest(), provenance: { source: 'model' }, retractions: { count: 1, includedInSample: true } })
    expect(refused.verdict).toBe('refused')
    expect(refused.checks.retractions).toBe('applied')
    const set = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.99 }, { n: 1000, correct: 990 }, 'Foo set', { population: { claimed: 'x', evaluated: 'x' } }))
    expect(set.basis).toBe('census')
    expect(set.checks.scope).toBe('applied')
    expect(set.checks.strata).toBe('not-supplied')
  })
})

// Used by later groups in this file.
export type { AssessOptions }

describe('hostile:F5 an assessment confidence below one half is rejected', () => {
  const claim875 = (): AccuracyClaimInput => sampled({ metric: 'accuracy', value: 0.875 }, { n: 1000, correct: 880 })

  it('hostile:F5 confidence 0.05 (alpha typed for 0.95) throws RangeError instead of flipping overstated to supported', () => {
    expect(assessAccuracyClaim(claim875()).verdict).toBe('overstated')
    for (const confidence of [0.05, 0.0001, 1e-9, 0.4999999999999999]) {
      expect(() => assessAccuracyClaim(claim875(), { confidence }), String(confidence)).toThrow(RangeError)
    }
  })

  it('hostile:F5 the message names the option and the floor', () => {
    expect(() => assessAccuracyClaim(claim875(), { confidence: 0.05 })).toThrow(/options\.confidence.*0\.5/)
  })

  it('hostile:F5 one half and above are still accepted, and wilsonInterval keeps its full range', () => {
    for (const confidence of [0.5, 0.57, 0.68, 0.9, 0.95, 0.999, 0.9999999]) {
      expect(() => assessAccuracyClaim(claim875(), { confidence }), String(confidence)).not.toThrow()
    }
    expect(wilsonInterval(5, 10, { confidence: 0.05 }).z).toBeGreaterThan(0)
    expect(wilsonInterval(5, 10, { confidence: 1e-9 }).low).toBeLessThanOrEqual(0.5)
  })
})

describe('false-pass:F6 an agreement statistic computed on too few items cannot carry a sample', () => {
  const sixPairs: [string, string][] = [['a', 'a'], ['b', 'b'], ['a', 'a'], ['b', 'b'], ['a', 'a'], ['b', 'b']]
  const big = (agreement: unknown, extra: Record<string, unknown> = {}): AccuracyClaimInput =>
    sampled({ metric: 'accuracy', value: 0.95, display: '95%' }, { n: 10_000, correct: 9500 }, {
      provenance: { source: 'human', raters: 2, agreement } as AccuracyClaimInput['provenance'],
      ...extra,
    })

  it('false-pass:F6 AC1 of 6 pairs clears minAgreement 0.8 on a 10,000-item sample: now refused', () => {
    const agreement = gwetAC1(sixPairs, { categories: 2 })
    expect(agreement).toMatchObject({ status: 'defined', value: 1, n: 6 })
    const r = assessAccuracyClaim(big(agreement), { minAgreement: 0.8 })
    expect(outcome(r)).toBe('refused [agreement-sample-too-small]')
    expect(r.interval).toBeNull()
    expect(r.explanation[0]).toContain('6 items')
    expect(r.explanation[0]).toContain('30')
  })

  it('false-pass:F6 percent agreement and kappa on a handful of pairs are refused the same way', () => {
    for (const agreement of [percentAgreement(sixPairs.slice(0, 3)), cohenKappa(sixPairs), gwetAC1(sixPairs)]) {
      const r = assessAccuracyClaim(big(agreement), { minAgreement: 0.5 })
      expect(outcome(r), String(agreement.statistic)).toBe('refused [agreement-sample-too-small]')
    }
  })

  it('false-pass:F6 the size is judged against options.minN, so a larger minimum refuses a larger statistic', () => {
    const pairs = Array.from({ length: 60 }, (_, i): [string, string] => (i % 2 === 0 ? ['a', 'a'] : ['b', 'b']))
    const agreement = cohenKappa(pairs)
    expect(outcome(assessAccuracyClaim(big(agreement), { minAgreement: 0.8 }))).toBe('supported [matches-observed-rate]')
    expect(outcome(assessAccuracyClaim(big(agreement), { minAgreement: 0.8, minN: 100 }))).toBe('refused [agreement-sample-too-small]')
    // exactly minN items is enough
    expect(outcome(assessAccuracyClaim(big(agreement), { minAgreement: 0.8, minN: 60 }))).toBe('supported [matches-observed-rate]')
  })

  it('false-pass:F6 a small agreement is refused even when no minimum agreement is set (it would be quoted in the statement)', () => {
    const r = assessAccuracyClaim(big(gwetAC1(sixPairs, { categories: 2 })))
    expect(outcome(r)).toBe('refused [agreement-sample-too-small]')
    expect(r.checks.agreement).toBe('applied')
  })

  it('false-pass:F6 it is listed beside the other failed preconditions, and an undefined statistic keeps its own reason', () => {
    const r = assessAccuracyClaim(big(gwetAC1(sixPairs, { categories: 2 }), { sampling: 'convenience' }), { minAgreement: 0.8 })
    expect(r.reasons).toEqual(['convenience-sample', 'agreement-sample-too-small'])
    const undef = cohenKappa([['a', 'a'], ['a', 'a']])
    expect(assessAccuracyClaim(big(undef), { minAgreement: 0.5 }).reasons).toEqual(['agreement-undefined'])
  })

  it('false-pass:F6 a hand-written {statistic, value} with no n is trusted, as documented', () => {
    const r = assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9 }), { minAgreement: 0.8 })
    expect(outcome(r)).toBe('supported [matches-observed-rate]')
    expect(r.checks.agreement).toBe('applied')
    // with no gate and no n, nothing was checked
    expect(assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9 })).checks.agreement).toBe('not-supplied')
  })

  it('false-pass:F6 a hand-written n is read: whole number, 0 or more', () => {
    expect(outcome(assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: 12 }), { minAgreement: 0.8 }))).toBe('refused [agreement-sample-too-small]')
    expect(outcome(assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: 0 }), { minAgreement: 0.8 }))).toBe('refused [agreement-sample-too-small]')
    expect(outcome(assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: 400 }), { minAgreement: 0.8 }))).toBe('supported [matches-observed-rate]')
    expect(() => assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: -1 }))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: 2.5 }))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(big({ statistic: 'cohen-kappa', value: 0.9, n: '400' }))).toThrow(TypeError)
  })

  it('false-pass:F6 raters below 2 with an agreement statistic is inconsistent input and throws', () => {
    const agreement = { statistic: 'cohen-kappa', value: 0.9 }
    const withRaters = (raters: number): AccuracyClaimInput => sampled(
      { metric: 'accuracy', value: 0.95, display: '95%' }, { n: 10_000, correct: 9500 },
      { provenance: { source: 'human', raters, agreement } as AccuracyClaimInput['provenance'] },
    )
    expect(() => assessAccuracyClaim(withRaters(1), { minAgreement: 0.8 })).toThrow(RangeError)
    expect(() => assessAccuracyClaim(withRaters(1))).toThrow(/provenance\.raters.*agreement/)
    expect(() => assessAccuracyClaim(withRaters(0))).toThrow(RangeError)
    expect(outcome(assessAccuracyClaim(withRaters(2), { minAgreement: 0.8 }))).toBe('supported [matches-observed-rate]')
    expect(outcome(assessAccuracyClaim(withRaters(5), { minAgreement: 0.8 }))).toBe('supported [matches-observed-rate]')
    // raters: 1 with no agreement block is still fine: one person labeled it
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.95, display: '95%' }, { n: 10_000, correct: 9500 }, { provenance: { source: 'human', raters: 1 } })))).toBe('supported [matches-observed-rate]')
  })
})

describe('false-pass:F9 docs-release:D2 the suggested statement leads with its scope and says it covers sampling error only', () => {
  const lead = /^On this sample( of .+?)?, at (?:least|most) /
  const honest = (extra: Partial<AccuracyClaimInput> = {}, claim: AccuracyClaimInput['claim'] = { metric: 'accuracy', value: 0.998, display: '99.8%' }): AccuracyAssessment =>
    assessAccuracyClaim(sampled(claim, { n: 500, correct: 499 }, extra))

  it('false-pass:F9 docs-release:D2 the worked example reads as a statement about the sample', () => {
    expect(honest().suggestedStatement).toBe(
      'On this sample, at least 98.87% accurate (95% Wilson interval 98.87% to 99.97%, n = 500, human labels, random sample); the interval covers sampling error only; print it as a whole percent',
    )
  })

  it('false-pass:F9 docs-release:D2 every judged metric and sampling method gets the lead and the caveat', () => {
    const metrics: [AccuracyClaimInput['claim'], 'least' | 'most'][] = [
      [{ metric: 'accuracy', value: 0.99 }, 'least'],
      [{ metric: 'precision', value: 0.99 }, 'least'],
      [{ metric: 'recall', value: 0.99 }, 'least'],
      [{ metric: 'error-rate', value: 0.02 }, 'most'],
      [{ metric: 'false-positive-rate', value: 0.02 }, 'most'],
      [{ metric: 'false-negative-rate', value: 0.02 }, 'most'],
    ]
    for (const [claim, word] of metrics) {
      for (const sampling of ['random', 'cross-validation'] as const) {
        const r = assessAccuracyClaim(sampled(claim, { n: 1000, correct: 980, errors: 20 }, { sampling }))
        expect(r.suggestedStatement, `${claim.metric} ${sampling}`).toMatch(lead)
        expect(r.suggestedStatement).toContain(`, at ${word} `)
        expect(r.suggestedStatement).toContain('sampling error only')
      }
    }
    const strata = [{ name: 'a', n: 500, correct: 490 }, { name: 'b', n: 500, correct: 490 }]
    const stratified = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.98 }, { n: 1000, correct: 980 }, { sampling: 'stratified', strata }))
    expect(stratified.suggestedStatement).toMatch(lead)
    expect(stratified.suggestedStatement).toContain('sampling error only')
  })

  it('false-pass:F9 the evaluated population is named when it is declared', () => {
    const r = honest({ population: { claimed: 'English tweets', evaluated: 'English tweets' } }, { metric: 'accuracy', value: 0.998 })
    expect(r.suggestedStatement).toMatch(/^On this sample of English tweets, at least 98\.\d+% accurate \(/)
    expect(honest({ population: { claimed: 'ENGLISH  tweets', evaluated: 'English Tweets' } }).suggestedStatement).toMatch(/^On this sample of English Tweets, at least /)
    expect(honest().suggestedStatement.startsWith('On this sample, at least')).toBe(true)
  })

  it('false-pass:F9 a cross-validation estimate says the interval is optimistic, and a random sample does not', () => {
    const cv = honest({ sampling: 'cross-validation' })
    expect(cv.suggestedStatement).toContain('cross-validation estimate')
    expect(cv.suggestedStatement).toContain('optimistic')
    expect(honest().suggestedStatement).not.toContain('optimistic')
  })

  it('false-pass:F9 the statement never opens with a bare figure, and a refusal still gives no figure', () => {
    expect(honest().suggestedStatement).not.toMatch(/^At (least|most)/)
    expect(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.99 }, { n: 1000, correct: 990 }, { sampling: 'convenience' })).suggestedStatement).not.toMatch(/\d/)
  })

  it('false-pass:F9 a complete set already scopes itself and is unchanged', () => {
    const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.799, display: '79.9%' }, { n: 50_000, correct: 39_950 }, 'Ridgeview validation set'))
    expect(r.suggestedStatement).toBe('39950 of 50000 correct on Ridgeview validation set (complete set, human labels): 79.90% accuracy. This describes that set only; it is not an estimate for other data')
  })
})

describe('false-pass:F4 a figure in claim.text that differs from the figure judged is flagged, never judged', () => {
  const setCensus = (
    text: string,
    over: Partial<AccuracyClaimInput['claim']> = {},
    sample: AccuracyClaimInput['sample'] = { n: 50_000, correct: 39_950 },
  ): AccuracyAssessment =>
    assessAccuracyClaim(census({ metric: 'accuracy', value: 0.799, display: '79.9%', text, ...over }, sample, 'Foo set'))

  it('false-pass:F4 the three audit texts: 99.9% and "perfect" are flagged, the matching sentence is clean', () => {
    const high = setCensus('Reaches 99.9% accuracy on the Foo set')
    expect(outcome(high)).toBe('supported [census-matches-count, text-figure-differs]')
    expect(high.explanation[1]).toContain('99.9%')
    expect(high.explanation[1]).toContain('79.9')
    expect(high.explanation[1]).toMatch(/text/)
    expect(outcome(setCensus('Perfect accuracy on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    const clean = setCensus('Reaches 79.9% accuracy on the Foo set')
    expect(outcome(clean)).toBe('supported [census-matches-count]')
    expect(setCensus('Reaches 99.9% accuracy on the Foo set').suggestedStatement).toBe(clean.suggestedStatement)
  })

  it('false-pass:F4 the verdict is whatever it was: a contradicted claim stays contradicted and still gets the flag', () => {
    const r = setCensus('Reaches 99.9% accuracy on the Foo set', { value: 0.81, display: '81%' })
    expect(outcome(r)).toBe('contradicted [claim-differs-from-count, text-figure-differs]')
  })

  it('false-pass:F4 the sample path flags it too', () => {
    const base = (text: string): AccuracyAssessment =>
      assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.99, display: '99%', text }, { n: 1000, correct: 990 }))
    expect(outcome(base('Our model is 99% accurate'))).toBe('supported [matches-observed-rate]')
    expect(outcome(base('Our model is 99.9% accurate'))).toBe('supported [matches-observed-rate, text-figure-differs]')
    expect(outcome(base('99% accurate, 100% reliable'))).toBe('supported [matches-observed-rate, text-figure-differs]')
  })

  it('false-pass:F4 a rounding of the value is the same figure, finer digits than the value are not', () => {
    expect(outcome(setCensus('80% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('79.9000% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('79.95% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(setCensus('about 80% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('79-81% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('85-90% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
  })

  it('false-pass:F4 "percent" and "per cent" are the percent sign', () => {
    expect(outcome(setCensus('79.9 percent on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('99.9 percent on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(setCensus('99.9 per cent on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(setCensus('99.9 pct on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
  })

  it('false-pass:F4 a bound in the text is read as a bound against the value', () => {
    expect(outcome(setCensus('at least 75% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('over 70% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('79%+ on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(setCensus('at least 85% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(setCensus('over 79.9% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(setCensus('85%+ on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    // a bound pointing the wrong way for the metric cannot be read as one, so it is not judged either way
    expect(outcome(setCensus('at most 5% on the Foo set'))).toBe('supported [census-matches-count]')
  })

  it('false-pass:F4 the complement is the same fact: an error-rate claim may quote its accuracy', () => {
    const r = assessAccuracyClaim(census(
      { metric: 'error-rate', value: 0.1229, display: '12.29%', text: 'Resolves 87.71% on Foo set; fails 12.29% of Foo set' },
      { n: 10_000, errors: 1229 }, 'Foo set'))
    expect(outcome(r)).toBe('supported [census-matches-count]')
    const off = assessAssessErr('Resolves 90% on Foo set; fails 12.29% of Foo set')
    expect(outcome(off)).toBe('supported [census-matches-count, text-figure-differs]')
    function assessAssessErr(text: string): AccuracyAssessment {
      return assessAccuracyClaim(census({ metric: 'error-rate', value: 0.1229, display: '12.29%', text }, { n: 10_000, errors: 1229 }, 'Foo set'))
    }
  })

  it('false-pass:F4 absolute wording is a 100% (or 0% error) claim', () => {
    const exact = (text: string, metric: 'accuracy' | 'error-rate', value: number): string => {
      const claim = { metric, value, display: metric === 'accuracy' ? '100%' : '0%', text }
      return outcome(assessAccuracyClaim(census(claim, metric === 'accuracy' ? { n: 200, correct: 200 } : { n: 200, errors: 0 }, 'Foo set')))
    }
    for (const word of ['perfect', 'flawless', 'error-free', 'no errors', 'zero errors']) {
      expect(exact(`${word} on the Foo set`, 'accuracy', 1), word).toBe('supported [census-matches-count]')
      expect(exact(`${word} on the Foo set`, 'error-rate', 0), word).toBe('supported [census-matches-count]')
    }
    expect(outcome(setCensus('an imperfect score on the Foo set'))).toBe('supported [census-matches-count]')
  })

  it('review:P2 a printed 100% or 0% in the text is absolute, never excused as the rounding of 99.6% or 0.4%', () => {
    // 9,960 of 10,000 correct: "100% accurate" must be flagged like the word "perfect" and like display "100%"
    const acc = (text: string): string => outcome(setCensus(text, { value: 0.996, display: undefined }, { n: 10_000, correct: 9_960 }))
    for (const text of ['100% accurate on Foo set', '100 percent accurate on Foo set', '100.0% accurate on Foo set', 'perfect on Foo set', 'at least 100% on Foo set']) {
      expect(acc(text), text).toBe('supported [census-matches-count, text-figure-differs]')
    }
    // the mirror: 40 errors in 10,000 must flag "0% errors"
    const err = (text: string): string =>
      outcome(assessAccuracyClaim(census({ metric: 'error-rate', value: 0.004, text }, { n: 10_000, errors: 40 }, 'Foo set')))
    for (const text of ['0% errors on Foo set', '0.0% errors on Foo set', 'zero errors on Foo set', 'at most 0% on Foo set']) {
      expect(err(text), text).toBe('supported [census-matches-count, text-figure-differs]')
    }
    // the sample path flags it too
    const sample = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.996, text: '100% accurate' }, { n: 10_000, correct: 9_960 }))
    expect(sample.reasons).toContain('text-figure-differs')
    const sampleErr = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.004, text: '0% errors' }, { n: 10_000, errors: 40 }))
    expect(sampleErr.reasons).toContain('text-figure-differs')
  })

  it('review:P2 the endpoint rule leaves honest figures alone: exact 100% or 0%, the complement, an approximate figure and a range', () => {
    const exactAcc = (text: string): string => outcome(setCensus(text, { value: 1, display: '100%' }, { n: 200, correct: 200 }))
    expect(exactAcc('100% accurate on Foo set')).toBe('supported [census-matches-count]')
    expect(exactAcc('0% errors on Foo set')).toBe('supported [census-matches-count]')
    const exactErr = (text: string): string =>
      outcome(assessAccuracyClaim(census({ metric: 'error-rate', value: 0, display: '0%', text }, { n: 200, errors: 0 }, 'Foo set')))
    expect(exactErr('0% errors, 100% accurate on Foo set')).toBe('supported [census-matches-count]')
    // a value computed as 1 sits within noise of 100%
    expect(outcome(setCensus('100% accurate on Foo set', { value: 1 - 2 ** -52, display: '100%' }, { n: 200, correct: 200 }))).toBe('supported [census-matches-count]')
    // an approximate or ranged figure at the end keeps its band
    const near = (text: string): string => outcome(setCensus(text, { value: 0.996, display: undefined }, { n: 10_000, correct: 9_960 }))
    expect(near('about 100% accurate on Foo set')).toBe('supported [census-matches-count]')
    expect(near('99-100% accurate on Foo set')).toBe('supported [census-matches-count]')
    expect(near('at least 99% accurate on Foo set')).toBe('supported [census-matches-count]')
    expect(near('99.6% accurate on Foo set')).toBe('supported [census-matches-count]')
  })

  it('false-pass:F4 a refusal reports only its failed preconditions', () => {
    const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.799, display: '79.9%', text: 'Reaches 99.9% on the Foo set' }, { n: 50_000, correct: 39_950 }, 'Foo set', { provenance: { source: 'model' } }))
    expect(r.reasons).toEqual(['no-human-labels'])
  })

  it('false-pass:F4 the flag is listed once however many figures differ, and the text scan is linear', () => {
    const many = setCensus('99.9% 98.9% 97.9% 96.9% on the Foo set')
    expect(many.reasons).toEqual(['census-matches-count', 'text-figure-differs'])
    const cpu = (copies: number): number => {
      const text = `${'99.9% '.repeat(copies)}on the Foo set`
      const t0 = process.cpuUsage()
      setCensus(text)
      const t = process.cpuUsage(t0)
      return t.user + t.system
    }
    cpu(10)
    const small = Math.max(cpu(100), 1000)
    const big = cpu(300)
    expect(big / small).toBeLessThan(12)
  })
})

describe('false-pass:F2 "1 in N" is exact unless it is written as approximate', () => {
  const oneIn = (display: string, value: number, n: number, errors: number, extra: Partial<AccuracyClaimInput> = {}): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'error-rate', value, display }, { n, errors }, extra))

  it('false-pass:F2 "1 in 100" with 1500 of 100000 (a true 1.5%) is contradicted, "about 1 in 100" with the same counts is supported', () => {
    expect(outcome(oneIn('1 in 100', 0.01, 100_000, 1500))).toBe('contradicted [claim-outside-interval]')
    expect(outcome(oneIn('about 1 in 100', 0.01, 100_000, 1500))).toBe('supported [matches-observed-rate]')
  })

  it('false-pass:F2 the other audit cases: 20 of 1000 and 200 of 1000 no longer pass as 1 in 100 and 1 in 10', () => {
    expect(outcome(oneIn('1 in 100', 0.01, 1000, 20)).startsWith('contradicted')).toBe(true)
    expect(outcome(oneIn('1 in 10', 0.1, 1000, 200)).startsWith('contradicted')).toBe(true)
    expect(outcome(oneIn('about 1 in 10', 0.1, 1000, 100))).toBe('supported [matches-observed-rate]')
    // the audit control: 2.5% was always contradicted
    expect(outcome(oneIn('1 in 100', 0.01, 100_000, 2500)).startsWith('contradicted')).toBe(true)
  })

  it('false-pass:F2 N is exact to the half: the observed 1.0% is "1 in 100", 1.2% is overstated, and the band is 1/100.5 to 1/99.5', () => {
    expect(outcome(oneIn('1 in 100', 0.01, 1000, 10))).toBe('supported [matches-observed-rate]')
    expect(oneIn('1 in 100', 0.01, 1000, 12).verdict).toBe('overstated')
    // 995 / 100000 = 1 / 100.5025 is just outside the exact band; 2010 / 200000 = 1 / 99.5025 is inside, 2011 / 200000 is outside
    expect(oneIn('1 in 100', 0.01, 100_000, 995).verdict).not.toBe('supported')
    expect(oneIn('1 in 100', 0.01, 100_000, 1000).verdict).toBe('supported')
    expect(oneIn('1 in 100', 0.01, 200_000, 2010).verdict).toBe('supported')
    expect(oneIn('1 in 100', 0.01, 200_000, 2011).verdict).not.toBe('supported')
  })

  it('false-pass:F2 every approximate prefix restores the placeholder band, spelled any of these ways', () => {
    for (const display of ['about 1 in 100', 'around 1 in 100', 'roughly 1 in 100', 'approximately 1 in 100', 'approx 1 in 100', 'approx. 1 in 100', '~1 in 100', '~ 1 in 100', '≈1 in 100', 'About 1 in 100']) {
      expect(outcome(oneIn(display, 0.01, 100_000, 1500)), display).toBe('supported [matches-observed-rate]')
      expect(oneIn(display, 0.01, 100_000, 3000).verdict, display).toBe('contradicted')
    }
  })

  it('false-pass:F2 the explanation names the band that was applied', () => {
    const exact = oneIn('1 in 100', 0.01, 100_000, 1500)
    expect(exact.explanation[0]).toContain('"1 in 100" is read as exactly 1 in 100')
    expect(exact.explanation[0]).toContain('about 1 in 100')
    const approx = oneIn('about 1 in 100', 0.01, 100_000, 1500)
    expect(approx.explanation[0]).toContain('"about 1 in 100" is read as 1 in 50 to 1 in 150')
    // N with no trailing zeros has no placeholder band either way
    expect(oneIn('about 1 in 7', 1 / 7, 1000, 143).explanation[0]).toContain('1 in 6.5 to 1 in 7.5')
  })

  it('false-pass:F2 the complete-set path uses the same exact band', () => {
    const set = (display: string, errors: number): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'error-rate', value: 0.01, display }, { n: 100_000, errors }, 'Foo set'))
    expect(outcome(set('1 in 100', 1000))).toBe('supported [census-matches-count]')
    expect(outcome(set('1 in 100', 1500))).toBe('contradicted [claim-differs-from-count]')
    expect(outcome(set('about 1 in 100', 1500))).toBe('supported [census-matches-count]')
    expect(set('1 in 100', 1500).explanation[0]).toContain('does not match')
  })

  it('false-pass:F2 the value must sit in the band the display is read at', () => {
    // exact: 1 in 100 with value 0.015 used to pass as a placeholder band; now it is a display that disagrees with its value
    expect(() => oneIn('1 in 100', 0.015, 1000, 15)).toThrow(RangeError)
    expect(outcome(oneIn('about 1 in 100', 0.015, 1000, 15))).toBe('supported [matches-observed-rate]')
  })

  it('false-pass:F2 "1 in N" in claim.text is read the same way for the text flag', () => {
    const text = (t: string): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'error-rate', value: 0.01, display: '1%', text: t }, { n: 100_000, errors: 1000 }, 'Foo set'))
    expect(outcome(text('about 1 in 100 on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(text('1 in 100 on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(text('1 in 50 on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(text('about 1 in 50 on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
  })
})

describe('false-pass:F8 a stratified result says its pooled interval is not reweighted', () => {
  const strat = (claim: AccuracyClaimInput['claim']): AccuracyClaimInput => sampled(
    claim, { n: 350, correct: 343 },
    { sampling: 'stratified', strata: [{ name: 'A', n: 300, correct: 297 }, { name: 'B', n: 50, correct: 46 }] },
  )

  it('false-pass:F8 the audit case (A is 10% of the population, B is 90%, claim 98%) carries the reason and the statement says unweighted pooled', () => {
    const r = assessAccuracyClaim(strat({ metric: 'accuracy', value: 0.98, display: '98%' }))
    expect(r.verdict).toBe('supported')
    expect(r.reasons).toEqual(['matches-observed-rate', 'strata-not-reweighted'])
    expect(r.explanation[1]).toContain('not reweighted')
    expect(r.explanation[1]).toContain('population')
    expect(r.suggestedStatement).toContain('stratified sample, unweighted pooled')
    expect(r.suggestedStatement).toMatch(/^On this sample, at least /)
  })

  it('false-pass:F8 the reason never changes the verdict, whichever it is', () => {
    const verdicts = (['overstated', 'contradicted', 'supported'] as const).map((expected) => {
      const value = expected === 'contradicted' ? 0.995 : expected === 'overstated' ? 0.985 : 0.9
      const r = assessAccuracyClaim(strat({ metric: 'accuracy', value }))
      expect(r.reasons).toContain('strata-not-reweighted')
      return r.verdict
    })
    expect(verdicts).toEqual(['overstated', 'contradicted', 'supported'])
  })

  it('false-pass:F8 error rates and every other sampling method are unaffected except stratified', () => {
    const err = assessAccuracyClaim(sampled(
      { metric: 'error-rate', value: 0.02 }, { n: 350, errors: 7 },
      { sampling: 'stratified', strata: [{ name: 'A', n: 300, errors: 5 }, { name: 'B', n: 50, errors: 2 }] }))
    expect(err.reasons).toContain('strata-not-reweighted')
    for (const sampling of ['random', 'cross-validation'] as const) {
      const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9 }, { n: 350, correct: 343 }, { sampling }))
      expect(r.reasons, sampling).not.toContain('strata-not-reweighted')
      expect(r.suggestedStatement, sampling).not.toContain('unweighted')
    }
  })

  it('false-pass:F8 a refusal keeps only its failed preconditions', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.98 }, { n: 350, correct: 343 }, { sampling: 'stratified' }))
    expect(r.reasons).toEqual(['stratified-without-strata'])
  })
})

describe('field:F2 specificity, NPV and the diagnostic agreement names are metrics, and the statement uses the claimant\'s word', () => {
  // [metric, the metric it is judged as, the words the statement uses]
  const names: [string, 'accuracy' | 'precision' | 'recall', string][] = [
    ['specificity', 'accuracy', 'specificity'],
    ['npv', 'accuracy', 'negative predictive value'],
    ['sensitivity', 'recall', 'sensitivity'],
    ['npa', 'accuracy', 'negative percent agreement'],
    ['ppa', 'recall', 'positive percent agreement'],
    ['ppv', 'precision', 'positive predictive value'],
    ['opa', 'accuracy', 'overall percent agreement'],
  ]
  const claimOf = (metric: string, value: number, display: string): AccuracyClaimInput['claim'] =>
    ({ metric, value, display }) as AccuracyClaimInput['claim']

  it('field:F2 "Negative Agreement 82.7% (755/913)" as specificity says specificity, not accurate', () => {
    const r = assessAccuracyClaim(sampled(claimOf('specificity', 0.827, '82.7%'), { n: 913, correct: 755 }))
    expect(outcome(r)).toBe('supported [matches-observed-rate, precision-too-fine]')
    expect(r.metric).toBe('specificity')
    expect(r.suggestedStatement).toMatch(/^On this sample, at least 80\.10% specificity \(/)
    expect(r.suggestedStatement).not.toMatch(/accurate/)
  })

  it('field:F2 each name is judged exactly like the metric it stands for, and says its own words', () => {
    const cases: [number, string, number, number][] = [
      [0.827, '82.7%', 913, 755], [0.9, '90%', 1000, 940], [0.99, '99%', 1000, 990], [0.95, '95%', 400, 360],
      [0.997, '99.7%', 5000, 4985], [1, '100%', 290, 290], [0.5, '50%', 40, 30],
    ]
    for (const [metric, as, words] of names) {
      for (const [value, display, n, correct] of cases) {
        const named = assessAccuracyClaim(sampled(claimOf(metric, value, display), { n, correct }))
        const base = assessAccuracyClaim(sampled({ metric: as, value, display }, { n, correct }))
        expect(outcome(named), `${metric} ${display}`).toBe(outcome(base))
        expect(named.interval, `${metric} ${display}`).toEqual(base.interval)
        expect(named.metric).toBe(metric)
        if (named.verdict !== 'refused') {
          expect(named.suggestedStatement, metric).toMatch(new RegExp(`^On this sample, at least [\\d.]+% ${words} \\(`))
          expect(named.suggestedStatement).not.toContain('accurate')
        }
      }
    }
  })

  it('field:F2 errors work in place of correct, and a complete set says the name too', () => {
    const r = assessAccuracyClaim(sampled(claimOf('specificity', 0.827, '82.7%'), { n: 913, errors: 158 }))
    expect(outcome(r)).toBe('supported [matches-observed-rate, precision-too-fine]')
    const set = assessAccuracyClaim(census(claimOf('npv', 0.827, '82.7%'), { n: 913, correct: 755 }, 'Foo set'))
    expect(set.verdict).toBe('supported')
    expect(set.suggestedStatement).toContain('82.7% negative predictive value')
    expect(set.suggestedStatement).not.toContain('accuracy')
  })

  it('field:F2 they are higher-is-better: a floor fits, a ceiling throws', () => {
    expect(assessAccuracyClaim(sampled(claimOf('specificity', 0.9, 'at least 90%'), { n: 1000, correct: 940 })).verdict).toBe('supported')
    expect(() => assessAccuracyClaim(sampled(claimOf('specificity', 0.1, 'under 10%'), { n: 1000, correct: 940 }))).toThrow(RangeError)
  })

  it('field:F2 names the kit does not know still throw, and the message lists the metrics it judges', () => {
    for (const metric of ['tnr', 'f-score', 'sensitivty', 'specificity ']) {
      expect(() => assessAccuracyClaim(sampled(claimOf(metric, 0.9, '90%'), { n: 1000, correct: 900 })), metric).toThrow(RangeError)
    }
    expect(() => assessAccuracyClaim(sampled(claimOf('sensitivty', 0.9, '90%'), { n: 1000, correct: 900 }))).toThrow(/sensitivity/)
  })

  it('field:F2 refusals still say the metric as written', () => {
    const r = assessAccuracyClaim(sampled(claimOf('specificity', 0.9, '90%'), { n: 1000, correct: 900 }, { provenance: { source: 'model' } }))
    expect(r.suggestedStatement).toBe('No specificity figure can be supported from this evidence: the labels were not checked by people.')
  })
})

describe('hostile:F8 control and bidirectional characters in an echoed string throw', () => {
  const bad = ['\u0000', '\n', '\r', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']
  const codes = (c: string): string => `U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`

  const named = (benchmark: string, text = `Scores 79.9% on ${benchmark}`): AccuracyClaimInput =>
    census({ metric: 'accuracy', value: 0.799, display: '79.9%', text }, { n: 50_000, correct: 39_950 }, benchmark)
  const scoped = (claimed: string, evaluated: string): AccuracyClaimInput =>
    sampled({ metric: 'accuracy', value: 0.98 }, { n: 1000, correct: 990 }, { population: { claimed, evaluated } })
  const withText = (text: string): AccuracyClaimInput => sampled({ metric: 'accuracy', value: 0.98, text }, { n: 1000, correct: 990 })
  const withStratum = (name: string): AccuracyClaimInput => sampled(
    { metric: 'accuracy', value: 0.98 }, { n: 1000, correct: 990 },
    { sampling: 'stratified', strata: [{ name, n: 500, correct: 495 }, { name: 'other', n: 500, correct: 495 }] },
  )

  it('hostile:F8 the audit repro (override, newlines, a NUL and markup in a benchmark name) throws RangeError', () => {
    const name = 'Bench\u202e\n\n**Verdict: all clear**\u0000<script>x</script>'
    expect(() => assessAccuracyClaim(named(name))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(scoped('adults\n\u202eFINE', 'kids'))).toThrow(RangeError)
  })

  it('hostile:F8 every one of them is rejected in benchmark.name, population.claimed, population.evaluated, claim.text and a stratum name', () => {
    for (const c of bad) {
      expect(() => assessAccuracyClaim(named(`Foo${c}set`)), `benchmark ${codes(c)}`).toThrow(RangeError)
      expect(() => assessAccuracyClaim(named('Foo set', `Scores 79.9% on Foo set${c}`)), `text ${codes(c)}`).toThrow(RangeError)
      expect(() => assessAccuracyClaim(scoped(`adults${c}`, 'adults')), `claimed ${codes(c)}`).toThrow(RangeError)
      expect(() => assessAccuracyClaim(scoped('adults', `${c}adults`)), `evaluated ${codes(c)}`).toThrow(RangeError)
      expect(() => assessAccuracyClaim(withText(`98% accurate${c}`)), `sample text ${codes(c)}`).toThrow(RangeError)
      expect(() => assessAccuracyClaim(withStratum(`a${c}b`)), `stratum ${codes(c)}`).toThrow(RangeError)
    }
  })

  it('hostile:F8 text is rejected whatever the metric or sampling (a refusal would echo nothing, but the input is still malformed)', () => {
    expect(() => assessAccuracyClaim(sampled({ metric: 'f1', value: 0.9, text: 'x\u202ey' }, { n: 100, correct: 90 }))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text: 'x\ny' }, { n: 100, correct: 90 }, { sampling: 'ranked' }))).toThrow(RangeError)
  })

  it('hostile:F8 the message names the field and the character, not the string', () => {
    let error: unknown
    try {
      assessAccuracyClaim(scoped('adults\u202e', 'adults'))
    } catch (e) {
      error = e
    }
    const message = (error as RangeError).message
    expect(message).toContain('population.claimed')
    expect(message).toContain('U+202E')
    expect(message).toContain('position 6')
    expect(message).not.toContain('\u202e')
  })

  it('hostile:F8 a horizontal tab is spacing, not a control that can hide anything, and is allowed', () => {
    expect(assessAccuracyClaim(scoped('adults\tkids', 'adults\tkids')).verdict).toBe('supported')
  })

  it('hostile:F8 ordinary text is unchanged: other scripts, punctuation, emoji, no-break and ideographic spaces, joiners and direction marks', () => {
    for (const name of ['Ridgeview validation set', 'テスト', 'C++ tests', 'café \u2019s', 'Foo\u00a0set', 'Foo\u3000set', '😀 set', 'a\u200db set', 'בדיקה\u200f set']) {
      expect(outcome(assessAccuracyClaim(named(name))), name).toBe('supported [census-matches-count]')
    }
    expect(assessAccuracyClaim(withText('98% accurate, measured on 1,000 items')).verdict).toBe('supported')
    expect(assessAccuracyClaim(scoped('English tweets', 'english  tweets')).verdict).toBe('supported')
  })

  it('hostile:F8 a display with line breaks is read as the figure it is and never echoed raw', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.01, display: 'about\n1 in\u2028100' }, { n: 100_000, errors: 1500 }))
    expect(r.explanation.join('\n')).not.toMatch(/[\n\u2028]/)
    expect(r.explanation[0]).toContain('"about 1 in 100" is read as 1 in 50 to 1 in 150')
  })
})

describe('hostile:F12 docs-release:D5 false-pass:F12 the metric and display messages say what to do', () => {
  const withMetric = (metric: unknown): AccuracyClaimInput => sampled({ metric, value: 0.9 } as AccuracyClaimInput['claim'], { n: 100, correct: 90 })

  it('hostile:F12 docs-release:D5 an unknown metric lists the judged names, then the refused ones, with no sentence fragment', () => {
    let error: unknown
    try {
      assessAccuracyClaim(withMetric('foo'))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(RangeError)
    const message = (error as RangeError).message
    expect(message).toBe(
      'claim.metric must be one of accuracy, error-rate, precision, recall, false-positive-rate, false-negative-rate, specificity, npv, sensitivity, ppa, ppv, npa, opa, or one of f1, auc, roc-auc, wer, cer, bleu, rouge, map, composite, other (which the kit knows and refuses, in any case); got "foo"',
    )
    expect(message).not.toMatch(/claim\.metric \(or/)
  })

  it('hostile:F12 a metric that is not a string is a TypeError', () => {
    expect(() => assessAccuracyClaim(withMetric(5))).toThrow(TypeError)
    expect(() => assessAccuracyClaim(withMetric(undefined))).toThrow(/claim\.metric must be a string/)
  })

  it('false-pass:F12 a metric the kit refuses is recognized in any case: F1, AUC, WER and mAP are refused, not thrown', () => {
    for (const metric of ['F1', 'AUC', 'WER', 'mAP', 'ROC-AUC', 'Composite']) {
      const r = assessAccuracyClaim(withMetric(metric))
      expect(r.reasons, metric).toEqual(['metric-not-supported'])
      expect(r.metric).toBe(metric.toLowerCase())
    }
  })

  it('false-pass:F12 a judged metric stays exact, and a wrong case says which name was meant', () => {
    expect(() => assessAccuracyClaim(withMetric('Accuracy'))).toThrow(/got "Accuracy"; did you mean "accuracy"\?/)
    expect(() => assessAccuracyClaim(withMetric('False-Positive-Rate'))).toThrow(/did you mean "false-positive-rate"/)
    expect(() => assessAccuracyClaim(withMetric('FPR'))).toThrow(RangeError)
    expect(() => assessAccuracyClaim(withMetric('FPR'))).not.toThrow(/did you mean/)
  })

  it('docs-release:D5 a display that disagrees with the value says both figures and the allowance', () => {
    const claim = (display: string, value: number, metric: 'accuracy' | 'error-rate' = 'accuracy'): AccuracyClaimInput =>
      sampled({ metric, value, display }, metric === 'accuracy' ? { n: 100, correct: 90 } : { n: 100, errors: 10 })
    const say = (input: AccuracyClaimInput): string => {
      try {
        assessAccuracyClaim(input)
      } catch (e) {
        return (e as Error).message
      }
      return 'no error'
    }
    expect(say(claim('91%', 0.9))).toBe('claim.display "91%" (91%) does not match claim.value 0.9 (90%): they may differ by at most half a unit of the last digit printed (0.5 percentage points)')
    expect(say(claim('90.5%', 0.9))).toContain('(0.05 percentage points)')
    expect(say(claim('95-98%', 0.9))).toBe('claim.display "95-98%" (98%) does not match claim.value 0.9 (90%): the value must lie inside the range')
    expect(say(claim('about 1 in 100', 0.1, 'error-rate'))).toContain('the value must lie inside the band the display is read at (1 in 50 to 1 in 150)')
    expect(say(claim('1 in 100', 0.011, 'error-rate'))).toContain('1 in 99.5 to 1 in 100.5')
    expect(say(claim('99%+', 0.9))).toContain('(0.5 percentage points)')
  })
})

describe('field:F6 false-pass:F12 ordinary acceptance-criteria wordings are read, and the ones that cannot be read still throw', () => {
  const acc = (display: string, correct = 950): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.95, display }, { n: 1000, correct }))
  const err = (display: string, errors = 50, value = 0.05): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'error-rate', value, display }, { n: 1000, errors }))
  const same = (a: AccuracyAssessment, b: AccuracyAssessment, label: string): void => {
    expect(outcome(a), label).toBe(outcome(b))
    expect(a.parsedDisplay?.form, label).toBe(b.parsedDisplay?.form)
    expect(a.parsedDisplay?.figure, label).toBe(b.parsedDisplay?.figure)
    expect(a.assessedValue, label).toBe(b.assessedValue)
  }

  it('field:F6 floor wordings read as "at least"', () => {
    for (const correct of [900, 940, 950, 960]) {
      const base = acc('at least 95%', correct)
      for (const display of ['greater than or equal to 95%', 'not less than 95%', 'no less than 95%', 'minimum of 95%', 'a minimum of 95%', '95% or higher', '95% or more', '95% or above', '95% or greater', '95%  or  Higher']) {
        same(acc(display, correct), base, `${display} ${String(correct)}`)
      }
    }
    expect(acc('greater than or equal to 95%').parsedDisplay).toEqual({ form: 'floor', figure: 0.95, decimals: 0 })
  })

  it('field:F6 ceiling wordings read as "at most"', () => {
    for (const errors of [30, 50, 55, 70]) {
      const base = err('at most 5%', errors)
      for (const display of ['less than or equal to 5%', 'not more than 5%', 'maximum of 5%', 'a maximum of 5%', '5% or lower', '5% or less', '5% or below']) {
        same(err(display, errors), base, `${display} ${String(errors)}`)
      }
    }
  })

  it('field:F6 the "or equal to" wordings are inclusive and the plain ones stay strict', () => {
    const set = (display: string, correct: number): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'accuracy', value: 0.95, display }, { n: 1000, correct }, 'Foo set'))
    expect(outcome(set('greater than or equal to 95%', 950))).toBe('supported [census-matches-count]')
    expect(outcome(set('greater than 95%', 950))).toBe('contradicted [claim-differs-from-count]')
    expect(outcome(set('95% or higher', 950))).toBe('supported [census-matches-count]')
    expect(outcome(set('95% or higher', 949))).toBe('contradicted [claim-differs-from-count]')
    expect(outcome(set('not less than 95%', 951))).toBe('supported [census-matches-count]')
  })

  it('field:F6 a wording that points the wrong way for the metric, or stacks two directions, throws', () => {
    expect(() => err('minimum of 5%')).toThrow(RangeError)
    expect(() => err('5% or higher')).toThrow(RangeError)
    expect(() => acc('not more than 95%')).toThrow(RangeError)
    expect(() => acc('95% or lower')).toThrow(RangeError)
    for (const display of ['at least 95% or higher', 'about 95% or higher', '95%+ or higher', 'minimum of 95% or more', '95% or higher or lower']) {
      expect(() => acc(display), display).toThrow(RangeError)
    }
  })

  it('false-pass:F12 a bound on "1 in N" is read as a bound at 1/N', () => {
    const one = (display: string, errors: number, n = 5000, value = 0.001): AccuracyAssessment =>
      assessAccuracyClaim(sampled({ metric: 'error-rate', value, display }, { n, errors }))
    for (const display of ['fewer than 1 in 1,000', 'less than 1 in 1000', 'under 1 in 1,000', 'below 1 in 1,000', '<1 in 1,000']) {
      expect(outcome(one(display, 0)), display).toBe('supported [claim-within-bound]')
      expect(outcome(one(display, 10)), display).toBe('contradicted [claim-outside-interval]')
      expect(one(display, 0).parsedDisplay).toEqual({ form: 'ceiling', figure: 0.001, decimals: null })
    }
    // a bound is never excused by matching the observed rate: 5 of 5000 is exactly 1 in 1,000
    expect(one('fewer than 1 in 1,000', 5).verdict).not.toBe('supported')
    expect(outcome(one('at most 1 in 1,000', 0))).toBe('supported [claim-within-bound]')
    expect(one('at most 1 in 1,000', 5).verdict).toBe('overstated')
    expect(() => one('at least 1 in 1,000', 0)).toThrow(RangeError)
    // the value has to sit at the bound it is printed with
    expect(() => one('fewer than 1 in 1,000', 0, 5000, 0.01)).toThrow(RangeError)
  })

  it('false-pass:F12 a floor on "1 in N" fits a higher-is-better metric, strictly or not, and the complete set compares exact counts', () => {
    const acc1 = (display: string, correct: number): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'accuracy', value: 0.5, display }, { n: 1000, correct }, 'Foo set'))
    expect(outcome(acc1('at least 1 in 2', 500))).toBe('supported [census-matches-count]')
    expect(outcome(acc1('more than 1 in 2', 500))).toBe('contradicted [claim-differs-from-count]')
    expect(outcome(acc1('more than 1 in 2', 501))).toBe('supported [census-matches-count]')
    expect(() => acc1('over 1 in 1', 1000)).toThrow(RangeError)
    const set = (display: string, errors: number): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'error-rate', value: 0.001, display }, { n: 5000, errors }, 'Foo set'))
    expect(outcome(set('at most 1 in 1,000', 5))).toBe('supported [census-matches-count]')
    expect(outcome(set('fewer than 1 in 1,000', 5))).toBe('contradicted [claim-differs-from-count]')
    expect(outcome(set('fewer than 1 in 1,000', 4))).toBe('supported [census-matches-count]')
  })

  it('field:F6 false-pass:F12 the figures in claim.text understand the same wordings', () => {
    const text = (t: string): AccuracyAssessment =>
      assessAccuracyClaim(census({ metric: 'accuracy', value: 0.95, display: '95%', text: t }, { n: 1000, correct: 950 }, 'Foo set'))
    expect(outcome(text('minimum of 90% on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(text('90% or higher on the Foo set'))).toBe('supported [census-matches-count]')
    expect(outcome(text('minimum of 99% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(text('99% or higher on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
    expect(outcome(text('greater than or equal to 99% on the Foo set'))).toBe('supported [census-matches-count, text-figure-differs]')
  })

  it('false-pass:F12 documented limits: a decimal comma and words after the figure are not read', () => {
    for (const display of ['99,8%', '99.8% accurate', '99 percent', 'a 99% or higher score']) {
      expect(() => acc(display), display).toThrow(RangeError)
    }
  })
})

describe('false-pass:F11 the comparison tolerance never excuses an absolute claim', () => {
  const zeroErrors = (n: number, value = 0, display = '0%'): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'error-rate', value, display }, { n, errors: 0 }))
  const allCorrect = (n: number, value = 1, display = '100%'): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'accuracy', value, display }, { n, correct: n }))

  it('false-pass:F11 a 0% error claim on zero errors is overstated at every size, not supported past about 4e12 items', () => {
    for (const n of [1e3, 1e9, 1e12, 3e12, 5e12, 1e13, 1e14, 1e15, Number.MAX_SAFE_INTEGER]) {
      expect(outcome(zeroErrors(n)), String(n)).toBe('overstated [claim-beyond-conservative-bound]')
    }
  })

  it('false-pass:F11 a 100% accuracy claim on all correct is overstated at every size', () => {
    for (const n of [1e3, 1e9, 1e12, 5e12, 1e13, 1e15, Number.MAX_SAFE_INTEGER]) {
      expect(outcome(allCorrect(n)), String(n)).toBe('overstated [claim-beyond-conservative-bound]')
    }
  })

  it('false-pass:F11 a bare value of 0 or 1 is absolute too, and one error makes a 0% claim contradicted even at 1e13 items', () => {
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0 }, { n: 1e13, errors: 0 })))).toBe('overstated [claim-beyond-conservative-bound]')
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1 }, { n: 1e13, correct: 1e13 })))).toBe('overstated [claim-beyond-conservative-bound]')
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0, display: '0%' }, { n: 1e13, errors: 1 })))).toBe('contradicted [claim-outside-interval]')
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display: '100%' }, { n: 1e13, correct: 1e13 - 1 })))).toBe('contradicted [claim-outside-interval]')
  })

  it('false-pass:F11 a claim that is not exactly 0 or 1 keeps the tolerance, so a limit that is the claim up to rounding still passes', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: wilsonInterval(990, 1000).low }, { n: 1000, correct: 990 }))
    expect(outcome(r)).toBe('supported [claim-within-bound]')
    // a bound at the interval limit of an all-correct sample is still on the cautious side
    const low = wilsonInterval(1e13, 1e13).low
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'accuracy', value: low }, { n: 1e13, correct: 1e13 })))).toBe('supported [claim-within-bound]')
  })
})

describe('hostile:F6 more distinct labels than the cap throw a clear error instead of exhausting the label table', () => {
  const distinct = (count: number): [number, number][] => {
    const pairs = new Array<[number, number]>(count)
    for (let i = 0; i < count; i++) pairs[i] = [i, i]
    return pairs
  }

  it('hostile:F6 percentAgreement, cohenKappa and gwetAC1 throw RangeError naming pairs and the limit, quickly', () => {
    const pairs = distinct(1_000_001)
    for (const fn of [percentAgreement, cohenKappa, gwetAC1]) {
      const t0 = process.cpuUsage()
      let error: unknown
      try {
        fn(pairs)
      } catch (e) {
        error = e
      }
      const t = process.cpuUsage(t0)
      expect(error, fn.name).toBeInstanceOf(RangeError)
      expect((error as RangeError).message).toMatch(/pairs have more than 1000000 distinct labels/)
      expect((t.user + t.system) / 1000, fn.name).toBeLessThan(3000)
    }
  }, 60_000)

  it('hostile:F6 a million distinct labels is the most that is accepted, and ordinary label sets are untouched', () => {
    expect(percentAgreement(distinct(1000)).status).toBe('defined')
    expect(percentAgreement(distinct(1000))).toMatchObject({ n: 1000, agreements: 1000, categories: 1000 })
    expect(percentAgreement(distinct(1_000_000))).toMatchObject({ n: 1_000_000, categories: 1_000_000 })
  }, 60_000)

  it('hostile:F6 a label seen before never counts against the cap', () => {
    const pairs: [number, number][] = distinct(500)
    for (let i = 0; i < 20_000; i++) pairs.push([i % 500, (i * 7) % 500])
    expect(cohenKappa(pairs).status).toBe('defined')
  })
})

describe('hostile:F7 an options value that is not a plain object throws, and a sample with no counts stays a refusal', () => {
  const withSample = (sample: unknown): AccuracyClaimInput => sampled({ metric: 'accuracy', value: 0.9 }, sample as AccuracyClaimInput['sample'])

  it('hostile:F7 a misspelled counts key throws and names the key, which is what used to be hidden behind "counts were not supplied"', () => {
    expect(() => assessAccuracyClaim(withSample({ total: 1000, right: 900 }))).toThrow(/unknown key "total"/)
    expect(() => assessAccuracyClaim(withSample({ n: 1000, right: 900 }))).toThrow(/unknown key "right"/)
  })

  it('hostile:F7 an object with none of n, correct or errors (an empty object, a Map, a Number object) is an undisclosed sample: refused, never a pass', () => {
    for (const sample of [{}, new Map<string, number>(), new Number(5)]) {
      const r = assessAccuracyClaim(withSample(sample))
      expect(r.reasons).toEqual(['n-undisclosed'])
      expect(r.explanation[0]).toContain('n and correct or errors')
    }
    expect(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9 }, undefined)).reasons).toEqual(['n-undisclosed'])
  })

  it('hostile:F7 options that are a Map, a Number object or a Date would silently switch every gate off, so they throw', () => {
    const input = sampled({ metric: 'accuracy', value: 0.9 }, { n: 10, correct: 9 })
    for (const options of [new Map([['minN', 5000]]), new Number(1), new Date(0), new Set(['minN'])]) {
      expect(() => assessAccuracyClaim(input, options as unknown as AssessOptions), Object.prototype.toString.call(options)).toThrow(TypeError)
    }
    expect(() => assessAccuracyClaim(input, new Number(1) as unknown as AssessOptions)).toThrow(/options must be a plain object, got \[object Number\]/)
    expect(assessAccuracyClaim(input, {}).reasons).toEqual(['sample-too-small'])
  })

  it('hostile:F7 class instances, null-prototype objects and objects from another realm are plain options and counts', () => {
    class Counts {
      n = 1000
      correct = 900
    }
    class Opts {
      minN = 5000
    }
    expect(assessAccuracyClaim(withSample(new Counts())).verdict).toBe('supported')
    expect(assessAccuracyClaim(withSample(Object.assign(Object.create(null) as object, { n: 1000, correct: 900 }))).verdict).toBe('supported')
    expect(assessAccuracyClaim(withSample(vm.runInNewContext('({ n: 1000, correct: 900 })'))).verdict).toBe('supported')
    const input = sampled({ metric: 'accuracy', value: 0.9 }, { n: 1000, correct: 900 })
    expect(assessAccuracyClaim(input, new Opts()).reasons).toEqual(['sample-too-small'])
    expect(assessAccuracyClaim(input, Object.assign(Object.create(null) as object, { minN: 5000 })).reasons).toEqual(['sample-too-small'])
    expect(assessAccuracyClaim(input, vm.runInNewContext('({ minN: 5000 })') as AssessOptions).reasons).toEqual(['sample-too-small'])
  })
})

describe('hostile:F11 a confidence level in e-notation is labeled from its digits, not its binary expansion', () => {
  it('hostile:F11 1e-7 reads 0.00001% (it printed 0.000009999%)', () => {
    expect(confidenceLabel(1e-7)).toBe('0.00001%')
    expect(confidenceLabel(1.5e-7)).toBe('0.000015%')
    expect(confidenceLabel(2.5e-9)).toBe('0.00000025%')
    expect(confidenceLabel(1e-9)).toBe('0.0000001%')
    expect(confidenceLabel(5e-7)).toBe('0.00005%')
  })

  it('hostile:F11 levels below one billionth of a percent say so, and ordinary levels are as before', () => {
    expect(confidenceLabel(1e-12)).toBe('under 0.000000001%')
    expect(confidenceLabel(0.95)).toBe('95%')
    expect(confidenceLabel(0.999)).toBe('99.9%')
    expect(confidenceLabel(0.5)).toBe('50%')
    expect(confidenceLabel(0.9999999)).toBe('99.99999%')
  })

  it('hostile:F11 no level that assessAccuracyClaim accepts (0.5 up to 1) is ever written in e-notation', () => {
    for (const confidence of [0.5, 0.5000001, 0.9, 0.99, 0.9999, 0.999999, 0.9999999999, 1 - 1e-15, 1 - 2 ** -53]) {
      expect(String(confidence), String(confidence)).not.toContain('e')
      const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.5 }, { n: 100, correct: 90 }), { confidence })
      expect(r.suggestedStatement).toMatch(/Wilson interval/)
      expect(r.suggestedStatement).not.toMatch(/e[+-]?\d/)
      expect(r.suggestedStatement).not.toMatch(/100% Wilson/)
    }
  })
})

describe('field:F4 a claim of 100% (or 0%) says why a sample cannot carry it, and what it can', () => {
  const hundred = (n: number, display = '100%'): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display }, { n, correct: n }))

  it('field:F4 290 of 290 claimed as 100%: still overstated, and the sentence names certainty and the figure that can be said', () => {
    const r = hundred(290)
    expect(outcome(r)).toBe('overstated [claim-beyond-conservative-bound]')
    expect(r.explanation[0]).toContain('cannot be stated from a sample')
    expect(r.explanation[0]).toContain('290 of 290')
    expect(r.explanation[0]).toContain('98.692%')
    expect(r.explanation[0]).not.toContain('inside the 95% Wilson interval but above')
    expect(r.suggestedStatement).toMatch(/^On this sample, at least 98\.69% accurate/)
    expect(r.suggestedStatement).not.toContain('print it to')
  })

  it('field:F4 zero errors claimed as 0%: the same, from the other side', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0, display: '0%' }, { n: 290, errors: 0 }))
    expect(outcome(r)).toBe('overstated [claim-beyond-conservative-bound]')
    expect(r.explanation[0]).toContain('cannot be stated from a sample')
    expect(r.explanation[0]).toContain('0 of 290')
    expect(r.explanation[0]).toContain('1.308%')
    expect(r.suggestedStatement).toMatch(/^On this sample, at most 1\.31% error rate/)
  })

  it('review:P3 the sentence describes the conservative limit, not the whole interval, which does reach 1 (or 0) at s = n (or 0)', () => {
    const acc = hundred(100)
    expect(acc.interval?.high).toBe(1)
    expect(acc.explanation[0]).not.toMatch(/interval never reaches/)
    expect(acc.explanation[0]).toContain('conservative lower limit cannot establish 100%')
    expect(acc.explanation[0]).toContain('96.300%')
    const err = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0, display: '0%' }, { n: 100, errors: 0 }))
    expect(err.interval?.low).toBe(0)
    expect(err.explanation[0]).not.toMatch(/interval never reaches/)
    expect(err.explanation[0]).toContain('conservative upper limit cannot establish 0%')
    expect(err.explanation[0]).toContain('3.700%')
  })

  it('field:F4 only a claim of exactly 100% or 0% gets that sentence; a rounding is judged as before', () => {
    const near = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.999, display: '99.9%' }, { n: 290, correct: 290 }))
    expect(near.explanation[0]).not.toContain('cannot be stated from a sample')
    expect(near.explanation[0]).toContain('inside the 95% Wilson interval')
    // a 100% claim that the counts contradict keeps the contradiction wording
    const wrong = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display: '100%' }, { n: 290, correct: 250 }))
    expect(outcome(wrong)).toBe('contradicted [claim-outside-interval]')
  })

  it('field:F4 under strictPrecision or conservative the sentence and the reason are the same', () => {
    expect(outcome(assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display: '100%' }, { n: 290, correct: 290 }), { conservative: true }))).toBe('overstated [claim-beyond-conservative-bound]')
  })
})

describe('field:F5 a bound printed rounded to the nearest digit that lands just past the interval says to round down', () => {
  const floor = (display: string, value: number, correct: number, n = 590): AccuracyAssessment =>
    assessAccuracyClaim(sampled({ metric: 'accuracy', value, display }, { n, correct }))

  it('field:F5 589 of 590 with a published lower bound of 99.1% is overstated by a rounding-sized shortfall, and the figure to print is 99.0%', () => {
    const r = floor('99.1%+', 0.991, 589)
    expect(outcome(r)).toBe('overstated [claim-beyond-conservative-bound]')
    expect(r.explanation[0]).toContain('99.046%')
    expect(r.explanation[0]).toContain('rounding of the last printed digit')
    expect(r.explanation[0]).toContain('print the bound rounded down: 99.0%')
  })

  it('field:F5 the mirror for an upper bound: round up', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.0095, display: '0.95%' + '' }, { n: 5000, errors: 20 }))
    expect(r.verdict).not.toBe('refused')
    const bound = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.006, display: 'at most 0.6%' }, { n: 5000, errors: 20 }))
    expect(bound.verdict).toBe('overstated')
    expect(bound.explanation[0]).toMatch(/print the bound rounded up: 0\.\d%/)
  })

  it('field:F5 a bound that misses by more than one last digit gets no hint, and neither does a point figure', () => {
    const far = floor('99.5%+', 0.995, 589)
    expect(far.explanation[0]).not.toContain('rounded down')
    const point = floor('99.1%', 0.991, 589)
    expect(point.explanation[0]).not.toContain('rounded down')
  })
})

describe('docs-release:D7 decimal places are counted in words a person would write', () => {
  it('docs-release:D7 zero decimals is "whole percents", one is singular, the rest plural, in the explanation and the statement', () => {
    const at = (display: string, n: number, correct: number): AccuracyAssessment =>
      assessAccuracyClaim(sampled({ metric: 'accuracy', value: Number(display.replace('%', '')) / 100, display }, { n, correct }))
    const whole = at('99.8%', 500, 499)
    expect(whole.explanation[1]).toBe('The figure is printed to 1 decimal place, but the interval is 1.09 percentage points wide and supports whole percents only.')
    expect(whole.suggestedStatement).toMatch(/; print it as a whole percent$/)
    const one = at('99.95%', 2000, 1999)
    expect(one.explanation.join(' ')).toContain('printed to 2 decimal places')
    expect(one.suggestedStatement).toMatch(/; print it to at most 1 decimal place$/)
    const many = at('99.9500%', 2000, 1999)
    expect(many.suggestedStatement).toMatch(/; print it to at most 1 decimal place$/)
    expect(many.explanation.join(' ')).toContain('printed to 4 decimal places')
    expect(JSON.stringify([whole, one, many])).not.toContain('place(s)')
  })

  it('docs-release:D7 the complete-set sentence reads the same way', () => {
    const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.799, display: '79.9000%' }, { n: 50_000, correct: 39_950 }, 'Foo set'))
    expect(r.explanation.join(' ')).toContain('printed to 4 decimal places; 50000 items resolve at most 3 decimal places')
    expect(r.suggestedStatement).toMatch(/; print it to at most 3 decimal places$/)
    const small = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.9, display: '90.0%' }, { n: 10, correct: 9 }, 'Foo set'))
    expect(small.explanation.join(' ')).toContain('printed to 1 decimal place; 10 items resolve whole percents only')
    expect(small.suggestedStatement).toMatch(/; print it as a whole percent$/)
  })
})
