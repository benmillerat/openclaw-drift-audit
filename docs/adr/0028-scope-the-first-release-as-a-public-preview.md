---
status: accepted
---

# Scope the first public release as 0.1 Public Preview

The first public release is `0.1 Public Preview`, not a stable `1.0`. It implements Installation Discovery; configuration and include resolution; OpenClaw version, build, and plugin provenance; Dynamic Baselines; relevant Migration Chains; direct static Dependency Consistency Checks; the canonical `audit.json` and derived `report.md`; and non-executing Repair Handoffs.

Its Coverage-First contract completely examines installation- and configuration-relevant sources within the statically resolved portion of the Installation Graph. Unobserved service, running-Gateway, desktop-runtime, relative external-path, and other unavailable graph edges are explicit Coverage Gaps. Logs, memories, and transcripts receive Finding-Triggered State Analysis rather than blanket deep forensics. Persistent Source Evidence Cache management, Intent Ledger support, Live Probes, general Evidence Bundle workflows, Snapshot-Assisted Audit, Runtime Analysis, Local Export, and Forensic Deep Audit remain in the Target Architecture but are not release gates for 0.1.

The `0.x` schema and behavior remain explicitly evolvable. A stable `1.0` contract is considered only after audits on several real installations with materially different ages, histories, platforms, and installation shapes reveal which findings, evidence boundaries, and compatibility adapters remain stable.
