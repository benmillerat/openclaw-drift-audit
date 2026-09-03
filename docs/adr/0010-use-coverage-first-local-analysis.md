---
status: accepted
---

# Use coverage-first local analysis by default

The standard audit is a Coverage-First Audit: it locally scans every data class promised by the active release's declared coverage contract and records all exclusions and partial checks. The Target Architecture covers relevant configurations, includes, manifests, package state, services, source patches, prompt files, logs, memories, and transcripts. Deterministic parsers and scanners process complete files where possible; model disclosure follows the separately authorized data-class boundary, private content is neither exported nor unnecessarily reproduced, secrets remain technically redacted, and all content is Untrusted Evidence. Every run emits a Coverage Manifest and explicit Coverage Gaps. Metadata-Only Audit remains an optional restricted profile, while Forensic Deep Audit is an explicit higher-cost, higher-exposure profile for broader semantic analysis.

Public Preview 0.1 guarantees complete discovery and deterministic examination of installation- and configuration-relevant sources within its resolved Installation Graph. Logs, memories, and transcripts use Finding-Triggered State Analysis rather than blanket deep inspection. This narrower release contract does not discard the broader Target Architecture and may expand after evidence from real audits.
