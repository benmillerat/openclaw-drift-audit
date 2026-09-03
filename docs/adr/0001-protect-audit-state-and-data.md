---
status: accepted
---

# Protect target state and private data during audits

The default Audit is separate from Repair and prohibits intentional direct mutation of the canonically resolved Installation Target and every command known to mutate it. Its Offline Core creates no intentional persistent artifacts, uses no network or live service probes, and executes no third-party component code. This is an intent-and-capability guarantee; a physical zero-write guarantee is claimed only when operating-system isolation has been demonstrated for the auditor and every child process.

Additional Network Freshness and Live Probe profiles require progressively broader authorization, and unavailable checks become Coverage Gaps rather than implicit passes. Known or plausible Incidental Probe Effects are disclosed before a Live Probe is authorized. A deterministic collector produces allowlisted, secret-redacted structures before adaptive evidence roles are delegated to subagents; the coordinator controls profile boundaries, prevents concurrent stateful probes, and is the only component that combines their redacted findings. This trades some convenience and diagnostic completeness for explicit side-effect boundaries, reduced secret exposure, and fewer audit-induced locks or compatibility cascades.
