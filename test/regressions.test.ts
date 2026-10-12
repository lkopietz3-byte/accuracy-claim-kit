import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput, AssessOptions } from '../src/index.js'
import { cohenKappa, gwetAC1, percentAgreement, wilsonInterval } from '../src/index.js'
import { foldText, mentionsName } from '../src/text.js'
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
