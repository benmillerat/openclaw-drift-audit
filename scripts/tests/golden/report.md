# OpenClaw Drift Audit

Public Preview schema: `0.1.1`
Run: `run-fixture`
Observation window: 2026-09-03T00:00:00.000Z to 2026-09-03T00:00:00.000Z
Profiles: `offline-core`
Export mode / delivery: `portable-redacted` / `interactive-stdout`

## Installation target

- Discovery status: `selected`
- Config: `$CONFIG/openclaw.json`
- Selected package: `$PACKAGE`
- Version / installation: `2026.8.2` / `source-checkout`
- Intentional target mutation: `false`
- Network used: `false`
- Persistent export artifacts: `false`

## Capability envelope

| Capability | Status |
|---|---|
| config-resolution | verified |

## Declared budgets

| Budget | Limit | Used | Status |
|---|---:|---:|---|
| ioBytes | 1048576 | 4096 | within-budget |
| semanticItems | 100 | 1 | within-budget |
| timeMs | 60000 | 25 | within-budget |

## Operating context

- Context: `context:fixture`
- Status: `partial`
- Unknown material facts: `1`

## Coverage

| Data class | Status | Model disclosure | Semantic authorization |
|---|---|---|---|
| configuration | examined | allowlisted-redacted-structure | not-requested |

### Coverage gaps

None recorded.

## Baselines and sources

- Sources recorded: `1`
- Dynamic baselines recorded: `1`
- Network Freshness used: `false`

### Source inventory

| Source | Component | Version / channel | Claim | Authority | Owner | Location | Retrieved |
|---|---|---|---|---|---|---|---|
| `source:fixture` | `openclaw:2026.8.2` | `2026.8.2` / `stable` | recommendation | normative | OpenClaw | `official-tag` | 2026-09-03T00:00:00.000Z |

### Unknown or conflicting baselines

None recorded.

## Observations

| Observation | Outcome | Component | Version | Scope | Layer | Surface | Observed | Baseline | Evidence sources |
|---|---|---|---|---|---|---|---|---|---|
| `observation:fixture` | drift | `openclaw:2026.8.2` | `2026.8.2` | `global` | authored | `/agents/defaults/timeoutSeconds` | Configured timeout | Recommended timeout | `source:fixture` |

## Findings

| Finding | Drift class | Perspective | Layer | Impact | Confidence |
|---|---|---|---|---|---|
| `finding:aa091bbe6b8a9f56cc0253de` | recommendation-drift | operational | authored | medium | high |

### Timeout differs from recommendation

- Key: `finding:aa091bbe6b8a9f56cc0253de`
- Component: `openclaw:2026.8.2`
- Component version: `2026.8.2`
- Scope: `global`
- Layer / perspective: `authored` / `operational`
- Surface: `/agents/defaults/timeoutSeconds`
- Classification: `recommendation-drift`
- Lifecycle: `not-applicable`
- Impact / confidence: `medium` / `high`
- Causality: `coexisting-drift`
- Intent: `unacknowledged`
- Downstream exposure: `unknown` — No downstream exposure was established.
- Repair side effects: `unknown` — Repair effects were not evaluated.

The configured timeout is outside the version-matched recommendation.

## Migration chains

None recorded.

## Causal and compatibility links

None recorded.

## Repair handoffs

No repair handoff was requested.

## Evidence boundary

- Config scalar disclosure policy: `allowlist-plus-secret-deny`
- Raw model-visible values: `false`
- Secret values hashed: `false`

## Consistency-marker scope

- Source-appropriate markers recorded: `0`
- Stable markers: `0`
- Unstable markers: `0`
- These markers cover the inputs named in `audit.json`; they are not a byte-for-byte fingerprint of every protected target root.

## Diagnostics

None recorded.

This report is derived from audit.json. It does not authorize repairs and does not assign a global pass/fail score.
