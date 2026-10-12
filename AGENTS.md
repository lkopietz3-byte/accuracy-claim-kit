# accuracy-claim-kit - agent instructions

Does this accuracy or error-rate number have the evidence to carry it? Wilson intervals, inter-rater agreement (percent agreement, Cohen's kappa, Gwet's AC1) and a refuse-or-judge verdict on a claimed figure, computed from caller-supplied counts. Zero-dependency, offline TypeScript.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run attw` checks type resolution of the packed package.
- `npm run audit:dependencies` audits the lockfile (needs registry access).
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests, fixtures or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out. Never edit an expected value in `test/fixtures/vectors.json` by hand; regenerate it from `generate_vectors.py` and explain any change.
- The package is private and `UNLICENSED` until the owner picks a license. Do not add a LICENSE file, a repository field, or run `npm publish`, push, or tag without explicit permission.
- Runtime `dependencies` stay empty; add dev tooling only. No `node:` imports in `src/`.
- No clock and no randomness anywhere in `src/`.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Code Review Rules

- A refusal means "cannot tell", never "false". Fail only on positive evidence; malformed input throws and never returns a verdict or permission.
- Keep the claimant-favoring tolerance (`COMPARISON_TOLERANCE`) as the only place floating-point noise is absorbed. Rows exactly at each boundary stay in the verdict table.
- Validate every captured array length before looping, and judge the printed display as well as the value.
- Read every caller property once; never list keys, call `toJSON` or `then`.
- Statements describe evidence only. They must never say the system is accurate, and bounds round in the cautious direction.
- A figure for a whole fixed set is compared with the exact count, never an interval; `automated` labels mean a deterministic procedure, never a model.
- Bounds (`99%+`, `<1%`) and absolute claims (0, 1) are never excused by matching the observed rate. Undisclosed counts refuse; they never throw or pass.
- Do not add legal, regulatory or compliance claims anywhere in docs or output.
