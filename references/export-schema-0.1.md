# Public Preview 0.1 export

Export is optional. Public Preview 0.1 has exactly one truthful export mode: `portable-redacted`. A path-preserving local export is not implemented. Persistent export additionally requires an explicit destination and retention intent.

`audit.json` is the sole canonical result. `report.md` is deterministically derived from it and must not contain independent findings or logic. The schema is evolvable during `0.x`; consumers must inspect `schemaVersion`. There is no CI, policy, aggregate pass/fail, or exit-code contract.

See [audit-schema-0.1.json](audit-schema-0.1.json) for the structural contract.

## Separate identities

- Audit Run Identity identifies one execution and Observation Window.
- Audit Rule Identity identifies versioned check logic.
- Semantic Finding Key identifies the same conceptual condition across runs and excludes the observed value.
- Finding Observation records the concrete run-specific value/condition, baseline, evidence, and outcome.

## Analysis contract

The finalizer accepts only the recursively allowlisted analysis shape. Unknown analysis fields fail closed. Required records include the Operating Context Profile, declared budgets, claim-bound sources, version/context-bound baselines, multidimensional observations and findings, per-data-class Disclosure Authorization, Network Freshness state, and complete non-executable Repair Handoffs when requested. When Network Freshness is used, its RFC 3339 `retrievedAt` is validated and the canonical Audit Run Observation Window becomes the envelope of local collection and that recorded network-retrieval event; it must not remain a collector-only claim.

```json
{
  "operatingContext": { "id": "...", "status": "partial", "facts": [], "unknowns": [] },
  "budgets": {
    "timeMs": { "limit": 1, "used": 0, "status": "within-budget", "coverageGapId": null },
    "ioBytes": { "limit": 1, "used": 0, "status": "within-budget", "coverageGapId": null },
    "semanticItems": { "limit": 1, "used": 0, "status": "within-budget", "coverageGapId": null }
  },
  "capabilities": [],
  "disclosures": [],
  "sources": [],
  "baselines": [],
  "rules": [],
  "observations": [],
  "findings": [],
  "migrationChains": [],
  "coverageGaps": [],
  "unresolvedBaselines": [],
  "repairHandoffs": [],
  "networkFreshness": {
    "used": false,
    "authorized": false,
    "sourceClasses": [],
    "ownerDomains": [],
    "retrievedAt": null
  },
  "diagnostics": []
}
```

Established or conflicting baselines require claim-appropriate sources. An `unknown` baseline may intentionally carry an empty `sourceIds` array.

## Interactive stdout

Interactive output is the default and creates no file. A caller may stream an in-memory `{ "evidence": ..., "analysis": ... }` composite through both tools:

```sh
producer-of-approved-composite-json |
  node <skill-dir>/scripts/finalize-audit.mjs |
  node <skill-dir>/scripts/render-report.mjs
```

The canonical object still records `export.mode=portable-redacted`, with `delivery=interactive-stdout`, `retention=not-persisted`, and no directory fingerprint.

The slicer, finalizer, and renderer consume stdin asynchronously so ordinary OS pipes remain reliable even when Node marks a pipe non-blocking. Every stdin or file input is capped at 256 MiB; persistent inputs that change while being read fail closed.

## Persistent evidence → audit → report chain

Persistent output is permitted only as a same-directory chain of the three authorized artifacts: `evidence.json`, `audit.json`, and `report.md`. First the collector creates an authorized `portable-redacted` `evidence.json`. It records a salted fingerprint of that canonical directory, a complete target write guard, and retention intent. The allowlisted analysis should remain transient and is passed on stdin with `--analysis -`; it is not a fourth persistent export artifact. The finalizer accepts only an `audit.json` beside `evidence.json`, requires the same retention value, and propagates the directory fingerprint. The renderer accepts only a `report.md` beside that persistent `audit.json` with the same verified fingerprint.

```sh
node <skill-dir>/scripts/collect-evidence.mjs \
  <explicit-target-arguments> \
  --output /approved/export/evidence.json \
  --retention delete-after-review

producer-of-approved-analysis-json | \
node <skill-dir>/scripts/finalize-audit.mjs \
  --evidence /approved/export/evidence.json \
  --analysis - \
  --output /approved/export/audit.json \
  --retention delete-after-review

node <skill-dir>/scripts/render-report.mjs \
  --input /approved/export/audit.json \
  --output /approved/export/report.md
```

The collector refuses persistent Evidence when the protected target graph is incomplete. The finalizer accepts transient analysis on stdin only when explicitly selected with `--analysis -`; `evidence.json` and `audit.json` must share the authorized directory and retention contract. For backward-compatible file input, an analysis file must also be in that directory, but ordinary Audit Export does not authorize or require retaining it. The finalizer refuses incomplete guards and mismatched fingerprints. The renderer applies the corresponding same-directory and fingerprint checks to `audit.json` and `report.md`.

Repeated `--forbid-root` values remain optional defense in depth for an explicitly known target root; they are not the completeness proof. Completeness comes from the collector-produced write guard and directory-fingerprint chain. Every write still resolves symlinks canonically and must remain outside protected Installation Target roots.

Before output, the finalizer and renderer validate the canonical object against the dependency-free runtime schema validator and apply recursive secret and Unix/Windows absolute-path backstops to both keys and values. These checks are a last boundary, not permission to place raw secrets or private content in inputs.
