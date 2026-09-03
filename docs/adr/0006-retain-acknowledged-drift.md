---
status: accepted
---

# Retain acknowledged drift in every report

The auditor may read an optional Intent Ledger containing bounded Intent Records for deliberate deviations, but it never suppresses the underlying drift. A matching record changes presentation to Acknowledged Drift; a changed value, component version, baseline, scope, or review date produces Expired Intent and requires renewed review. Creating or updating the ledger is a separately authorized write, preserving the default Audit contract while preventing intentional local patches and policy choices from being repeatedly mistaken for accidental residue.
