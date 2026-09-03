---
status: accepted
---

# Use multidimensional findings without an aggregate score

Every Audit Finding has a stable identity and records component version, scope, configuration layer, redacted observation and baseline, Evidence Provenance, drift class and time perspective, Impact Severity, Evidence Confidence, causal status, intent status, downstream exposure, and repair side effects. All observed differences remain available while summaries only prioritize them. The auditor does not collapse these independent dimensions into an opaque aggregate score, avoiding false precision and allowing humans and automation to apply their own thresholds.
