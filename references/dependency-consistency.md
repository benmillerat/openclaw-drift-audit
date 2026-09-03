# Direct dependency consistency

Public Preview 0.1 requires a static Dependency Consistency Check for OpenClaw and every directly operated non-bundled plugin discovered by provenance.

Compare:

- `dependencies`, `optionalDependencies`, and `peerDependencies` declared by the component;
- selected lockfile evidence when a supported static adapter exists;
- the physically installed package identity found through parent `node_modules` resolution;
- package and integrity metadata;
- duplicate or shadowed direct identities;
- engine, host, Gateway, and plugin-API compatibility contracts.

The collector understands a conservative semver subset. `match` means only that the observed version satisfies the parsed declared range. It does not prove runtime loading, ABI compatibility, or artifact integrity. `mismatch` is a candidate Resolution Drift. `unknown`, unsupported selectors such as workspace/link/Git specs, missing lock adapters, native ABI questions, or indeterminate runtime resolution become Coverage Gaps.

Do not label every duplicate as drift; compatible parallel resolution may be intentional. Do not turn this check into a blanket package update report.

Full Effective Resolution Analysis is outside the mandatory preview scope. Recommend later escalation only when the static check finds an inconsistency, a relevant symptom implicates loading, or evidence establishes a Plausible Compatibility Cascade. Never import modules, run package-manager commands, execute lifecycle scripts, or call `require.resolve` against target code during Offline Core.
