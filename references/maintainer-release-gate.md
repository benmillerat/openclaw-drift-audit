# Public Preview release gate

Use this only when validating or publishing the skill. Public Preview 0.1 is not ready merely because fixtures pass.

## Required automated evidence

- Run `scripts/fingerprint-skill.mjs` before every forward/real-installation gate and verify the same tree hash afterward. A run that overlaps skill changes is a mixed snapshot and is invalid, even when its outputs parse.
- All shipped collector, finalizer, renderer, redaction, parser, include, discovery, provenance, dependency, and consistency capabilities have behavior tests.
- Fixtures cover the current verified Stable OpenClaw release and its immediate Stable predecessor.
- Adversarial cases cover secrets, credential-bearing URLs, absolute paths, prompt-injection text, include cycles and escapes, unsupported dependency selectors, concurrent change, and ambiguous installation selection.
- Repeated runs with injected run identity and time yield byte-identical canonical JSON and Markdown.
- Golden `audit.json` and its derived `report.md` are reviewed together; the report contains no independent evaluation logic.
- Every script passes syntax checks and the skill passes the Codex skill validator.

## Required real-installation evidence

Run at least two read-only macOS audits:

1. a package-managed installation;
2. a source checkout;
3. at least one of the two must be aged, customized, patched, or otherwise non-pristine.

For each run record the exact OpenClaw version/build, installation kind, platform, enabled capabilities, examined data classes, Coverage Gaps, elapsed time, output size, and externally comparable before/after target fingerprints. Define the fingerprint scope before the run and report every excluded surface. Collector consistency markers alone are insufficient because they cover only named audit inputs and use source-appropriate semantics. A dirty checkout is a valid fixture condition; do not clean it for the test.

The audit must not alter the target fingerprints. An output written for testing must use a temporary path outside every target root and be deleted by the maintainer after review.

## Verification labels

Apply `verified` only to the capability × version × platform × installation-kind combinations actually exercised. Other combinations are `supported-unverified`, `partial`, or `not-run`, as the evidence warrants. Linux, Windows, Nix, and containers are not verified by the initial macOS gate.

Do not promise a stable `1.0` schema until real audits across multiple differently aged installations have validated the data model. Keep the release labeled `0.1` or `public preview`.
