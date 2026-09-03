---
status: accepted
---

# Bound coverage to the resolved installation graph

Coverage-first discovery follows the active CLI, Gateway, Desktop runtime, selected state and config roots, includes, workspaces, agents, data stores, logs, services, plugins, skills, package resolution paths, source and build metadata, and every explicit External Installation Reference. It does not recursively crawl an entire home directory, unrelated projects, network mounts, or backup volumes. Symlinks and parent module-resolution paths are followed only as the actual runtime would resolve them, and inaccessible or excluded graph nodes become Coverage Gaps. This preserves causal coverage without turning the audit into an unbounded host search.
