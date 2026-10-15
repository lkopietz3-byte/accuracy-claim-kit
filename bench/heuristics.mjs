// Measured rates for the kit's policy choices (see METHOD.md). Run by `npm run bench`.
//
//   node bench/heuristics.mjs            print the table and check bench/expected.json "heuristics"
//
// Two kinds of number, kept apart:
//   field   counted over the FDA corpus (bench/fda/cases.jsonl, written by build.py)
//   sim     simulated with a fixed-seed generator in this file (the kit itself uses no randomness)
// Every number is printed with its denominator.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessAccuracyClaim, wilsonInterval } from '../dist/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const cases = fs.readFileSync(path.join(here, 'fda', 'cases.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const strata = JSON.parse(fs.readFileSync(path.join(here, 'fda', 'strata.json'), 'utf8'))

const judge = (c) => assessAccuracyClaim(c.input, c.options)
const pick = (suite, variant) => cases.filter((c) => c.suite === suite && c.id.endsWith(`::${variant}`))
const out = {}
const rows = []
const add = (key, num, den, what) => {
  out[key] = `${num}/${den}`
  rows.push([key, `${num} of ${den}`, what])
}

// 1. Minimum sample size (default 30), over the printed rates.
const printed = pick('variants-default', 'as-printed')
const printedRes = printed.map((c) => judge(c))
add('minN30RefusedPrinted', printedRes.filter((r) => r.reasons.includes('sample-too-small')).length, printed.length, 'printed rates with n below 30, refused by the default minN')
add('n10to29', printed.filter((c) => c.input.sample.n >= 10 && c.input.sample.n < 30).length, printed.length, 'printed rates with n from 10 to 29 (the band a lower minN would let through)')

// 2. Observed-rate allowance: how many honest printed rates are supported only because of it.
const nonRefused = printedRes.filter((r) => r.verdict !== 'refused')
add('printedNotSupported', nonRefused.filter((r) => r.verdict !== 'supported').length, nonRefused.length, 'printed rates, not refused, that are not supported: all are 100% rates (k = n), which a sample cannot show')
add('printedSupported', nonRefused.filter((r) => r.verdict === 'supported').length, nonRefused.length, 'printed rates, not refused, judged supported')
add('printedMatchesObserved', nonRefused.filter((r) => r.reasons.includes('matches-observed-rate')).length, nonRefused.length, 'printed rates supported through matches-observed-rate (the rest sit at or below the lower limit)')

// 3. Precision rule (one tenth of the interval width), default, strict and conservative.
add('precisionTooFinePrinted', nonRefused.filter((r) => r.reasons.includes('precision-too-fine')).length, nonRefused.length, 'printed rates carrying precision-too-fine (informational by default)')
for (const [suite, key, what] of [
  ['variants-strictPrecision', 'strictPrecisionFlipsPrinted', 'printed rates supported by default that strictPrecision no longer supports'],
  ['variants-conservative', 'conservativeFlipsPrinted', 'printed rates supported by default that conservative no longer supports'],
]) {
  const rs = pick(suite, 'as-printed').map((c) => judge(c)).filter((r) => r.verdict !== 'refused')
  const flips = rs.filter((r, i) => r.verdict !== 'supported' && nonRefused[i].verdict === 'supported').length
  add(key, flips, nonRefused.filter((r) => r.verdict === 'supported').length, what)
}

// 4. claim-worse-than-counts (informational): stale or mistyped, pessimistic side.
const flagged = (variant) => pick('variants-default', variant).map((c) => judge(c)).filter((r) => r.verdict !== 'refused')
const fp = flagged('as-printed')
add('worseFlagOnPrinted', fp.filter((r) => r.reasons.includes('claim-worse-than-counts')).length, fp.length, 'honest printed rates flagged claim-worse-than-counts')
const fm = flagged('minus-5-points')
add('worseFlagOnMinus5', fm.filter((r) => r.reasons.includes('claim-worse-than-counts')).length, fm.length, 'rates printed 5 points too low that are flagged claim-worse-than-counts')

// 5. Rates claimed 3 points too high or as 100%: the kit's catch rate (false-pass check, by variant).
for (const v of ['plus-3-points', 'claim-100']) {
  const rs = flagged(v)
  add(`falsePass_${v}`, rs.filter((r) => r.verdict === 'supported').length, rs.length, `altered claims "${v}" the counts do not carry that were judged supported`)
}

// 6. Whole-fixed-set path: altered claims the exact count does not carry, judged supported.
const complete = cases.filter((c) => c.suite === 'complete-set' && c.id.endsWith('::named'))
const completeWrong = complete.filter((c) => c.expected.verdict !== 'supported' && c.expected.verdict !== 'refused')
add('completeSetFalsePasses', completeWrong.filter((c) => judge(c).verdict === 'supported').length, completeWrong.length, 'complete-set claims the exact count does not carry (named benchmark) judged supported')

// 7. Strata heterogeneity check over the pooled site tables.
const strataFlag = strata.filter((t) => {
  const r = assessAccuracyClaim({
    claim: { metric: 'accuracy', value: t.total[0] / t.total[1] },
    sample: { n: t.total[1], correct: t.total[0] },
    provenance: { source: 'human' },
    sampling: 'stratified',
    strata: t.strata.map((s, i) => ({ name: `s${i}`, n: s.n, correct: s.k })),
  })
  return r.reasons.includes('merged-strata-differ')
}).length
add('strataRefusedField', strataFlag, strata.length, 'published pooled site tables refused as merged-strata-differ (sites that really differ; not a false flag by itself)')

// Seeded generator for the simulations.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const binom = (rand, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k++; return k }

// 8. Strata check false-flag rate when every stratum has the same true rate.
{
  const rand = rng(20261014)
  let flagsN = 0
  let total = 0
  for (const k of [2, 3, 5]) for (const n of [50, 200, 1000]) for (const p of [0.8, 0.95]) {
    for (let rep = 0; rep < 250; rep++) {
      const st = []
      for (let i = 0; i < k; i++) st.push({ name: `s${i}`, n, correct: binom(rand, n, p) })
      const tot = st.reduce((a, s) => a + s.correct, 0)
      const r = assessAccuracyClaim({ claim: { metric: 'accuracy', value: tot / (n * k) }, sample: { n: n * k, correct: tot }, provenance: { source: 'human' }, sampling: 'stratified', strata: st })
      total += 1
      if (r.reasons.includes('merged-strata-differ')) flagsN += 1
    }
  }
  add('strataFalseFlagSim', flagsN, total, 'simulated stratified samples with equal true rates in every stratum that were refused as merged-strata-differ (k 2, 3, 5; n 50 to 1000 per stratum)')
}

// 9. Claims set at the conservative limit, and claims equal to the observed rate: how often the true rate is worse than the claim.
{
  const rand = rng(1014)
  let limitFalse = 0
  let limitTotal = 0
  let obsFalse = 0
  let obsTotal = 0
  for (const n of [50, 200, 1000]) for (const p of [0.6, 0.9, 0.99]) {
    for (let rep = 0; rep < 1000; rep++) {
      const k = binom(rand, n, p)
      const w = wilsonInterval(k, n)
      const lowPct = Math.floor(w.low * 1000) / 10 // lower limit, rounded down to 0.1 point
      limitTotal += 1
      if (p < lowPct / 100) limitFalse += 1
      const obsPct = Math.round((k / n) * 100) // honest report, whole percent
      obsTotal += 1
      if (p < obsPct / 100) obsFalse += 1
    }
  }
  add('limitClaimTrueRateBelowSim', limitFalse, limitTotal, 'simulated samples where the true rate is below a claim set at the lower end of the 95% interval')
  add('observedClaimTrueRateBelowSim', obsFalse, obsTotal, 'simulated samples where the true rate is below an honest whole-percent report of the observed rate (supported, but not a claim about the true rate)')
}

const w = Math.max(...rows.map((r) => r[0].length))
console.log('Heuristic rates (field = FDA corpus counts, sim = fixed-seed simulation)')
for (const [k, v, what] of rows) console.log(k.padEnd(w), v.padStart(12), ' ', what)

const expectedPath = path.join(here, 'expected.json')
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'))
if (process.argv.includes('--write')) {
  expected.heuristics = out
  fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n')
  console.log('wrote heuristics to expected.json')
} else {
  const bad = Object.entries(expected.heuristics ?? {}).filter(([k, v]) => out[k] !== v)
  const missing = Object.keys(out).filter((k) => !(expected.heuristics ?? {})[k])
  for (const [k, v] of bad) console.error(`HEURISTIC CHANGED ${k}: expected ${v}, got ${out[k]}`)
  for (const k of missing) console.error(`HEURISTIC NOT PINNED ${k}`)
  if (bad.length || missing.length) process.exit(1)
  console.log(`\nAll ${Object.keys(out).length} heuristic numbers match bench/expected.json`)
}
