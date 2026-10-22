import { describe, expect, it } from 'vitest'
import engineering from '../ENGINEERING.md?raw'
import method from '../METHOD.md?raw'
import readme from '../README.md?raw'
import security from '../SECURITY.md?raw'
import { assessAccuracyClaim, wilsonInterval } from '../src/index.js'
import type { AccuracyClaimInput } from '../src/index.js'

// Documentation rows for the round 9 findings: the docs say what the code does.
// Every row name starts with the finding id it pins, so `vitest -t "first5:F2"`
// runs one finding.

const HUMAN = { provenance: { source: 'human' }, sampling: 'random' } as const

describe('first5:F1 the docs say why a figure below the observed rate is overstated', () => {
  it('first5:F1 the README quick start explains why 98.5% fails while 99.0% passes, and METHOD.md names the observed rate', () => {
    expect(readme).toContain('98.5% is `overstated`: it is below the observed rate (99.0%) but above the lower end')
    expect(readme).toContain('honest round-down')
    expect(method).toContain('the explanation says the figure is below the observed rate')
  })
})

describe('first5:F2 the documented lower end is the figure the kit prints and accepts', () => {
  it('first5:F2 README and METHOD.md quote 98.16%, never 98.17%, as the lower end', () => {
    for (const [name, text] of [['README', readme], ['METHOD', method]] as const) {
      expect(text, name).toContain('98.16%')
      expect(text, name).not.toContain('98.17%')
    }
  })
})

describe('first5:F3 the README states exactly what changed after the measured revision', () => {
  it('first5:F3 the false "only documentation, workflows and tests" sentence is gone and the src changes are named', () => {
    expect(readme).not.toContain('change only documentation, workflows and tests')
    expect(readme).toContain('later commits also changed `src/`')
    expect(readme).toContain('No benchmark verdict changed')
    expect(readme).toContain('`git diff 373258b HEAD -- src` lists them')
  })
})

describe('first5:F4 what the text-figure scan does not read is documented', () => {
  it('first5:F4 a "from X to Y" sentence reads as a range, and a proportion or a spelled-out number is not read', () => {
    expect(readme).toContain('"improved from 70% to 95%" reads as the range 70-95%')
    expect(readme).toContain('a proportion such as `0.999` and a spelled-out number such as "ninety-nine percent" are not read at all')
    expect(readme).toContain('the Arabic percent sign included')
  })
})

describe('first5:F5 echoed identifiers are not judged', () => {
  it('first5:F5 a population that carries a figure reaches the statement as typed, and every doc that covers echoed strings says so', () => {
    const r = assessAccuracyClaim({
      claim: { metric: 'accuracy', value: 0.95, display: '95%' },
      sample: { n: 1000, correct: 950 },
      ...HUMAN,
      population: { claimed: '99.9% accurate', evaluated: '99.9% accurate' },
    })
    expect(r.suggestedStatement).toContain('On this sample of 99.9% accurate')
    for (const [name, text] of [['README', readme], ['METHOD', method], ['SECURITY', security], ['ENGINEERING', engineering]] as const) {
      expect(text, name).toContain('echoed')
      expect(text, name).toMatch(/not judged/)
    }
    expect(readme).toContain('Build them from fixed identifiers, never from untrusted metadata')
    expect(method).toContain('Build them from fixed identifiers, never from untrusted metadata')
  })
})

describe('first5:F6 an exact rounding tie accepts both neighbors', () => {
  it('first5:F6 README, METHOD.md and ENGINEERING.md say an exact tie accepts both neighbors', () => {
    for (const [name, text] of [['README', readme], ['METHOD', method], ['ENGINEERING', engineering]] as const) {
      expect(text, name).toContain('exact tie')
      expect(text, name).toContain('both neighbors')
    }
    expect(readme).toContain('the kit does not pick a rounding rule')
  })
})

describe('first5:F7 first5:F9 TypeScript use and the node16 note', () => {
  it('first5:F7 the README has a TypeScript example that hoists the evidence with satisfies and annotates AccuracyClaimInput', () => {
    expect(readme).toContain("import type { AccuracyClaimInput } from 'accuracy-claim-kit'")
    expect(readme).toContain('satisfies Pick<AccuracyClaimInput')
    expect(readme).toContain('literal widening')
  })

  it('first5:F9 a TypeScript CommonJS file under module node16 gets TS1479, and the README says how to get out of it', () => {
    expect(readme).toContain('TS1479')
    expect(readme).toContain('TS1541')
    expect(readme).toContain('"module": "node16"')
    expect(readme).toContain('"type": "module"')
    expect(readme).toContain("await import('accuracy-claim-kit')")
  })
})

describe('first5:F10 the lead and the heading say what the numbers show', () => {
  it('first5:F10 the lead says a cautious statement, not "the most the evidence supports", and the heading names an oracle and a holdout', () => {
    expect(readme).not.toContain('writes the most the evidence supports')
    expect(readme).toContain('writes a cautious statement the evidence supports')
    expect(readme).not.toContain('## Accuracy on real data')
    expect(readme).toContain('## Agreement with an independent oracle and a hand-labeled holdout')
    expect(readme).not.toContain('How often is the kit right?')
  })
})

describe('first5:F11 the two longest README bullets are split into sub-bullets', () => {
  it('first5:F11 the scope-wording and display bullets have no line over 800 characters', () => {
    const lines = readme.split('\n')
    for (const start of ['- **Scope wording**:', '- **`display`** is optional']) {
      const at = lines.findIndex((line) => line.startsWith(start))
      expect(at, start).toBeGreaterThanOrEqual(0)
      expect(lines[at + 1], start).toMatch(/^ {2}- /)
      for (let i = at; i < lines.length && (i === at || lines[i]?.startsWith('  - ')); i++) {
        expect((lines[i] as string).length, `${start} line ${String(i - at)}`).toBeLessThan(800)
      }
    }
  })
})

describe('first5:F12 the numerics table counts what it counts', () => {
  it('first5:F12 the tables run from 1 to 8 categories, and 1,353 are compared of the 1,354 the kit defines', () => {
    expect(readme).toContain('The tables run from 1 to 8 categories')
    expect(readme).not.toContain('The tables run from 2 to 8 categories')
    expect(readme).toContain('1,353 defined in both irrCAC classes (the kit defines 1,354)')
  })
})

describe('hunt:R9-AC-02 the README no longer says an interval never reaches certainty', () => {
  it('hunt:R9-AC-02 the interval ends at 1 for 290 of 290, and the README says what that means', () => {
    expect(wilsonInterval(290, 290).high).toBe(1)
    expect(readme).not.toContain('an interval never reaches certainty')
    expect(readme).toContain('The Wilson interval itself ends at 100% when every item was right')
  })
})

describe('hunt:R9-AC-03 the README says an approximate 100% in claim.text keeps its band', () => {
  it('hunt:R9-AC-03 a printed 100% is the same figure only for exactly 1, and "about 100%" and "~100%" are the exemption', () => {
    expect(readme).toContain('A printed 100% or 0% is the exception: it is the same figure only for a value of exactly 1 or 0')
    expect(readme).toContain('"about 100%" and "~100%" keep their rounding band and are not flagged')
    expect(engineering).toContain('keeps its rounding band on purpose')
  })
})

describe('hunt:R9-AC-04 the Preparing a real claim table lists every accepted value', () => {
  const rows = readme
    .split('\n')
    .filter((line) => line.startsWith('| who decided') || line.startsWith('| how items were chosen'))

  it('hunt:R9-AC-04 provenance.source and sampling rows name every accepted value', () => {
    expect(rows).toHaveLength(2)
    const [who, how] = rows as [string, string]
    for (const word of ['human', 'automated', 'by-construction', 'model', 'mixed', 'unknown']) expect(who).toContain(`\`${word}\``)
    for (const word of ['complete', 'held-out-split', 'random', 'stratified', 'cross-validation', 'ranked', 'convenience', 'unknown']) {
      expect(how).toContain(`\`${word}\``)
    }
  })

  it('hunt:R9-AC-04 every value those rows list is accepted at run time', () => {
    const base = {
      claim: { metric: 'accuracy', value: 0.95, text: 'Ridgeview set' },
      sample: { n: 1000, correct: 950 },
    } as const
    for (const source of ['human', 'automated', 'by-construction', 'model', 'mixed', 'unknown'] as const) {
      const input: AccuracyClaimInput = { ...base, provenance: { source }, sampling: 'random' }
      expect(() => assessAccuracyClaim(input), source).not.toThrow()
    }
    for (const sampling of ['complete', 'held-out-split'] as const) {
      const input: AccuracyClaimInput = { ...base, provenance: { source: 'human' }, sampling, benchmark: { name: 'Ridgeview set' } }
      expect(assessAccuracyClaim(input).verdict, sampling).toBe('supported')
    }
    for (const sampling of ['random', 'stratified', 'cross-validation', 'ranked', 'convenience', 'unknown'] as const) {
      const input: AccuracyClaimInput = {
        ...base,
        provenance: { source: 'human' },
        sampling,
        ...(sampling === 'stratified' ? { strata: [{ name: 'all', n: 1000, correct: 950 }] } : {}),
      }
      expect(() => assessAccuracyClaim(input), sampling).not.toThrow()
    }
    expect(assessAccuracyClaim({ ...base, provenance: { source: 'by-construction' }, sampling: 'random' }).verdict).toBe('supported')
    expect(assessAccuracyClaim({ ...base, provenance: { source: 'human' }, sampling: 'cross-validation' }).verdict).toBe('supported')
  })
})
