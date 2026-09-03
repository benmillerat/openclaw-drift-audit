# Contributing

OpenClaw Drift Audit is a security-sensitive Public Preview. Small, evidence-backed changes are easier to review than broad rewrites.

## Before contributing

No open-source license has been selected yet. Until a `LICENSE` file is added, please discuss proposed third-party contributions in an issue and do not submit substantive code under an assumed license.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

Requirements:

- Node.js 22.13 or newer;
- Git;
- no package installation is required for the current test suite.

Run the complete local checks:

```sh
npm test
find scripts -type f -name '*.mjs' -print0 | xargs -0 -n1 node --check
node scripts/fingerprint-skill.mjs --root .
```

## Safety invariants

Changes must preserve these boundaries:

- an audit never implies permission to repair;
- Offline Core does not execute OpenClaw, plugins, lifecycle scripts, or untrusted evidence;
- raw configuration, logs, memories, transcripts, identities, local paths, and secrets do not cross the deterministic redaction boundary;
- secrets are neither emitted nor hashed;
- missing evidence produces a Coverage Gap or Unknown Baseline;
- dynamic recommendations are tied to exact component version, channel, scope, and Operating Context;
- persistent output stays outside the canonically resolved Installation Target;
- `report.md` remains a pure rendering of canonical `audit.json`.

Never add a real user's configuration, database, log, memory, transcript, token, path, account identifier, or support bundle as a fixture. Build the smallest synthetic reproduction instead.

## Change process

1. Add or update a regression test that demonstrates the intended behavior.
2. Make the smallest safe implementation change.
3. Update the relevant reference and `CHANGELOG.md` when behavior or contracts change.
4. Add an ADR under `docs/adr/` for a durable architectural or safety decision.
5. Run the checks above and report any untested platform or installation dimension.

Pull requests should explain:

- the problem and evidence;
- the affected capability and data classes;
- security, privacy, and target-mutation implications;
- exact validation performed;
- new or remaining Coverage Gaps.
