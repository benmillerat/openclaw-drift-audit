---
status: accepted
---

# Do not persist audit results by default

The default Audit reports through the active interaction or stdout and does not create files. A persistent Canonical Audit Result, its derived Markdown report, repair handoffs, and historical comparison material require a separate Audit Export authorization. The Target Architecture distinguishes redacted Local and more strongly pseudonymized Portable Exports. Public Preview 0.1 intentionally implements only `portable-redacted`: it aliases absolute paths and local identities and never uploads automatically. A future Local export needs a separate data contract and cannot be simulated by changing a label. This preserves the Offline Core no-write guarantee while allowing explicitly retained reports to support longitudinal drift comparison.
