# Findings, causality, and interactive reporting

An Audit Finding is not synonymous with an error. Preserve all observed drift while keeping these dimensions independent:

- component identity/version and Effective Scope;
- configuration layer and surface;
- operational versus upgrade time perspective;
- drift class;
- Impact Severity;
- Evidence Confidence;
- causal status;
- downstream exposure;
- intent status when known;
- possible repair side effects;
- evidence and baseline IDs;
- Coverage Gaps and conflicts.

Never calculate an opaque overall score. Summaries may prioritize without hiding low-severity, acknowledged, or coexisting drift.

The canonical schema requires every finding to carry component version, Effective Scope, configuration layer, surface, time perspective, lifecycle state, downstream exposure, and repair-side-effect assessment. Use explicit `unknown` states rather than omitting a dimension. Non-lifecycle findings use `lifecycleState: not-applicable`; `deprecated`, `replaced`, `removed`, and `no-op` are valid only with `driftClass: lifecycle-drift`. Each finding must reference at least one run-specific Observation with the same identity dimensions.

The Finalizer also binds every referenced Observation outcome to the Finding class. Concrete drift classes, including `runtime-service-incoherence`, require `outcome: drift`; `baseline-conflict` requires `conflict`; `unknown-baseline` requires `unknown`; and `coverage-gap` permits only `unknown` or `not-run`. `match` and `not-applicable` observations cannot support a Finding. Never relabel an unknown runtime binding as demonstrated service incoherence.

## Causal language

Use only:

- `confirmed-cause` — reproduction, trace, focused test, or unambiguous executed code path demonstrates the relationship;
- `probable-contributor` — contract, code path, and timing strongly support contribution;
- `plausible-cascade` — every graph edge has evidence, but practical confirmation is absent;
- `coexisting-drift` — visible difference with no supported connection to the symptom;
- `unassessed` — no causal evaluation was attempted.

Do not promote correlation, chronology, an issue report, or a successful command exit into root-cause proof.

## Completion output

Interactive output is the default and writes no report file. Lead with:

1. pinned target identity and observation window;
2. actual Capability Envelope;
3. examined data classes and all Coverage Gaps;
4. prioritized findings with independent impact/confidence/causality;
5. the exact source owner, component version, release channel, authority tier, and location used for each comparison;
6. positive, drift, conflict, and unknown Observations (a Finding-only report is incomplete);
7. Baseline Conflicts and Unknown Baselines;
8. relevant Compatibility Cascades and Migration Chains;
9. non-executing next actions.

Never call an audit “full” and never say “clean” without qualifying the exact coverage. State that the audit caused no intentional target mutation. If consistency markers changed, report the uncertainty.

Source-appropriate before/after markers prove stability only for the inputs explicitly listed in the canonical audit. They are not a byte-for-byte mutation proof for every protected root. A maintainer release gate must therefore record separately scoped, externally comparable target fingerprints and name every unmeasured surface.
