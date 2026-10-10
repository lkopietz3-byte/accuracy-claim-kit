# Engineering contract

This package is pure TypeScript/ESM statistics on caller-supplied counts. It has no UI, storage, network, clock or randomness. The source entry is `src/index.ts`; the package export resolves to generated `dist/index.js`.

## Invariants and critical paths

- **Refusal is "cannot tell".** `assessAccuracyClaim` returns `refused` when a precondition fails (no human labels, ranked/convenience/unknown sampling, `n < minN`, merged strata that differ, known retractions not in the counts, a failed agreement gate). A refusal outranks any other verdict, lists every failed precondition, and returns no interval, so no number is there to quote.
- **Malformed input throws; it never produces a verdict.** `TypeError` for a wrong runtime type, `RangeError` for an unusable value. Nothing is coerced: strings are not numbers, `Number` objects are not numbers, `-0` is read as `0`.
- **Inputs are read once.** Each caller property is read exactly once into a local before any judgment; no key enumeration, no `toJSON`, no `then`. Arrays are walked by index with `length` read once.
- **Tolerance.** `COMPARISON_TOLERANCE` (1e-12, absolute, in proportions) is the only floating-point slack. It always favors the claimant: a claim within the tolerance of a limit is treated as being at it. Accuracy exactly at the lower limit is `supported`; exactly at the upper limit is `overstated`; error rate mirrors this. Do not widen it without re-deriving its reach: it exceeds the interval width only above about 1e15 items with a rate within about 1e-12 of 0 or 1 (an all-correct sample at `n = 2^53 - 1` has width about 4e-16).
- **Wilson interval.** Lower limit `s^2 / (n (A + B))` (no cancellation); upper limit `(A + B) / (n + z^2)` up to the midpoint and `1 - lower(n - s)` after it, so `s = 0` gives `low` exactly 0, `s = n` gives `high` exactly 1, and limits near 0 keep relative accuracy. `low <= point <= high` is enforced after computing.
- **Agreement statistics** use `BigInt` integer arithmetic and return a distinct `undefined` result (never `NaN`) when the formula has no value.
- **Bounds round cautiously** in statements: lower limits down, upper limits up, with 1e-7 of the last printed unit as slack for binary noise.
- **No clock, no randomness** in `src/`. Test data that looks random comes from the seeded Python generator.

## Setup and verification

Declared dependencies are TypeScript, ESLint, Vitest and packaging tools in `package-lock.json`. For a clean environment use `npm ci`.

```sh
npm run verify
```

The verdict table (`test/verdict-table.test.ts`) is the regression record: honest inputs that must pass and bad inputs that must be flagged. Numeric vectors (`test/numerics.test.ts`) come from `test/fixtures/generate_vectors.py`, an independent standard-library implementation (60-digit decimal for Wilson, exact fractions for agreement, `NormalDist().inv_cdf` for z).

## Packaging

`scripts/verify-package.mjs` packs the build, installs the tarball into a clean project offline, imports every export, compares names with `api-surface.json`, runs `scripts/consumer-probe.mjs`, and type-checks `scripts/consumer-probe.mts` under strict NodeNext. It does not require a LICENSE file; the package is `UNLICENSED` and private until the owner chooses a license.
