# Configuration layers and dynamic baselines

Read this after Installation Discovery has pinned one target and discovered its components.

## Configuration layers

Keep four layers distinct:

1. **Authored Configuration** — what root and included files explicitly contain, including missing versus null versus set and source ownership.
2. **Normalized Configuration** — deterministic read-time compatibility transforms and canonicalization performed by the installed version. This layer never includes a config, session, state, or other persistent rewrite.
3. **Effective Configuration** — normalized values plus defaults, inheritance, activation, and scope resolution.
4. **State Overlay** — persisted session, automation, agent, or runtime state that changes behavior outside authored config.

Public Preview 0.1 measures Authored Configuration and `$include` resolution directly. Derive Normalized or Effective values only when exact installed-version source/schema evidence makes the derivation deterministic without running target code. Otherwise record a Coverage Gap. General State Overlay inspection is Target Architecture, not a preview promise.

Evaluate every materially different agent × channel × account × conversation boundary × workspace × plugin/tool policy scope. Group only scopes with identical relevant effective values and recommendation outcomes.

## Operating Context Profile

Recommendations must account for evidenced tenancy, exposure, sender trust, workload, latency/quality/cost/privacy priorities, hardware, and security posture. Derive safe facts locally. Ask only for unresolved facts that materially change a recommendation. If they remain unknown, present conditional scenarios or an Unknown Baseline rather than selecting a universal value.

## Build each Dynamic Baseline at audit time

Do not embed current defaults or recommended values in the skill. For each discovered component:

1. bind the exact installed identity and Release Channel;
2. find owner-verified, version-matched source evidence;
3. distinguish constraints, runtime defaults, explicit recommendations, examples, and upgrade expectations;
4. condition recommendations on the Operating Context Profile;
5. record source IDs, revisions, hashes, retrieval time, conflicts, and gaps in the Baseline Snapshot;
6. derive the baseline again for every audit, even when source snapshots are reused.

Every Source record is claim-specific: record component, version, release channel, applicable claim, authority tier, retrieval time, revision, and hash when available. A recommendation baseline may not be justified by a source recorded only for a runtime default, and a runtime default is not a recommendation. Established and conflicting baselines require claim-appropriate source IDs. An Unknown Baseline may carry `sourceIds: []` when no suitable source exists; the absence itself is part of the result.

Classify outcomes separately:

- `recommendation-drift` for deviation from an explicit applicable recommendation;
- `default-delta` for difference from a runtime default that is not itself recommended;
- `constraint-violation` for a value rejected by the installed contract;
- deprecated, replaced, removed, or accepted-but-no-op behavior as explicit lifecycle findings;
- `baseline-conflict` for unresolved authoritative contradictions;
- `unknown-baseline` when evidence is insufficient.

## Relevant Migration Chain

Reconstruct history only for observed config/component surfaces. Trace the earliest credible origin, installed version, and next channel-compatible upgrade. Distinguish introduction, rename, default change, recommendation change, deprecation, removal, and no-op compatibility. Treat these lifecycle mechanisms separately:

- pure read-time compatibility normalization, which may contribute to Normalized Configuration;
- Doctor-planned or Doctor-committed config migration;
- automatic startup config repair, which may persist a replacement config;
- startup session or shared-state migration, which may rewrite stores independently of authored config.

For the installed release, statically follow the relevant non-test migration modules from the deprecation contract, Doctor legacy-config registry, `src/config/legacy*` and config migration modules, session startup migration modules, `src/infra/state-migrations*` and related state migration modules, and verified plugin compatibility contracts. A source filename, deadline, current registry entry, or merged PR does not prove that code shipped or that the installation traversed it; verify containment and behavior in the relevant ordered release tags. If origin cannot be established, record `Unknown Origin Version`; if an old automatic migration window was skipped, record a Skipped Migration Window without replaying it.

Operational Drift compares the installed combination. Upgrade Drift compares only the next mutually compatible release on the intentionally selected channel. Stable never silently compares with extended-stable, beta, or dev; an untagged OpenClaw source branch is not presumed stable.

For OpenClaw versions that expose the 2026.8.2 contract, use only the official effective update channels `stable`, `extended-stable`, `beta`, and `dev`, and preserve whether config, installed version, Git tag/branch, or a default selected the channel. A plugin's SemVer prerelease label is not automatically an OpenClaw update channel; establish any plugin release channel from that component owner's versioned evidence or leave it unknown.
