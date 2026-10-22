// Strict NodeNext type probe: compiled (never run) by scripts/verify-package.mjs
// against the installed .d.ts files, the way a TypeScript consumer's own
// tsconfig (strict, NodeNext) would see this package. No @types/node here,
// so no `node:` imports.
import {
  assessAccuracyClaim,
  cohenKappa,
  gwetAC1,
  percentAgreement,
  wilsonInterval,
  type AccuracyAssessment,
  type AccuracyClaimInput,
  type AccuracyVerdict,
  type Benchmark,
  type PopulationScope,
  type AgreementResult,
  type ReasonCode,
  type UnsupportedMetric,
  type WilsonInterval,
} from 'accuracy-claim-kit';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const iv: WilsonInterval = wilsonInterval(490, 500, { confidence: 0.9 });
const low: number = iv.low;
assertEqual(low < iv.point && iv.point < iv.high, true, 'interval ordering');

const pairs: [string, string][] = [['a', 'a'], ['a', 'b'], ['b', 'b']];
const results: AgreementResult[] = [percentAgreement(pairs), cohenKappa(pairs), gwetAC1(pairs, { categories: 3 })];
for (const r of results) {
  if (r.status === 'defined') {
    const v: number = r.value;
    assertEqual(Number.isNaN(v), false, 'defined value');
  } else {
    const v: null = r.value;
    assertEqual(v, null, 'undefined value');
    assertEqual(typeof r.reason, 'string', 'reason');
  }
}

const input: AccuracyClaimInput = {
  claim: { metric: 'error-rate', value: 0.02, display: '2%' },
  sample: { n: 1000, errors: 10 },
  provenance: { source: 'human', raters: 2, agreement: cohenKappa(pairs) },
  sampling: 'stratified',
  strata: [{ name: 'all', n: 1000, errors: 10 }],
  retractions: { count: 0, includedInSample: true },
};
const out: AccuracyAssessment = assessAccuracyClaim(input, { confidence: 0.95, minN: 30, minAgreement: 0.1 });
const verdict: AccuracyVerdict = out.verdict;
const benchmark: Benchmark = { name: 'Ridgeview set' };
const scope: PopulationScope = { claimed: 'support emails', evaluated: 'support emails' };
const scoped: AccuracyAssessment = assessAccuracyClaim({
  claim: { metric: 'accuracy', value: 0.9, text: 'Ridgeview set' },
  sample: { n: 100, correct: 90 },
  provenance: { source: 'automated' },
  sampling: 'complete',
  benchmark,
  population: scope,
  evaluatedAt: '2026-10-01',
}, { maxAgeDays: 30, now: '2026-10-10', requireScope: true });
const basis: 'wilson-interval' | 'census' | 'none' = scoped.basis;
assertEqual(basis, 'census', 'basis');
const codes: ReasonCode[] = out.reasons;
assertEqual(typeof verdict, 'string', 'verdict type');
assertEqual(codes.length > 0, true, 'reasons');
const bound: number | null = out.conservativeBound;
assertEqual(bound === null || bound > 0, true, 'bound');

// The README's TypeScript example: the evidence is hoisted into a const with `satisfies`, so the
// literal types ('human', 'random') are kept, and the input is annotated as AccuracyClaimInput.
const evidence = {
  sample: { n: 1000, correct: 990 },
  provenance: { source: 'human' },
  sampling: 'random',
} satisfies Pick<AccuracyClaimInput, 'sample' | 'provenance' | 'sampling'>;
const readmeInput: AccuracyClaimInput = { claim: { metric: 'accuracy', value: 0.98, display: '98%' }, ...evidence };
assertEqual(assessAccuracyClaim(readmeInput).verdict, 'supported', 'README example verdict');

// Every public result type is importable from the package root, UnsupportedMetric included.
const refusedMetric: UnsupportedMetric = 'f1';
const refused: AccuracyAssessment = assessAccuracyClaim({
  claim: { metric: refusedMetric, value: 0.9 },
  sample: { n: 100, correct: 90 },
  provenance: { source: 'human' },
  sampling: 'random',
});
const echoedMetric: AccuracyAssessment['metric'] = refused.metric;
assertEqual(echoedMetric, 'f1', 'unsupported metric echoed');
