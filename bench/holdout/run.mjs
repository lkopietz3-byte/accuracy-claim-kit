// Runs the kit over the hand-labeled holdout claims and reports agreement with the labels.
//   node bench/holdout/run.mjs [--write]     --write saves results.jsonl next to this file
// claims.jsonl holds the counts and the declarations read from each source; labels.jsonl
// holds the verdict decided by hand from the README rules before the kit was run.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessAccuracyClaim } from '../../dist/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const readJsonl = (f) => fs.readFileSync(path.join(here, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const claims = readJsonl('claims.jsonl')
const labels = new Map(readJsonl('labels.jsonl').map((l) => [l.id, l]))

export function toInput(c) {
  const input = {
    claim: { metric: c.claim.metric, value: c.claim.value, display: c.claim.display },
    provenance: { source: c.declared.labelSource },
    sampling: c.declared.sampling,
  }
  if (c.counts !== null) {
    input.sample = { n: c.counts.n }
    if (c.counts.correct !== undefined) input.sample.correct = c.counts.correct
    else input.sample.errors = c.counts.errors
  }
  if (c.declared.sampling === 'complete' || c.declared.sampling === 'held-out-split') {
    input.benchmark = { name: c.declared.benchmark }
    input.claim.text = c.declared.namesSet ? `${c.declared.benchmark}: ${c.claim.display}` : `Our system scores ${c.claim.display}`
  }
  return input
}

// Informational codes never change a verdict; a label need not list them.
const INFO = new Set(['precision-too-fine', 'claim-worse-than-counts', 'strata-not-reweighted', 'text-figure-differs'])

const rows = []
for (const c of claims) {
  const label = labels.get(c.id)
  let got
  try {
    const r = assessAccuracyClaim(toInput(c))
    got = { verdict: r.verdict, reasons: [...r.reasons].sort() }
  } catch (e) {
    got = { verdict: 'THROW', reasons: [], error: `${e.name}: ${e.message}` }
  }
  const want = label ? { verdict: label.verdict, reasons: [...label.reasons].sort() } : null
  const agreeVerdict = want !== null && got.verdict === want.verdict
  const agreeReasons = agreeVerdict && JSON.stringify(got.reasons.filter((x) => want.reasons.includes(x) || !INFO.has(x))) === JSON.stringify(want.reasons)
  rows.push({ id: c.id, family: c.family, want, got, agreeVerdict, agreeReasons })
}

const total = rows.length
const agree = rows.filter((r) => r.agreeVerdict).length
const byFamily = {}
for (const r of rows) {
  const f = (byFamily[r.family] ??= { total: 0, agree: 0 })
  f.total += 1
  if (r.agreeVerdict) f.agree += 1
}
const matrix = {}
for (const r of rows) {
  const k = `${r.want?.verdict} -> ${r.got.verdict}`
  matrix[k] = (matrix[k] ?? 0) + 1
}
console.log(`holdout claims: ${total}; verdict agrees with the hand label on ${agree} of ${total}`)
console.log('by family:', Object.entries(byFamily).map(([k, v]) => `${k} ${v.agree}/${v.total}`).join('; '))
console.log('hand label -> kit:', JSON.stringify(matrix))
const dis = rows.filter((r) => !r.agreeVerdict)
for (const r of dis) console.log('DISAGREE', r.id, 'label', JSON.stringify(r.want), 'kit', JSON.stringify(r.got))
const reasonDis = rows.filter((r) => r.agreeVerdict && !r.agreeReasons)
console.log(`same verdict, different reason codes: ${reasonDis.length}`)
for (const r of reasonDis) console.log('REASONS', r.id, 'label', JSON.stringify(r.want.reasons), 'kit', JSON.stringify(r.got.reasons))
if (dis.length > 0) process.exitCode = 1 // a disagreement is a finding to explain, not a number to adjust
if (process.argv.includes('--write')) fs.writeFileSync(path.join(here, 'results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
