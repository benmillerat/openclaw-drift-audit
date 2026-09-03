---
status: accepted
---

# Compare four configuration layers

Every audit distinguishes Authored Configuration, a non-persisted Normalized Configuration, Effective Configuration, and State Overlays. Findings retain the layer and provenance of each observed value so that stale authored keys, migration effects, defaults, inheritance, inactive no-ops, and session or automation overrides cannot be collapsed into one misleading configuration dump. This requires more acquisition and comparison work but is necessary to identify both the origin and the actual behavioral effect of drift.
