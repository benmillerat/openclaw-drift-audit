---
status: accepted
---

# Bound transitive dependency analysis

OpenClaw, its directly operated surfaces, and installed plugins receive full configuration and compatibility comparison. Every direct component receives a static Dependency Consistency Check across declared constraints, lockfile selections, installed package identities, integrity records, duplication or shadowing, and statically determinable resolution paths. This check does not attempt a blanket reconstruction of the entire effective runtime graph.

An Effective Resolution Analysis is required only when the consistency check exposes a concrete mismatch, observed symptoms implicate dependency loading, or evidence supports a Plausible Compatibility Cascade. Transitive dependencies otherwise remain limited to declared engine and peer compatibility, integrity, resolution, duplication or shadowing, and known advisories; they receive full component analysis only through Dependency Escalation. Runtime resolution that cannot be established safely and reliably is recorded as a Coverage Gap, never guessed. This keeps the mandatory pass bounded while preserving a path to diagnose downstream failures.
