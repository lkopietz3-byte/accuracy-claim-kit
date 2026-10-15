// Shared harness for the "grows linearly" tests. Wall-clock time on a shared CI
// runner is noisy, so these tests read process CPU time and keep the best of a
// few runs, which drops the runs that a neighbor or the garbage collector
// slowed down. regressions.test.ts proves that the same harness still fails a
// quadratic function at the same limit.

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

/**
 * Growth ratios at or above this fail, for a 4x step in input size. Linear code
 * reads about 4 and quadratic code about 16, so 10 sits between them. The
 * "hostile:F1 the growth harness still fails a quadratic function" test in
 * regressions.test.ts proves the limit still catches a quadratic function, so it
 * cannot be loosened into a check that passes everything.
 */
export const GROWTH_LIMIT = 10

/**
 * Why each measurement repeats the work: process.cpuUsage() counts CPU in
 * scheduler ticks of 1 to 4 ms on a Linux runner, so a call that costs a few
 * milliseconds is mostly tick rounding and fixed overhead. CI failures that led
 * to this harness (GitHub Actions, one call or a fixed 40 calls per run):
 *   - Node 26.3.0: the meta-test's quadratic function read 9.07 against a limit
 *     of 10 ("expected 9.068391345249294 to be greater than or equal to 10").
 *   - Node 20.19.0: a linear function read 7.9 in an earlier round.
 * Repeating the call until the small input costs at least MIN_SECONDS of CPU
 * makes the rounding error a few percent and leaves the ratio unchanged,
 * because both sizes repeat equally.
 */
const MIN_SECONDS = 0.06
const MAX_REPEATS = 100_000
const RUNS = 5
/** Guards the division when the smaller input is almost free. */
const FLOOR_SECONDS = 0.002

/** Best-of-`runs` CPU seconds (user + system) for `repeats` calls of `fn`. */
export function cpuSeconds(fn: () => void, repeats = 1, runs = RUNS): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const before = process.cpuUsage()
    for (let k = 0; k < repeats; k++) fn()
    const used = process.cpuUsage(before)
    best = Math.min(best, (used.user + used.system) / 1e6)
  }
  return best
}

/**
 * CPU time at `big` over CPU time at `small` (a 4x step in the tests). `make(size)`
 * builds the input and returns the work to time, so building the input is not
 * timed. The work repeats until the small size costs at least MIN_SECONDS.
 */
export function growthRatio(make: (size: number) => () => void, small: number, big: number): number {
  const runSmall = make(small)
  const runBig = make(big)
  runSmall()
  runBig()
  // The fastest of a few warm calls in wall-clock time: a pause from another
  // process only makes a call look slower, so the minimum keeps the repeat count stable.
  let wall = Infinity
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    runSmall()
    wall = Math.min(wall, (performance.now() - started) / 1000)
  }
  const repeats = Math.min(MAX_REPEATS, Math.max(1, Math.ceil(MIN_SECONDS / Math.max(wall, 1e-6))))
  return cpuSeconds(runBig, repeats) / Math.max(cpuSeconds(runSmall, repeats), FLOOR_SECONDS)
}
