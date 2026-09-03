---
status: accepted
---

# Cache source evidence rather than derived baselines

Baseline acquisition is hybrid. The auditor first uses matching authoritative material available in the pinned installation, may retrieve owner sources under Network Freshness, and may read immutable verified snapshots from an optional Source Evidence Cache outside the Installation Target. Updating that cache is a separately authorized persistence action. Entries are content-addressed and retain component identity, exact version or commit, release channel, owner and retrieval provenance, integrity, and retrieval time.

The cache never stores a finished Recommended Baseline as reusable truth. Every audit derives its Dynamic Baseline again from the matching source evidence, the current audit logic, and the current Operating Context Profile. Source age and unresolved freshness remain visible, and evidence from another version or release channel is not silently substituted. If no sufficiently authoritative matching source is available, the result remains an Unknown Baseline.
