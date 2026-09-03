---
status: accepted
---

# Describe support and completeness through observed capabilities

Public Preview 0.1 does not promise completeness based only on an operating system, installation method, or named audit profile. Every run records its actual Capability Envelope, the data classes discovered and examined, and all Coverage Gaps. No run receives a blanket `Full Audit` label.

The auditor adapts to local package installs, source checkouts, desktop bundles, Nix, containers, and other discovered topologies when the required evidence is accessible. A runtime-only connection to a remote Gateway remains partial. A redacted Evidence Bundle produced locally on that Gateway host can enable broader off-host analysis, but its manifest and omissions still determine coverage and it is always treated as Untrusted Evidence.

Verification is capability-specific rather than a promise to test the complete Cartesian product of versions, platforms, installation methods, and topologies. Each Capability Verification Claim covers only dimensions that can materially change that capability. The maintained fixtures include the current verified stable OpenClaw version and its immediate stable predecessor, plus a small set of representative end-to-end installations. Other versions are Best-Effort Versions: compatible rules may still run, but uncertain checks produce Coverage Gaps. Historical Migration Chains may extend beyond runtime fixtures when matching verified source evidence exists.

Platform and installation combinations receive `verified` status only after repeatable relevant tests. Untested combinations may be `supported-unverified` or `partial`; architectural intent and apparent compatibility are not evidence of verification.
