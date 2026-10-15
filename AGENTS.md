# accuracy-claim-kit - agent instructions

Does this accuracy or error-rate number have the evidence to carry it? Wilson intervals, inter-rater agreement (percent agreement, Cohen's kappa, Gwet's AC1) and a refuse-or-judge verdict on a claimed figure, computed from caller-supplied counts. Zero-dependency, offline TypeScript.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.
- `METHOD.md` gives the reason for every verdict and default; keep it in step with any change to a default or a verdict rule.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run attw` checks type resolution of the packed package.
- `npm run bench` re-runs the field benchmark, the heuristic rates and the holdout (needs `python3`); it fails if a pinned number in `bench/expected.json` moves.
- `npm run audit:dependencies` audits the lockfile (needs registry access).
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests, fixtures or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out. Never edit an expected value in `test/fixtures/vectors.json` by hand; regenerate it from `generate_vectors.py` and explain any change.
- The package is public and MIT. It is published only by pushing a `v*` tag, which runs `.github/workflows/release.yml` (trusted publishing, version-vs-tag check, already-published check). Never run `npm publish` by hand, and never push or tag without explicit permission. Treat a claim that a version is published as Reported until the registry confirms it.
- `package.json` `files` is `dist`, `README.md`, `METHOD.md`, `LICENSE`, `CHANGELOG.md` and nothing else; `scripts/verify-package.mjs` fails on any other file in the tarball.
- Runtime `dependencies` stay empty; add dev tooling only. No `node:` imports in `src/`.
- No clock and no randomness anywhere in `src/`.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Code Review Rules

- A refusal means "cannot tell", never "false". Fail only on positive evidence; malformed input throws and never returns a verdict or permission.
- Keep the claimant-favoring tolerance (`COMPARISON_TOLERANCE`) as the only place floating-point noise is absorbed when a claim meets an interval limit; `VALUE_NOISE` is the only allowance for reading a value as the decimal or count it was computed as. Rows exactly at each boundary stay in the verdict table.
- Validate every captured array length before looping, and judge the printed display as well as the value.
- Read every caller property once; never call `toJSON` or `then`. List the own keys of each caller object exactly once, only to reject an unknown key (a typo must throw, never switch a check off).
- Statements describe evidence only. They must never say the system is accurate, and bounds round in the cautious direction.
- A figure for a whole fixed set is compared with the exact count, never an interval; `automated` labels mean a deterministic procedure, never a model.
- Bounds (`99%+`, `<1%`) and absolute claims (0, 1) are never excused by matching the observed rate. Undisclosed counts refuse; they never throw or pass.
- Do not claim legal, regulatory or compliance status anywhere in docs or output. The kit checks evidence; it does not certify truth or compliance. `METHOD.md` may map checks to public frameworks, with the non-reliance language it already carries, and never says the kit makes anything compliant. Do not use the words "compliant" or "certified" about the kit or its verdicts.
