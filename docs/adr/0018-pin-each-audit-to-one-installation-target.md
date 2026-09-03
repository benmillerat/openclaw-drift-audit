---
status: accepted
---

# Pin each audit to one installation target

Before delegation, the coordinator creates an immutable target manifest for one Installation Target. Every CLI, running Gateway, service definition, config, state, workspace, build, and source or package identity is either explicitly bound by evidence or explicitly unresolved. Subagents receive that same manifest and never merge identities implicitly. Public Preview 0.1 can pin a user-selected static package/config/state combination; it must label unobserved service, Gateway, desktop, and external-workspace bindings as Coverage Gaps rather than treating a lone PATH package as proof. Mismatches within an evidence-bound target become Runtime-Service Incoherence; other discovered installations remain separate Shadow Installations checked for resolution and service influence but do not receive full content analysis unless active or explicitly selected. This prevents evidence from different installations from producing fictitious drift.
