---
status: accepted
---

# Prefer granular repairs over broad Doctor migration

Every Repair begins with the exact target, expected diff, side effects, backup, rollback boundary, and verification. Component-native targeted commands and validated OpenClaw config operations are preferred. Because Doctor repair combines structured handlers with legacy mutation paths and cannot be constrained like lint checks, doctor fix is treated as a separately approved Broad Migration; yes, force, restart, installation, and destructive SQLite modes are never implied by ordinary repair approval. Command success is insufficient: each change requires Repair Proof followed by a new drift comparison.
