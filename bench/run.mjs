// npm run bench: run the built kit (dist/) over the field corpus and print how often
// its verdict equals the independent oracle's, with the denominator of every number.
//
//   node bench/run.mjs            check the headline numbers in bench/expected.json
//   node bench/run.mjs --list     also print each disagreement
//
// The cases are written by bench/fda/build.py (python3 -I, standard library) from derived
// numbers, so every expected verdict is computed before the kit is run.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessAccuracyClaim } from '../dist/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const list = process.argv.includes('--list')

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function judge(c) {
  try {
    const r = assessAccuracyClaim(c.input, c.options)
    return { verdict: r.verdict, reasons: [...r.reasons].sort() }
  } catch (e) {
    return { verdict: 'THROW', reasons: [], error: `${e.name}: ${e.message}` }
  }
}

const cases = readJsonl(path.join(here, 'fda', 'cases.jsonl'))
const suites = {}
const disagreements = []
let maxMs = 0
for (const c of cases) {
  const t0 = performance.now()
  const got = judge(c)
  maxMs = Math.max(maxMs, performance.now() - t0)
  const s = (suites[c.suite] ??= { total: 0, agree: 0, matrix: {} })
  s.total += 1
  const want = c.expected.verdict
  let ok = got.verdict === want
  if (ok && want === 'refused' && c.expected.reasons && JSON.stringify(c.expected.reasons) !== JSON.stringify(got.reasons)) ok = false
  if (ok) s.agree += 1
  else disagreements.push({ suite: c.suite, id: c.id, want, got: got.verdict, reasons: got.reasons, error: got.error })
  const key = `${want} -> ${got.verdict}`
  s.matrix[key] = (s.matrix[key] ?? 0) + 1
}

// Headline numbers: the default-options variants, without the division spelling
// (value written as printed percent / 100, which has its own row below).
const main = cases.filter((c) => c.suite === 'variants-default' && !c.id.endsWith('::as-printed-div100'))
const div100 = cases.filter((c) => c.suite === 'variants-default' && c.id.endsWith('::as-printed-div100'))
const verdictOf = new Map(cases.map((c) => [c.suite + '|' + c.id, judge(c).verdict]))
const kit = (c) => verdictOf.get(c.suite + '|' + c.id)
const notCarried = main.filter((c) => c.expected.verdict === 'overstated' || c.expected.verdict === 'contradicted')
const carried = main.filter((c) => c.expected.verdict === 'supported')
const headline = {
  items: new Set(readJsonl(path.join(here, 'fda', 'items.jsonl')).map((i) => i.id)).size,
  documents: new Set(readJsonl(path.join(here, 'fda', 'items.jsonl')).map((i) => i.doc)).size,
  variantsDefault: suites['variants-default']?.total,
  mainVariants: main.length,
  notCarriedByOracle: notCarried.length,
  falsePasses: notCarried.filter((c) => kit(c) === 'supported').length,
  carriedByOracle: carried.length,
  carriedAndSupported: carried.filter((c) => kit(c) === 'supported').length,
  div100Variants: div100.length,
  div100Disagreements: div100.filter((c) => kit(c) !== c.expected.verdict).length,
  agreementDefault: suites['variants-default'] ? `${suites['variants-default'].agree}/${suites['variants-default'].total}` : null,
  agreementStrictPrecision: `${suites['variants-strictPrecision'].agree}/${suites['variants-strictPrecision'].total}`,
  agreementConservative: `${suites['variants-conservative'].agree}/${suites['variants-conservative'].total}`,
  agreementDeclared: `${suites.declared.agree}/${suites.declared.total}`,
  agreementCompleteSet: `${suites['complete-set'].agree}/${suites['complete-set'].total}`,
  agreementStrata: `${suites.strata.agree}/${suites.strata.total}`,
  slowestCaseMs: Math.round(maxMs * 10) / 10,
}

console.log('Field benchmark: FDA 510(k) summaries, kit judged against an independent oracle written from the README')
console.log('suite'.padEnd(26), 'agree'.padStart(11), '  disagreements by oracle -> kit')
for (const [name, s] of Object.entries(suites)) {
  const diff = Object.entries(s.matrix).filter(([k]) => k.split(' -> ')[0] !== k.split(' -> ')[1]).map(([k, n]) => `${k}: ${n}`).join('; ')
  console.log(name.padEnd(26), `${s.agree}/${s.total}`.padStart(11), ' ', diff || '-')
}
console.log()
console.log(`claims the counts do not carry (oracle overstated or contradicted): ${headline.notCarriedByOracle}; kit said supported: ${headline.falsePasses}`)
console.log(`claims the counts carry (oracle supported): ${headline.carriedByOracle}; kit said supported: ${headline.carriedAndSupported}`)
console.log(`value written as printed percent / 100: ${headline.div100Variants} variants; kit disagreed with the oracle on ${headline.div100Disagreements}`)
if (list) for (const d of disagreements) console.log('DISAGREE', JSON.stringify(d))

const expected = JSON.parse(fs.readFileSync(path.join(here, 'expected.json'), 'utf8'))
const failures = Object.entries(expected.headline).filter(([k, v]) => headline[k] !== v)
if (failures.length > 0) {
  for (const [k, v] of failures) console.error(`HEADLINE CHANGED ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(headline[k])}`)
  process.exit(1)
}
console.log(`\nAll ${Object.keys(expected.headline).length} headline numbers match bench/expected.json`)
