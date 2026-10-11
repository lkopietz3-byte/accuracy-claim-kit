# Engineering contract

This package is pure TypeScript/ESM statistics on caller-supplied counts. It has no UI, storage, network, clock or randomness. The source entry is `src/index.ts`; the package export resolves to generated `dist/index.js`.

## Invariants and critical paths

- **Refusal is "cannot tell".** `assessAccuracyClaim` returns `refused` when a precondition fails (no human labels, ranked/convenience/unknown sampling, `n < minN`, merged strata that differ, known retractions not in the counts, a failed agreement gate). A refusal outranks any other verdict, lists every failed precondition, and returns no interval, so no number is there to quote.
- **Malformed input throws; it never produces a verdict.** `TypeError` for a wrong runtime type, `RangeError` for an unusable value. Nothing is coerced: strings are not numbers, `Number` objects are not numbers, `-0` is read as `0`.
- **Observed-rate allowance.** A point claim equal to the observed rate to its printed precision (`matchesObserved`) is `supported`; bounds, 0 and 1 (and `options.conservative`) never use it. Display forms are parsed in `src/display.ts` into one judged figure; the parsed form is returned.
- **Excess printed precision is informational** unless `options.strictPrecision` or `options.conservative` is set; a contradicted claim stays contradicted.
- **Every visible figure is judged by its form on every path.** A range is judged at its favorable end as a point; strict bounds exclude equality; a value more favorable than the printed figure is judged as its own point. The observed-rate exception runs before `contradicted`.
- **Undisclosed n is a refusal.** `sample` may be omitted; malformed or half-given counts throw.
- **Complete sets are exact.** With `sampling: 'complete'` there is no interval: the figure is compared with `k / n` by integer arithmetic (`src/census.ts`), a mismatch is `contradicted`, and the claim text must name the benchmark. Stratified sampling without strata is refused, never pooled silently.
- **Age and scope are declared, not read.** `evaluatedAt`, `options.now` and `options.maxAgeDays` are `YYYY-MM-DD` strings checked as real dates (`src/dates.ts`); the kit never reads a clock. Populations are identifiers compared after NFKC, lower-casing and whitespace folding (`src/text.ts`).
- **`claim-worse-than-counts` is informational.** It is appended when a figure is outside the 99.9% interval on the pessimistic side and never changes the verdict.
- **Lengths are validated.** Every captured array `length` goes through `readLength` (whole number, 0 to `MAX_ITEMS` = 10,000,000) before a loop uses it; a Proxy cannot make the kit spin or return `NaN` counts.
- **The printed figure is judged.** With a `display`, the more favorable of `value` and the parsed display is compared with the interval (`assessedValue`); a display that disagrees with `value` by more than half a unit of its last digit plus one ulp of the value throws, judged exactly on the double's value (`src/exact.ts`), with no float tolerance. Decimal digits are range-checked (0 to 100) before conversion. `assessedValue` is set before refusals.
- **Inputs are read once.** Each caller property is read exactly once into a local before any judgment; no key enumeration, no `toJSON`, no `then`. Arrays are walked by index with `length` read once.
- **Tolerance.** `COMPARISON_TOLERANCE` (1e-12, absolute, in proportions) is the only floating-point slack. It always favors the claimant: a claim within the tolerance of a limit is treated as being at it. Accuracy exactly at the lower limit is `supported`; exactly at the upper limit is `overstated`; error rate mirrors this. Do not widen it without re-deriving its reach: it exceeds the interval width only above about 1e15 items with a rate within about 1e-12 of 0 or 1 (an all-correct sample at `n = 2^53 - 1` has width about 4e-16).
- **Wilson interval.** Lower limit `s^2 / (n (A + B))` (no cancellation); upper limit `(A + B) / (n + z^2)` up to the midpoint and `1 - lower(n - s)` after it, so `s = 0` gives `low` exactly 0, `s = n` gives `high` exactly 1, and limits near 0 keep relative accuracy. `low <= point <= high` is enforced after computing.
- **Agreement statistics** use `BigInt` integer arithmetic and return a distinct `undefined` result (never `NaN`) when the formula has no value.
- **Bounds round cautiously** in statements and explanations: lower limits down, upper limits up, exactly (BigInt on the double's mantissa and exponent, no slack). Confidence labels are rounded down from the shortest decimal text and never print 100%.
- **No clock, no randomness** in `src/`. Test data that looks random comes from the seeded Python generator.

## Setup and verification

Declared dependencies are TypeScript, ESLint, Vitest and packaging tools in `package-lock.json`. For a clean environment use `npm ci`.

```sh
npm run verify
```

The verdict table (`test/verdict-table.test.ts`) is the regression record: honest inputs that must pass and bad inputs that must be flagged. Numeric vectors (`test/numerics.test.ts`) come from `test/fixtures/generate_vectors.py`, an independent standard-library implementation (60-digit decimal for Wilson, exact fractions for agreement, `NormalDist().inv_cdf` for z).

## Packaging

`scripts/verify-package.mjs` packs the build, installs the tarball into a clean project offline, imports every export, compares names with `api-surface.json`, runs `scripts/consumer-probe.mjs`, and type-checks `scripts/consumer-probe.mts` under strict NodeNext. It does not require a LICENSE file; the package is `UNLICENSED` and private until the owner chooses a license.
