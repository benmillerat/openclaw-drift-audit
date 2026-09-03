---
status: accepted
---

# Require verified provenance for every discovered component

Every discovered component receives a Component Provenance Record before a Dynamic Baseline is constructed. Discovery begins with evidence attached to the installed artifact: plugin and package identifiers, exact version or commit, manifest, persisted installation origin, registry metadata, integrity information, declared owner, repository and documentation links, release channel, and host or API compatibility. A repository or document found only by name similarity is not treated as official.

Bundled OpenClaw components are matched to the pinned host release. Registry, npm, ClawHub, Git, local-path, source-checkout, forked, and patched components retain their actual origin and revision. For forks and local components, their installed source is authoritative for observed behavior; upstream material is comparison evidence rather than a substitute baseline. If ownership or documentation cannot be verified, the auditor records an Unverified Component Source and an Unknown Baseline. It may still report evidence-supported schema, compatibility, integrity, and static-behavior findings, but it must not invent Recommendation Drift.
