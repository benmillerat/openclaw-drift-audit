---
status: accepted
---

# Discover components before building dynamic baselines

The skill does not embed volatile OpenClaw or plugin defaults and does not special-case example plugins. Component Discovery first identifies what is installed, referenced, resolved, and active in the pinned Installation Target; only then does the auditor construct a Dynamic Baseline for each component from version-matched owner sources. CLI commands and flags are verified against the installed version before use, and Upgrade Drift uses current compatible releases only through Network Freshness. Every exported result retains a Baseline Snapshot, while unavailable exact sources remain Unknown Baselines or Coverage Gaps rather than being substituted with current prose.
