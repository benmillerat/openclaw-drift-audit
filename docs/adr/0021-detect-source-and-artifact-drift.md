---
status: accepted
---

# Detect local source and artifact drift

The audit compares locally used checkouts, patched packages, plugin files, service wrappers, extensions, executables, bundles, and runtime artifacts with the exact verified upstream revision or release artifact recorded by component provenance. Content and cryptographic evidence, not timestamps alone, establish Source Drift or Artifact Drift. Modified files and patch series remain visible even when OpenClaw appears operational, because downstream components may depend on assumptions changed by a local patch.

Generated, ignored, cached, and untracked files begin as Workspace State Deltas and are promoted only when dependency resolution, loading behavior, service configuration, build provenance, or other evidence connects them to the Installation Graph. Local modifications are not automatically defects. They may be covered by a bounded Intent Record, while unverifiable upstream or artifact identity produces an Unknown Baseline or Coverage Gap rather than a guessed clean state. Reports summarize and hash private diffs by default and do not export their raw contents without separate authorization.
