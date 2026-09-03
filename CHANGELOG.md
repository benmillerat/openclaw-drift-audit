# Changelog

All notable changes to this project are documented here. Dates use ISO 8601.

## [Unreleased]

### Added

- MIT License for the project and contributions.

### Fixed

- Include synthetic installed-package manifests required by dependency and collector tests in clean repository checkouts.

### Repository operations

- 2026-09-03: Added repository metadata and topics, enabled automatic branch cleanup, retained read-only Actions token permissions, and enabled Dependabot alerts and security updates.
- 2026-09-03: Confirmed that branch rulesets, secret scanning, push protection, and private vulnerability reporting require either public visibility or a GitHub plan upgrade for this repository; visibility remains private.
- 2026-09-03: Verified the documented Git clone installation in a clean Codex skills directory with all 91 tests and an exact skill-fingerprint match.

## [0.1.0] - 2026-09-03

### Added

- Public Preview Codex skill and UI metadata.
- Deterministic offline collector for installation, configuration, plugin, dependency, source, artifact, and migration evidence.
- Scoped evidence slicer for installation/configuration, component/dependency, and source/migration analysis roles.
- Closed `audit.json` schema `0.1.1` and deterministic `report.md` renderer.
- Portable-redacted persistent export with target write guards and transient semantic analysis input.
- Dynamic Baseline, Operating Context, Coverage Gap, Migration Chain, Compatibility Cascade, and non-executing Repair Handoff contracts.
- Regression fixtures for OpenClaw 2026.8.2 and its immediate stable predecessor 2026.8.1.
- Repository documentation, contribution guidance, private security reporting, issue forms, and least-privilege CI.

### Security

- Added allowlist-based disclosure, secret denial, path aliasing, private JSON Pointer identity aliasing, bounded parsers, query-only SQLite access, and fail-closed export validation.
- Prohibited target-code execution and native OpenClaw commands in the Preview Offline Core.

### Verified

- Passed 91 automated tests, 32 JavaScript syntax checks, the Codex skill validator, two macOS real-installation gates, independent forward testing, privacy canaries, and before/after target fingerprint checks.
