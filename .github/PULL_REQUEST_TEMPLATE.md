## Problem and evidence

Describe the observed problem and the evidence that supports this change.

## Change

Describe the smallest behavior or contract change made.

## Safety impact

- [ ] Audit-only and non-execution boundaries remain intact.
- [ ] No real configuration, identity, path, credential, log, memory, transcript, database, or audit artifact was added.
- [ ] New missing evidence is represented as a Coverage Gap or Unknown Baseline.
- [ ] Export and model-disclosure boundaries were considered.

## Validation

- [ ] Regression tests added or updated.
- [ ] `npm test` passes.
- [ ] All `.mjs` files pass `node --check`.
- [ ] Relevant real-installation or forward testing is described below.
- [ ] `CHANGELOG.md` and relevant references or ADRs were updated when required.

Validation details and remaining Coverage Gaps:
