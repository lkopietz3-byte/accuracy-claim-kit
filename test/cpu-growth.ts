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

/** Runs that are timed per size: the best of three. */
export const GROWTH_TRIALS = 3

/**
 * The most the CPU time may grow when the input grows 4x. Linear growth reads
 * about 4 and quadratic growth reads 16, so 10 sits between them with room for
 * noise. The worst linear reading seen on a GitHub runner was 7.9 (Node 20.19.0,
 * 500 against 2000 characters, 10 calls per run, best of 4); Node 26 on a laptop
 * reads 3 to 5.
 */
export const GROWTH_LIMIT_FOR_4X = 10

/** The smallest CPU time, in ms, that a size may be measured as: it keeps a timer tick from inflating the ratio. */
export const GROWTH_FLOOR_MS = 2

/**
 * CPU time at `big` over CPU time at `small`. `makeRun(size)` builds the input
 * and returns the work to time, so building the input is not timed. Pick the
 * work per run so the small size takes at least ten milliseconds or so.
 */
export function growthRatio(makeRun: (size: number) => () => void, small: number, big: number): number {
  const t1 = Math.max(bestCpuMs(makeRun(small), GROWTH_TRIALS), GROWTH_FLOOR_MS)
  const t2 = bestCpuMs(makeRun(big), GROWTH_TRIALS)
  return t2 / t1
}
