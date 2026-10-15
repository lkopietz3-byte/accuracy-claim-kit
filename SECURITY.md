# Security policy

## Supported versions

Security fixes go to the latest minor version only. If a vulnerability affects an older minor version, upgrade to the latest minor first; there is no back-porting.

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub private vulnerability reporting on the repository: open https://github.com/lkopietz3-byte/accuracy-claim-kit/security/advisories/new, or use the "Report a vulnerability" button under the repository's Security tab. Please do not open a public issue or pull request for a vulnerability.

Include what you can: the affected version, a minimal reproduction, and the impact you expect.

## Input handling

The kit reads caller-supplied objects, arrays and strings. Every property is read once, nothing is evaluated, no regular expression runs over unbounded input (a percent string longer than 64 characters is rejected before matching), and loops are linear in the input size (the benchmark-name matcher reads only the characters next to each match; label and stratum names are capped at 1000 characters, the label table at 1,000,000 distinct labels, benchmark and population names at 200, claim text at 2000). Strings that are echoed into a statement or explanation (benchmark name, population identifiers, stratum names), and the claim text the kit scans for figures (it is never quoted whole), may not contain control characters (the horizontal tab excepted), line or paragraph separators, or bidirectional embedding, override and isolate characters, because those can reorder or hide the text around them. Malformed input throws instead of returning a verdict.

## Prototype pollution

Properties of caller objects are read the ordinary way, so inherited fields count (a class instance carrying its defaults works, and the tests pin it). The kit therefore cannot tell a field supplied by the caller from one supplied by a polluted `Object.prototype`: with `Object.prototype.minN = 1` and an `options` object, `minN` reads as 1. The kit does not defend against that, because a process whose built-in prototypes are attacker-controlled is already compromised. Keep untrusted JSON away from merge helpers that write to `__proto__`, or call `Object.freeze(Object.prototype)` at startup. A `__proto__` key made by `JSON.parse` is an own key, not a pollution, and the kit rejects it as an unknown key.

## Bug bounty

There is no bug bounty program for this project.
