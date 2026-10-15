# Contributing

This is a private, local package. There is no remote, CI or release workflow.

## Setup

```bash
npm ci
```

## Before you commit

```bash
npm run verify
```

`verify` runs lint, typecheck, tests, the build, and the packaging checks in one command. It must pass locally before you commit.

## Fixing a bug

A behavior fix needs a regression row in `test/verdict-table.test.ts` (or a vector in the numeric tests) that fails on the old code first. Write the test, confirm it fails against the current source, then make your fix and confirm it passes. Commit the test and the fix together, with a message that says what was wrong.

## Changing expected numbers

Expected values come from `test/fixtures/generate_vectors.py`, which uses only the Python standard library. Regenerate with `python3 -I test/fixtures/generate_vectors.py > test/fixtures/vectors.json`. Never hand-edit the JSON to make a test pass.

## Reference cross-check

`test/fixtures/reference.json` holds Wilson intervals, percent agreement, Cohen's kappa and Gwet's AC1 as computed by statsmodels, scipy, scikit-learn and irrCAC, and `test/reference.test.ts` requires the kit to match them to 1e-12. The file is written by `scripts/reference/gen.py` (developer tool, not shipped). To regenerate it:

```bash
python3 -m venv .venv-reference
.venv-reference/bin/pip install -r scripts/reference/requirements.txt
.venv-reference/bin/pip install --no-deps irrCAC==0.4.4   # irrCAC pins an old pandas
.venv-reference/bin/python -I scripts/reference/gen.py
```

The library versions are recorded in the file. Regenerating on newer versions is fine; a changed value is a reason to look, not to edit.

## Field benchmark

`npm run bench` runs the kit over the published-rate corpus in `bench/` and checks the headline numbers in `bench/expected.json` (see `bench/README.md`). `python3 -I bench/fda/build.py --subset` rewrites the small slice that `test/field-corpus.test.ts` runs on every commit.
