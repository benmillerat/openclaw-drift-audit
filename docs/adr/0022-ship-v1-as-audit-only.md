---
status: accepted
---

# Ship the first public release as an audit-only skill

Public Preview 0.1 inventories, analyzes, classifies, and reports while prohibiting intentional direct mutation of the canonically resolved Installation Target and every known mutating command. It may produce a Repair Handoff describing exact targets, proposed granular changes, expected side effects, validation criteria, and rollback boundaries. That handoff is data, not authorization and not an executable instruction.

Any actual configuration edit, migration, cleanup, package change, service action, restart, or invocation of a mutating native repair command belongs to a separate repair skill or explicitly initiated repair workflow. Separately approved exports, Source Evidence Cache updates, and snapshots may write only outside the canonically resolved Installation Target with their destinations and retention disclosed. Possible Incidental Probe Effects do not become repairs, but must be disclosed before authorization. This separation makes the audit-only promise understandable and testable, prevents untrusted findings or fix hints from crossing an execution boundary, and allows repair permissions and safeguards to evolve independently.
