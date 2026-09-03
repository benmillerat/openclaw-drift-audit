---
status: accepted
---

# Protect live service availability during deep inspection

The auditor never stops or restarts the Gateway as part of an Audit. Live databases are inspected serially through genuine read-only access with bounded lock waits and load checks; a check that encounters Audit Contention stops and becomes a Coverage Gap rather than retrying aggressively, rebuilding an index, or degrading the service. A complete follow-up may use an explicitly authorized Snapshot-Assisted Audit with private temporary storage and a declared retention outcome. Any maintenance window remains a separate operation.
