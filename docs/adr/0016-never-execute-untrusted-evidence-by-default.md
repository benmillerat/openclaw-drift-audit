---
status: accepted
---

# Never execute untrusted evidence by default

Coverage-First Audit uses Non-Executing Analysis for plugin source, manifests, package state, logs, memories, transcripts, documentation, issues, pull requests, and all other Untrusted Evidence. Dynamic plugin imports, lifecycle scripts, builds, package operations, and commands embedded in findings or prose are prohibited; subagents receive a fixed capability boundary and cannot broaden the active Audit Profile. Already running behavior may be observed through an approved read-only probe. Any necessary component execution moves to a separately authorized Runtime Analysis Profile isolated from secrets and writable installation state.
