---
status: accepted
---

# Limit model disclosure by audit run and data class

In the standard Coverage-First Audit, only a local deterministic scanner may process complete raw configuration, prompt, log, memory, transcript, source, and state contents selected by the active coverage contract. It emits allowlist-based, secret-redacted structures to the coordinator, main agent, and subagents; all of those models obey the same boundary. Unknown or unallowlisted values remain local and are represented only through safe structural metadata, hashes, types, counts, or locally derived signals. Public Preview 0.1 performs deep log, memory, and transcript processing only through Finding-Triggered State Analysis.

Any broader semantic disclosure requires one Semantic Disclosure Authorization for the particular audit run and data class. It is not requested separately for every excerpt. All models are treated as external unless their local execution, transport, storage, and telemetry boundary is demonstrably contained within the local trust domain. Secrets remain technically redacted under every profile and authorization.

The Coverage Manifest records each data class's local scan coverage, model-visible representation, authorization, and remaining gap. Public Preview 0.1 does not create a separate disclosure-manifest subsystem. Forensic Deep Audit is part of the Target Architecture and increases semantic depth only within the disclosure boundaries actually authorized.
