// Shared harness for the "grows linearly" tests.
//
// What it measures: process CPU time (user plus system) at a small input size and
// at a big one that is GROWTH_STEP (8) times larger, and the ratio between them.
// Linear code reads about 8, n log n code about 9 to 10, quadratic code about 64.
// GROWTH_LIMIT (20) sits well above the first two and well below the third.
// regressions.test.ts proves that the same harness still fails a quadratic
// function, so the limit cannot be loosened into a check that passes everything.
//
// Design (changed 2026-10-22):
//   - Interleaved samples. The harness alternates small, big, small, big, ... so
//     both sizes see the same machine noise. The earlier design measured every
//     small sample first and every big sample afterward, so a noisy neighbor that
//     arrived late hit only one size and moved the ratio.
//   - Best of each size. A neighbor or the garbage collector can only add CPU time
//     to a sample, never remove it, so the lowest sample per size is the closest
//     reading of the real cost.
//   - A measurable floor. process.cpuUsage() counts CPU in scheduler ticks of 1 to
//     4 ms on a Linux runner, so each sample repeats the call until the small
//     input costs at least 60 ms of CPU, which makes the tick rounding a few
//     percent. Both sizes repeat equally, so the ratio is unchanged.
//   - A wider step with one named limit. A 4x step separated linear code (4) from
//     quadratic code (16) by only 4x, and a limit of 10 left linear code a 2.5x
//     margin against noise. An 8x step separates them by 8x (8 against 64), so a
//     limit of 20 keeps the same 2.5x margin above linear code, passes n log n
//     code (9 to 10), and still fails quadratic code by more than 3x.
//
// CI failures that led to this design (GitHub Actions):
//   - Node 26.3.0: the meta-test's quadratic function read 9.07 against a limit
//     of 10 ("expected 9.068391345249294 to be greater than or equal to 10").
//   - Node 20.19.0: a linear function read 7.9 in an earlier round.
//   - Node 24, 2026-10-22: linear tests read 10.09, 10.36 and 10.33 against the
//     limit of 10 for a 4x step, after the repeat floor and best-of-5 were
//     already in place. The code under test was not growing faster; the two
//     sizes were measured at different moments and saw different noise.
//   - Three growth tests timed out at vitest's 5 s default under load on
//     2026-10-21, which is why GROWTH_TEST_TIMEOUT is explicit.

import { appendFileSync } from 'node:fs'

/** Times `work` once, in milliseconds of user plus system CPU time. */
export function cpuMs(work: () => void): number {
  const before = process.cpuUsage()
  work()
  const after = process.cpuUsage(before)
  return (after.user + after.system) / 1000
}

/** The smallest CPU time of `trials` timed runs after one untimed warm-up run. */
export function bestCpuMs(work: () => void, trials = 5): number {
  work() // warm up
  let best = Infinity
  for (let i = 0; i < trials; i++) best = Math.min(best, cpuMs(work))
  return best
}

/** Number of times bigger than the small size the big size must be. */
export const GROWTH_STEP = 8

/**
 * Growth ratios at or above this fail, for an 8x step in input size. Linear code
 * reads about 8, n log n about 9 to 10, quadratic about 64.
 */
export const GROWTH_LIMIT = 20

/**
 * Per-test timeout for growth tests. Each size is sampled ROUNDS times at a repeat
 * count that makes the small input cost at least MIN_SECONDS, and quadratic code
 * (the meta-test) costs 64x more at the big size, so one test can run for tens
 * of seconds on a slow runner. The ratio limit, not this timeout, is what
 * catches a regression.
 */
export const GROWTH_TEST_TIMEOUT = 300_000

/** The small input must cost at least this much CPU per sample. */
const MIN_SECONDS = 0.06
const MAX_REPEATS = 1_000_000
/** Interleaved (small, big) sample pairs; the lowest sample per size is kept. */
const ROUNDS = 5
/** Guards the division when the smaller input is almost free. */
const FLOOR_SECONDS = 0.002

/** CPU seconds (user + system) for `repeats` calls of `fn`. */
export function cpuSeconds(fn: () => void, repeats = 1): number {
  const before = process.cpuUsage()
  for (let k = 0; k < repeats; k++) fn()
  const used = process.cpuUsage(before)
  return (used.user + used.system) / 1e6
}

/**
 * Repeats of `fn` that cost at least MIN_SECONDS of CPU. Each step takes the lowest
 * of three samples (one slow sample must not stop the search early) and aims 50%
 * above the floor, so the best sample later is still above it.
 */
function calibrateRepeats(fn: () => void): number {
  let repeats = 1
  for (;;) {
    const used = Math.min(cpuSeconds(fn, repeats), cpuSeconds(fn, repeats), cpuSeconds(fn, repeats))
    if (used >= MIN_SECONDS * 1.5 || repeats >= MAX_REPEATS) return repeats
    // at most 16x per step: a sample that rounded to zero ticks says nothing about the true cost
    const scale = used > 0 ? Math.min(16, (MIN_SECONDS * 1.6) / used) : 16
    repeats = Math.min(MAX_REPEATS, Math.max(repeats + 1, Math.ceil(repeats * scale)))
  }
}

/**
 * CPU time at `big` over CPU time at `small`. `big` must be GROWTH_STEP times
 * `small`. `make(size)` builds the input and returns the work to time, so
 * building the input is not timed. Samples alternate small, big, small, big, ...
 * and the lowest CPU time per size is kept. Set GROWTH_LOG=<file> to append each
 * ratio to that file (vitest hides console output of passing tests).
 */
export function growthRatio(make: (size: number) => () => void, small: number, big: number, label = ''): number {
  if (big !== small * GROWTH_STEP) {
    throw new RangeError(`growth tests use a ${String(GROWTH_STEP)}x step; got ${String(small)} and ${String(big)}`)
  }
  const runSmall = make(small)
  const runBig = make(big)
  runSmall()
  runBig()
  let repeats = calibrateRepeats(runSmall)
  let bestSmall = Infinity
  let bestBig = Infinity
  for (let attempt = 0; attempt < 3; attempt++) {
    bestSmall = Infinity
    bestBig = Infinity
    for (let round = 0; round < ROUNDS; round++) {
      bestSmall = Math.min(bestSmall, cpuSeconds(runSmall, repeats))
      bestBig = Math.min(bestBig, cpuSeconds(runBig, repeats))
      // Quadratic code costs 64x more at the big size, so a failing function would take
      // minutes to sample 5 times. Stop once two rounds read more than twice the limit.
      if (round >= 1 && bestBig / Math.max(bestSmall, FLOOR_SECONDS) > 2 * GROWTH_LIMIT) break
    }
    // the calibration read slow or the machine sped up: the small sample is under
    // the floor, so repeat more and measure again
    if (bestSmall >= MIN_SECONDS || repeats >= MAX_REPEATS) break
    repeats = Math.min(MAX_REPEATS, Math.ceil(repeats * Math.min(4, (MIN_SECONDS * 1.3) / Math.max(bestSmall, 1e-4))))
  }
  const ratio = bestBig / Math.max(bestSmall, FLOOR_SECONDS)
  const logFile = process.env.GROWTH_LOG
  if (logFile) {
    appendFileSync(logFile, `growth ratio ${ratio.toFixed(2)} (repeats ${String(repeats)}, small ${(bestSmall * 1000).toFixed(1)} ms, big ${(bestBig * 1000).toFixed(1)} ms) ${label}\n`)
  }
  return ratio
}
