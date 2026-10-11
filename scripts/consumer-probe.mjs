// Imports the package by its name from an installed tarball (not a relative
// path into src/ or dist/) and exercises the real API the way a consumer
// would, asserting real outputs rather than just "it exports something."
import assert from 'node:assert/strict';
import {
  assessAccuracyClaim,
  cohenKappa,
  COMPARISON_TOLERANCE,
  DEFAULT_CONFIDENCE,
  DEFAULT_MIN_N,
  gwetAC1,
  maxDisplayDecimals,
  percentAgreement,
  wilsonInterval,
  zForConfidence,
} from 'accuracy-claim-kit';

assert.equal(DEFAULT_CONFIDENCE, 0.95);
assert.equal(DEFAULT_MIN_N, 30);
assert.equal(COMPARISON_TOLERANCE, 1e-12);
assert.ok(Math.abs(zForConfidence(0.95) - 1.959963984540054) < 1e-12);

// Wilson interval: known values, exact edges, documented errors.
const iv = wilsonInterval(81, 263);
assert.equal(Math.round(iv.low * 1e4) / 1e4, 0.2553);
assert.equal(Math.round(iv.high * 1e4) / 1e4, 0.3662);
assert.equal(wilsonInterval(0, 20).low, 0);
assert.equal(wilsonInterval(20, 20).high, 1);
assert.throws(() => wilsonInterval(5, 4), RangeError);
assert.throws(() => wilsonInterval('5', 10), TypeError);
assert.throws(() => wilsonInterval(5, 10, { confidence: 1 }), RangeError);

// Agreement: the textbook 50-proposal example has kappa 0.40.
const pairs = [
  ...Array(20).fill(['yes', 'yes']),
  ...Array(5).fill(['yes', 'no']),
  ...Array(10).fill(['no', 'yes']),
  ...Array(15).fill(['no', 'no']),
];
const kappa = cohenKappa(pairs);
assert.equal(kappa.status, 'defined');
assert.ok(Math.abs(kappa.value - 0.4) < 1e-12);
assert.equal(percentAgreement(pairs).value, 0.7);
assert.equal(gwetAC1(pairs).status, 'defined');
// An undefined statistic is a distinct result, never NaN.
const flat = cohenKappa([['a', 'a'], ['a', 'a']]);
assert.deepEqual([flat.status, flat.value, flat.reason], ['undefined', null, 'expected-agreement-is-1']);

// The verdicts.
const human = { source: 'human' };
const base = { provenance: human, sampling: 'random' };
const supported = assessAccuracyClaim({
  ...base,
  claim: { metric: 'accuracy', value: 0.98, display: '98%' },
  sample: { n: 1000, correct: 990 },
});
assert.equal(supported.verdict, 'supported');
assert.match(supported.suggestedStatement, /^At least 98\.16% accurate \(95% Wilson interval /);

const overstated = assessAccuracyClaim({
  ...base,
  claim: { metric: 'accuracy', value: 0.998, display: '99.8%' },
  sample: { n: 500, correct: 499 },
});
assert.equal(overstated.verdict, 'overstated');
assert.deepEqual(overstated.reasons, ['precision-too-fine']);

const contradicted = assessAccuracyClaim({
  ...base,
  claim: { metric: 'accuracy', value: 0.95 },
  sample: { n: 1000, correct: 900 },
});
assert.equal(contradicted.verdict, 'contradicted');

const refused = assessAccuracyClaim({
  claim: { metric: 'error-rate', value: 0.002, display: '0.2%' },
  sample: { n: 1000, errors: 2 },
  provenance: { source: 'model' },
  sampling: 'random',
});
assert.equal(refused.verdict, 'refused');
assert.deepEqual(refused.reasons, ['no-human-labels']);
assert.equal(refused.interval, null);

// No counts is a refusal, an unsupported metric is a refusal, a bound is read from its text.
const noCounts = assessAccuracyClaim({ ...base, claim: { metric: 'accuracy', value: 0.99, display: '99%+' } });
assert.deepEqual(noCounts.reasons, ['n-undisclosed']);
assert.equal(noCounts.n, null);
assert.deepEqual(
  assessAccuracyClaim({ ...base, claim: { metric: 'f1', value: 0.9 }, sample: { n: 100, correct: 90 } }).reasons,
  ['metric-not-supported'],
);
const ceiling = assessAccuracyClaim({
  ...base,
  claim: { metric: 'false-positive-rate', value: 0.01, display: 'no more than 1%' },
  sample: { n: 27743, errors: 0 },
});
assert.equal(ceiling.verdict, 'supported');
assert.deepEqual(ceiling.parsedDisplay, { form: 'ceiling', figure: 0.01, decimals: 0 });
// An honest report of the observed rate is supported; the strict option restores the old rule.
const honest = { ...base, claim: { metric: 'accuracy', value: 0.95, display: '95%' }, sample: { n: 1000, correct: 950 } };
assert.deepEqual(assessAccuracyClaim(honest).reasons, ['matches-observed-rate']);
assert.equal(assessAccuracyClaim(honest, { conservative: true }).verdict, 'overstated');

// A whole fixed set is compared with the exact count, not an interval.
const census = assessAccuracyClaim({
  claim: { metric: 'accuracy', value: 0.799, display: '79.9%', text: 'Reaches 79.9% on the Ridgeview set' },
  sample: { n: 50000, correct: 39950 },
  provenance: { source: 'human' },
  sampling: 'complete',
  benchmark: { name: 'Ridgeview set' },
});
assert.equal(census.verdict, 'supported');
assert.equal(census.basis, 'census');
assert.equal(census.interval, null);
// Stratified without strata, and a stale evaluation, are refused.
assert.deepEqual(
  assessAccuracyClaim({ ...base, sampling: 'stratified', claim: { metric: 'accuracy', value: 0.9 }, sample: { n: 1000, correct: 990 } }).reasons,
  ['stratified-without-strata'],
);
assert.deepEqual(
  assessAccuracyClaim(
    { ...base, claim: { metric: 'accuracy', value: 0.9 }, sample: { n: 1000, correct: 990 }, evaluatedAt: '2024-01-01' },
    { maxAgeDays: 365, now: '2026-10-10' },
  ).reasons,
  ['evaluation-stale'],
);

// Malformed input throws; it never returns a verdict.
assert.throws(
  () => assessAccuracyClaim({ ...base, claim: { metric: 'accuracy', value: Number.NaN }, sample: { n: 100, correct: 90 } }),
  RangeError,
);
assert.throws(() => assessAccuracyClaim(null), TypeError);

assert.equal(maxDisplayDecimals(0.0109), 0);
assert.equal(maxDisplayDecimals(0.001), 2);
