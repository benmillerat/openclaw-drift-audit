---
status: accepted
---

# Use source-appropriate consistency markers during live scans

Every audit records its Observation Window and applies a suitable Consistency Marker to mutable evidence according to the source's semantics. A stable configuration file may use a content hash, a database may use a transaction or snapshot marker when safely available, and an append-only log may use its file identity and observed byte range. Expected append-only growth after that range is not itself an inconsistency.

When a material consistency check fails, the auditor may reread that source at most once. Continued inconsistency becomes a Concurrent Mutation Gap. Exceeding a declared time, I/O, or semantic-analysis budget likewise produces a visible Coverage Gap and can never be interpreted as a clean result. Snapshot-Assisted Audit remains part of the Target Architecture for stronger point-in-time evidence. A general checkpoint and resume subsystem is optional and is not required for Public Preview 0.1.
