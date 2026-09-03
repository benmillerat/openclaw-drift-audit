---
status: accepted
---

# Reconstruct relevant component migration chains

The auditor reconstructs a Migration Chain for OpenClaw and every directly audited component from the earliest supportable provenance through the installed version and the next compatible Upgrade Contract. It follows only changes relevant to observed options, ranges, defaults, recommendations, compatibility, and active migration windows, using release history, tagged source, package metadata, backups, and update evidence. A Skipped Migration Window is a first-class finding; Unknown Origin Version remains explicit. Historical transforms may be simulated only on isolated copies and are never replayed against live state during Audit.
