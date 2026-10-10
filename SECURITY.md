# Security policy

## Supported versions

This package is private and unpublished. Only the current commit on `main` is supported.

## Reporting a vulnerability

Report suspected vulnerabilities directly to the author (Lucas Kopietz) rather than in any shared channel. Include what you can: the commit, a minimal reproduction, and the impact you expect.

## Input handling

The kit reads caller-supplied objects, arrays and strings. Every property is read once, nothing is evaluated, no regular expression runs over unbounded input (a percent string longer than 64 characters is rejected before matching), and loops are linear in the input size. Malformed input throws instead of returning a verdict.

## Bug bounty

There is no bug bounty program for this project.
