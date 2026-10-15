import { describe, expect, it } from 'vitest'
import { assessAccuracyClaim } from '../src/index.js'
import type { AccuracyAssessment, AccuracyClaimInput } from '../src/index.js'
import { foldText } from '../src/text.js'

// Regression rows for the findings of the release gate. Every row name starts
// with the finding id (or ids) it pins, so `vitest -t "gate-hostile:F1"` runs
// one finding.

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

describe('gate-review:R5-F1 gate-false-pass:G1 gate-hostile:F1 an honest value carrying float noise is the figure it nearly is', () => {
  it('gate-review:R5-F1 value 1 - 800 / 1000 for 200 errors in 1000 is supported on a sample, with and without a display', () => {
    const value = 1 - 800 / 1000
    expect(value).not.toBe(0.2)
    const bare = assessAccuracyClaim(sampled({ metric: 'error-rate', value }, { n: 1000, errors: 200 }))
    expect(outcome(bare)).toBe('supported [matches-observed-rate]')
    const shown = assessAccuracyClaim(sampled({ metric: 'error-rate', value, display: '20.0%' }, { n: 1000, errors: 200 }))
    expect(outcome(shown)).toBe('supported [matches-observed-rate, precision-too-fine]')
    const literal = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 0.2, display: '20.0%' }, { n: 1000, errors: 200 }))
    expect(outcome(shown)).toBe(outcome(literal))
  })

  it('gate-review:R5-F1 the same value on a complete set is census-matches-count, never claim-differs-from-count', () => {
    const value = 1 - 800 / 1000
    for (const display of [undefined, '20.0%']) {
      const claim = display === undefined ? { metric: 'error-rate' as const, value } : { metric: 'error-rate' as const, value, display }
      const r = assessAccuracyClaim(census(claim, { n: 1000, errors: 200 }))
      expect(outcome(r)).toBe('supported [census-matches-count]')
    }
  })

  it('gate-hostile:F1 value 1 - 99 / 100 for 1 error in 100, and 1 - 0.9989 shown as 0.11% for 11 in 10000', () => {
    const one = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 1 - 99 / 100 }, { n: 100, errors: 1 }, { }), { minN: 30 })
    expect(one.verdict).toBe('supported')
    expect(one.reasons[0]).toBe('matches-observed-rate')
    const complement = assessAccuracyClaim(sampled({ metric: 'error-rate', value: 1 - 0.9989, display: '0.11%' }, { n: 10_000, errors: 11 }))
    expect(complement.verdict).toBe('supported')
    expect(complement.reasons[0]).toBe('matches-observed-rate')
    const whole = assessAccuracyClaim(census({ metric: 'error-rate', value: 1 - 0.9989, display: '0.11%' }, { n: 10_000, errors: 11 }))
    expect(outcome(whole)).toBe('supported [census-matches-count]')
  })

  it('gate-false-pass:G1 every honest derivation of k / n is supported, on a sample and on a complete set', () => {
    // each form is a way a pipeline computes the same honest rate; none may flip a verdict
    const forms: Record<string, (k: number, n: number) => number> = {
      'k / n': (k, n) => k / n,
      '1 - (n - k) / n': (k, n) => 1 - (n - k) / n,
      '(k / n * 100) / 100': (k, n) => (k / n * 100) / 100,
      '1 - (1 - k / n)': (k, n) => 1 - (1 - k / n),
      '1 - (100 - k / n * 100) / 100': (k, n) => 1 - (100 - (k / n) * 100) / 100,
      'mean of ten equal folds': (k, n) => {
        let sum = 0
        for (let i = 0; i < 10; i++) sum += k / n
        return sum / 10
      },
      'k / n * 0.1 * 10': (k, n) => (k / n) * 0.1 * 10,
    }
    const failures: string[] = []
    for (const n of [30, 100, 913, 1000]) {
      for (let k = 1; k < n; k++) {
        for (const [name, make] of Object.entries(forms)) {
          const value = make(k, n)
          const s = assessAccuracyClaim(sampled({ metric: 'accuracy', value }, { n, correct: k }))
          const e = assessAccuracyClaim(sampled({ metric: 'error-rate', value }, { n, errors: k }))
          const c = assessAccuracyClaim(census({ metric: 'accuracy', value }, { n, correct: k }))
          if (s.verdict !== 'supported' || e.verdict !== 'supported' || c.verdict !== 'supported') {
            failures.push(`${name} k=${String(k)} n=${String(n)}: ${outcome(s)} / ${outcome(e)} / ${outcome(c)}`)
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
  })

  it('gate-review:R5-F1 a value that is really off by a visible amount is still judged for what it says', () => {
    const over = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.992 }, { n: 1000, correct: 990 }))
    expect(over.verdict).toBe('overstated')
    const wrong = assessAccuracyClaim(census({ metric: 'accuracy', value: 1 - 0.011 }, { n: 1000, correct: 990 }))
    expect(wrong.verdict).toBe('contradicted')
    const near = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.99 + 1e-9 }, { n: 1000, correct: 990 }))
    expect(near.verdict).toBe('contradicted')
  })
})

describe('gate-review:R5-F2 gate-false-pass:G3 a value within float noise of 1 or 0 is an absolute claim', () => {
  const tenTenths = ((): number => {
    let sum = 0
    for (let i = 0; i < 10; i++) sum += 0.1
    return sum
  })()
  const noisy100 = [0.7 * 1 + 0.2 * 1 + 0.1 * 1, tenTenths, 1 - 2 ** -52, 1 - 2 ** -53]

  it('gate-review:R5-F2 a bare 0.9999999999999999 on 995 of 1000 is judged like the value 1', () => {
    expect(tenTenths).toBe(0.9999999999999999)
    const exact = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1 }, { n: 1000, correct: 995 }))
    expect(outcome(exact)).toBe('contradicted [claim-outside-interval]')
    const noisy = assessAccuracyClaim(sampled({ metric: 'accuracy', value: tenTenths }, { n: 1000, correct: 995 }))
    expect(outcome(noisy)).toBe(outcome(exact))
  })

  it('gate-review:R5-F2 on a complete set the noisy 100% matches only n of n', () => {
    const wrong = assessAccuracyClaim(census({ metric: 'accuracy', value: tenTenths }, { n: 1000, correct: 995 }))
    expect(outcome(wrong)).toBe('contradicted [claim-differs-from-count]')
    const right = assessAccuracyClaim(census({ metric: 'accuracy', value: tenTenths }, { n: 1000, correct: 1000 }))
    expect(outcome(right)).toBe('supported [census-matches-count]')
  })

  it('gate-false-pass:G3 an all-correct sample claimed as 100% is overstated whatever float noise the value carries', () => {
    for (const value of noisy100) {
      for (const display of [undefined, '100%']) {
        const claim = display === undefined ? { metric: 'accuracy' as const, value } : { metric: 'accuracy' as const, value, display }
        const r = assessAccuracyClaim(sampled(claim, { n: 290, correct: 290 }))
        expect(outcome(r), `${String(value)} ${String(display)}`).toBe('overstated [claim-beyond-conservative-bound]')
        expect(r.assessedValue).toBe(1)
        expect(r.claimed).toBe(value)
      }
    }
  })

  it('gate-false-pass:G3 the mirror: an error rate within noise of 0 is never supported on a sample, and matches only 0 errors on a complete set', () => {
    const noisy0 = 1 - tenTenths
    expect(noisy0).toBeGreaterThan(0)
    const none = assessAccuracyClaim(sampled({ metric: 'error-rate', value: noisy0 }, { n: 290, errors: 0 }))
    expect(outcome(none)).toBe('overstated [claim-beyond-conservative-bound]')
    const some = assessAccuracyClaim(sampled({ metric: 'error-rate', value: noisy0 }, { n: 1000, errors: 5 }))
    expect(some.verdict).not.toBe('supported')
    const complete = assessAccuracyClaim(census({ metric: 'error-rate', value: noisy0 }, { n: 1000, errors: 5 }))
    expect(outcome(complete)).toBe('contradicted [claim-differs-from-count]')
    const zero = assessAccuracyClaim(census({ metric: 'error-rate', value: noisy0 }, { n: 1000, errors: 0 }))
    expect(outcome(zero)).toBe('supported [census-matches-count]')
  })

  it('gate-false-pass:G3 a value more than the noise allowance below 1 is an ordinary figure, not an absolute one', () => {
    const near = assessAccuracyClaim(census({ metric: 'accuracy', value: 1 - 1e-9 }, { n: 1000, correct: 1000 }))
    expect(near.verdict).toBe('contradicted')
    const far = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.99 }, { n: 1000, correct: 990 }))
    expect(far.verdict).toBe('supported')
  })
})

describe('gate-hostile:F4 "1 in 1" is 100%, an absolute claim that matches only n of n', () => {
  it('gate-hostile:F4 a complete set of 100 with 70 correct is contradicted for "1 in 1", "about 1 in 1" and "100%" alike', () => {
    for (const display of ['1 in 1', 'about 1 in 1', '~1 in 1', '100%']) {
      const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 1, display }, { n: 100, correct: 70 }, 'Ridgeview'))
      expect(outcome(r), display).toBe('contradicted [claim-differs-from-count]')
    }
    for (const display of ['1 in 1', 'about 1 in 1', '100%']) {
      const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 1, display }, { n: 100, correct: 100 }, 'Ridgeview'))
      expect(outcome(r), display).toBe('supported [census-matches-count]')
    }
  })

  it('gate-hostile:F4 on a sample "1 in 1" is overstated or contradicted, never supported, and a value short of 1 does not match the print', () => {
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display: '1 in 1' }, { n: 100, correct: 100 }))
    expect(outcome(r)).toBe('overstated [claim-beyond-conservative-bound]')
    const off = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 1, display: '1 in 1' }, { n: 100, correct: 99 }))
    expect(off.verdict).toBe('contradicted')
    expect(() => assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.7, display: '1 in 1' }, { n: 100, correct: 70 }))).toThrow(RangeError)
  })

  it('gate-hostile:F4 the explanation says why, and "1 in 2" keeps its band', () => {
    const r = assessAccuracyClaim(census({ metric: 'accuracy', value: 1, display: '1 in 1' }, { n: 100, correct: 100 }, 'Ridgeview'))
    expect(r.explanation.join(' ')).toContain('100%')
    const half = assessAccuracyClaim(census({ metric: 'accuracy', value: 0.5, display: '1 in 2' }, { n: 100, correct: 50 }, 'Ridgeview'))
    expect(outcome(half)).toBe('supported [census-matches-count]')
  })
})

describe('gate-review:R5-F3 a claim.text with a line break throws a message that says how to fix it, and the wording is never echoed', () => {
  const wrapped = 'Our detector is 90% accurate on\nthe held-out set.'

  it('gate-review:R5-F3 the error names the field and the character, and says to put the claim on one line', () => {
    for (const text of [wrapped, wrapped.replace('\n', '\r\n'), wrapped.replace('\n', '\r'), wrapped.replace('\n', ' ')]) {
      let error: unknown
      try {
        assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text }, { n: 1000, correct: 900 }))
      } catch (e) {
        error = e
      }
      const message = (error as RangeError).message
      expect(error).toBeInstanceOf(RangeError)
      expect(message).toContain('claim.text')
      expect(message).toMatch(/one line/)
    }
    const joined = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text: wrapped.replace(/\s+/g, ' ') }, { n: 1000, correct: 900 }))
    expect(joined.verdict).toBe('supported')
  })

  it('gate-review:R5-F3 a control character that is not a line break gets no line advice', () => {
    let error: unknown
    try {
      assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text: 'a‮b' }, { n: 1000, correct: 900 }))
    } catch (e) {
      error = e
    }
    expect((error as RangeError).message).not.toMatch(/one line/)
  })

  it('gate-review:R5-F3 claim.text reaches no explanation or statement as written: only figures read from it are quoted', () => {
    const text = 'Zorblax detector, 90% accurate on the held-out Quuxset (verified last week by the lab)'
    const r = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text }, { n: 1000, correct: 900 }))
    const json = JSON.stringify(r)
    for (const word of ['Zorblax', 'Quuxset', 'verified', 'last week']) expect(json).not.toContain(word)
    const differing = assessAccuracyClaim(sampled({ metric: 'accuracy', value: 0.9, text: 'Zorblax gets 95% on Quuxset' }, { n: 1000, correct: 900 }))
    expect(JSON.stringify(differing)).not.toContain('Zorblax')
    expect(differing.reasons).toContain('text-figure-differs')
  })
})

describe('gate-hostile:F2 invisible format characters do not change what a name or the claim text says', () => {
  // zero-width space, non-joiner, joiner, word joiner, direction marks, BOM, Mongolian vowel separator,
  // Arabic letter mark, invisible separator, soft hyphen, a variation selector, a tag character, Hangul filler
  const invisible = ['​', '‌', '‍', '⁠', '‎', '‏', '﻿', '᠎', '؜', '⁣', '­', '️', '\u{e0041}', 'ㅤ', 'ᅟ']
  const code = (c: string): string => `U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`
  const scoped = (name: string, text: string): AccuracyAssessment =>
    assessAccuracyClaim({
      claim: { metric: 'accuracy', value: 0.7, text },
      sample: { n: 1000, correct: 700 },
      provenance: { source: 'human' },
      sampling: 'complete',
      benchmark: { name },
    })

  it('gate-hostile:F2 an invisible character next to the name cannot hide a longer name (MMLU-Pro, HumanEval+, latest)', () => {
    for (const c of invisible) {
      expect(outcome(scoped('MMLU', `Reaches 70% on MMLU${c}-Pro`)), `MMLU ${code(c)}`).toBe('refused [claim-not-scoped-to-benchmark]')
      expect(outcome(scoped('MMLU', `Reaches 70% on MMLU-${c}Pro`)), `MMLU- ${code(c)}`).toBe('refused [claim-not-scoped-to-benchmark]')
      expect(outcome(scoped('HumanEval', `Reaches 70% on HumanEval${c}+`)), `HumanEval ${code(c)}`).toBe('refused [claim-not-scoped-to-benchmark]')
      expect(outcome(scoped('test', `Reaches 70% on the la${c}test`)), `latest ${code(c)}`).toBe('refused [claim-not-scoped-to-benchmark]')
    }
  })

  it('gate-hostile:F2 the same name with an invisible character inside it still matches, as text copied from the web does', () => {
    for (const c of invisible) {
      expect(outcome(scoped('CIFAR-10', `Reaches 70% on CIFAR-${c}10`)), `CIFAR ${code(c)}`).toBe('supported [census-matches-count]')
      expect(outcome(scoped('MS COCO', `Reaches 70% on MS${c} COCO`)), `COCO ${code(c)}`).toBe('supported [census-matches-count]')
      expect(outcome(scoped('MMLU', `Reaches 70% on MMLU${c}`)), `MMLU end ${code(c)}`).toBe('supported [census-matches-count]')
    }
  })

  it('gate-hostile:F2 the controls with a plain control in the control row are unchanged: a plain boundary still passes and a name of invisible characters alone is blank', () => {
    expect(outcome(scoped('MMLU', 'Reaches 70% on MMLU, a broad exam'))).toBe('supported [census-matches-count]')
    expect(() => scoped('​⁠', 'x')).toThrow(RangeError)
  })

  it('gate-hostile:F2 two population strings that differ only by invisible characters are the same scope', () => {
    const r = assessAccuracyClaim({
      claim: { metric: 'accuracy', value: 0.9 },
      sample: { n: 1000, correct: 900 },
      provenance: { source: 'human' },
      sampling: 'random',
      population: { claimed: 'English tweets', evaluated: 'English‍ tweets' },
    })
    expect(r.verdict).toBe('supported')
  })
})

describe('gate-hostile:F2 sweep: every default-ignorable code point is invisible to the name matcher', () => {
  it('gate-hostile:F2 none of them, placed next to a name or inside the suffix, lets MMLU-Pro pass for MMLU', () => {
    const ignorable = /^\p{Default_Ignorable_Code_Point}$/u
    const failures: string[] = []
    let seen = 0
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const c = String.fromCodePoint(cp)
      if (!ignorable.test(c)) continue
      seen += 1
      for (const text of [`70% on MMLU${c}-Pro`, `70% on MMLU-${c}Pro`, `70% on MMLU${c}+`]) {
        let verdict: string
        try {
          verdict = assessAccuracyClaim({
            claim: { metric: 'accuracy', value: 0.7, text },
            sample: { n: 1000, correct: 700 },
            provenance: { source: 'human' },
            sampling: 'complete',
            benchmark: { name: 'MMLU' },
          }).verdict
        } catch {
          continue // controls and bidirectional marks throw: they never reach a verdict
        }
        if (verdict !== 'refused') failures.push(`U+${cp.toString(16)} in "${text}"`)
      }
    }
    expect(seen).toBeGreaterThan(300)
    expect(failures.slice(0, 5)).toEqual([])
  })
})

describe('gate-hostile:F10 a Greek final sigma folds the same wherever the word sits', () => {
  const scoped = (name: string, text: string): AccuracyAssessment =>
    assessAccuracyClaim({
      claim: { metric: 'accuracy', value: 0.7, text },
      sample: { n: 1000, correct: 700 },
      provenance: { source: 'human' },
      sampling: 'complete',
      benchmark: { name },
    })

  it("gate-hostile:F10 a possessive after an upper-case Greek name still matches it", () => {
    expect(outcome(scoped('ΟΔΥΣΣΕΥΣ', "Reaches 70% on ΟΔΥΣΣΕΥΣ's held-out set"))).toBe('supported [census-matches-count]')
    expect(outcome(scoped('ΟΔΥΣΣΕΥΣ', 'Reaches 70% on ΟΔΥΣΣΕΥΣ held-out set'))).toBe('supported [census-matches-count]')
  })

  it('gate-hostile:F10 upper case, lower case and a word-final or word-internal sigma all fold alike', () => {
    expect(foldText('ΟΔΥΣΣΕΥΣ')).toBe(foldText('οδυσσευς'))
    expect(foldText("ΟΔΥΣΣΕΥΣ's")).toBe(foldText("οδυσσευς's"))
    expect(foldText('ΣΟΦΟΣ ΣΟΦΟΣ')).toBe(foldText('σοφοσ σοφος'))
    expect(outcome(scoped('οδυσσευς', "Reaches 70% on ΟΔΥΣΣΕΥΣ's held-out set"))).toBe('supported [census-matches-count]')
    expect(outcome(scoped('ΟΔΥΣΣΕΥΣ', "Reaches 70% on οδυσσευς's held-out set"))).toBe('supported [census-matches-count]')
  })
})
