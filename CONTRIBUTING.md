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
