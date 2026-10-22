# Contributing

accuracy-claim-kit is an MIT-licensed package. Contributions are welcome under the same license. Issues and pull requests go to https://github.com/lkopietz3-byte/accuracy-claim-kit.

## Setup

```bash
npm ci
```

## Before you commit

```bash
npm run verify
```

`verify` runs lint, typecheck, tests, the build, and the packaging checks in one command. It must pass locally before you commit, and CI runs the same checks on every pull request.

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

## Releases

Releases are made by the maintainer. A version is published only when a `v*` tag matching `package.json` is pushed: `.github/workflows/release.yml` then requires a successful `Verify` run on the tagged commit (so tag a commit that went through the pull request or `main` checks), runs the checks once and publishes with npm trusted publishing and `--ignore-scripts`, so the test suite does not run a second time. Every release after 0.1.0 goes only through `release.yml`; nobody runs `npm publish` by hand. Before tagging, update `CHANGELOG.md` and run `npm run verify`, `npm run attw` and `npm pack --dry-run`.

### First publish (0.1.0)

npm's documentation does not say whether a name that has never been published can be given a trusted publisher, so the first publish has two possible paths. Only the owner takes either one; an agent never runs `npm trust` or `npm publish`. The `README` links to `bench/` files under `blob/main`, which resolve once the release branch is merged to `main`.

1. Merge the release branch to `main`, push it and wait for `Verify` to pass on every job (the release job requires a green run for the tagged commit, so the branch push and the tag push are separate steps).
2. On tag day, try to set up trusted publishing first:

   ```bash
   npm trust github accuracy-claim-kit --file release.yml --repo lkopietz3-byte/accuracy-claim-kit --allow-publish --yes
   ```

   If that works, push the `v0.1.0` tag the same day. `release.yml` publishes 0.1.0 with provenance. (npm expires a trusted-publisher setting that has no successful publish within 2 days, so do not set it up and then wait.)
3. If npm refuses because the package does not exist, the owner runs `npm publish` once from a clean checkout of the tagged commit (`npm ci`, then `npm publish`; `prepublishOnly` runs `npm run verify`). That gives 0.1.0 no provenance. Do not set up trusted publishing yet: the next publish is 0.1.1, and npm expires a trusted-publisher setting that has no successful publish within 2 days. Push the `v0.1.0` tag; `release.yml` finds the version already on the registry and does nothing. Then, on the day of the 0.1.1 release (not the same day as the hand publish), the owner runs the `npm trust github` command above and pushes the `v0.1.1` tag straight away, so the setting is used at once and `release.yml` publishes 0.1.1 with provenance. From then on every version publishes from the tag with provenance.

A published `name@version` can never be reused, so fix forward with a new version.

## Security

Report vulnerabilities privately, as `SECURITY.md` describes, not in a public issue.
