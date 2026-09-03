---
status: accepted
---

# Use audit.json as the canonical optional export

Public Preview 0.1 remains interactive by default and adds an optional machine-readable Audit Export. Its single canonical result is `audit.json`; `report.md` is generated from that result and is never an independent source of truth. Audit Run Identity, Audit Rule Identity, Semantic Finding Key, and Finding Observation are represented separately so that repeated observations can be compared without conflating execution, logic, conceptual condition, and current evidence.

The initial export schema uses an explicit `0.x` version and remains evolvable. Consumers must inspect the schema version rather than assume compatibility. Public Preview 0.1 defines no CI policy, pass/fail aggregation, or process exit-code contract. A stable `1.0` schema is considered only after audits on multiple real installations of materially different ages and shapes. Drift, conflicts, incomplete coverage, and run completion remain distinct data, allowing later automation to impose policy without retroactively changing audit semantics.
