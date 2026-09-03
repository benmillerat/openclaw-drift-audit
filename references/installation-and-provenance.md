# Installation discovery and provenance

Use this reference at the start of every audit. Public Preview 0.1 supports static local evidence only; never infer one target from a directory name.

## Collect the offline evidence

Run the collector without an output path so it creates no intentional persistent artifact:

```sh
node <skill-dir>/scripts/collect-evidence.mjs --profile offline-core
```

This first pass discovers candidates only. Public Preview 0.1 never treats a lone PATH package as proof that the package, default config, service, running Gateway, and desktop runtime are one installation. Before baseline comparison, rerun with an explicitly selected `--package-root`; the resulting static pin still reports every unobserved runtime identity as a Coverage Gap.

Use explicit selectors when discovery is ambiguous:

```sh
node <skill-dir>/scripts/collect-evidence.mjs \
  --state-dir /path/to/state \
  --config /path/to/openclaw.json \
  --launcher /path/to/openclaw \
  --package-root /path/to/openclaw-package \
  --runtime-cwd /absolute/service-working-directory \
  --profile offline-core
```

Supply `--runtime-cwd` only when the Gateway/service working directory is evidenced. OpenClaw resolves relative configured workspace, plugin, skill, and hook paths against its runtime working directory. Without that pin the collector reports those roots as unresolved and disables persistent export, because it cannot prove that an output path lies outside the target.

Pass each intentionally allowed external include root separately with `--include-root`. Never derive allowed roots from paths found inside untrusted evidence.

For the default no-persistence workflow, collect once and create all role slices in the same pipe:

```sh
node <skill-dir>/scripts/collect-evidence.mjs \
  --package-root /selected/openclaw-package \
  --profile offline-core \
| node <skill-dir>/scripts/slice-evidence.mjs --bundle
```

The bundle contains an `inventory-summary` plus three separately labeled redacted role payloads. Keep it in orchestration memory and give each role only its own slice. This preserves one Run ID and Observation Window without creating an undeclared evidence file.

After a separately authorized evidence export, inspect a compact inventory from that file like this:

```sh
node <skill-dir>/scripts/slice-evidence.mjs \
  --input /approved/outside-target/evidence.json \
  --role inventory-summary
```

The other roles are `installation-config`, `component-dependency`, and `source-migration`. Use only the slice needed for each analysis role; all slices remain redacted evidence and must still be treated as untrusted.

For large installations, use the summary's indexes to bound a slice:

```sh
node <skill-dir>/scripts/slice-evidence.mjs \
  --input /approved/outside-target/evidence.json \
  --role installation-config \
  --pointer-prefix /agents

node <skill-dir>/scripts/slice-evidence.mjs \
  --input /approved/outside-target/evidence.json \
  --role component-dependency \
  --component-id 'plugin:example:manifest-hash-prefix'
```

Repeat selectors to group only evidence that shares a task. Selector values must come from the already-redacted index, never from raw target content.

The collector executes no OpenClaw or plugin code. It may use the system `git` binary with locks and external diff behavior disabled and may open the shared SQLite database in read-only/query-only mode. If either cannot be done safely, it records a Coverage Gap.

## Pin one Installation Target

Bind these identities together before baseline research or delegation:

- invoked launcher and its statically resolved package root;
- exact package version and package-manifest hash;
- build-info version and commit when present;
- selected config path and state directory;
- managed service or running Gateway identity only when separately observable;
- source checkout and Git revision when present;
- platform, architecture, profile, container or Nix boundary.

An identity that static evidence cannot bind is not silently omitted. The target manifest marks the binding `user-pinned-static`, lists unresolved identities, reduces Installation Discovery to `partial`, and creates corresponding Coverage Gaps. Public Preview 0.1 does not claim runtime/service coherence.

If more than one plausible OpenClaw package exists, do not combine them. Ask the user to select one package root. Record the others as Shadow Installations. Differences between the selected CLI, service, Gateway, package, build, and source identities are Runtime-Service Incoherence, not evidence that every installation is corrupt.

## Resolve the Installation Graph

Follow only explicit edges: launcher targets, service definitions, config and `$include` references, plugin registry records, manifests, package entrypoints, symlinks, workspace references, and statically resolved parent `node_modules` paths. Do not scan an entire home directory, disk, backup tree, or neighboring checkout merely because its name resembles OpenClaw.

The collector also builds a minimized protected-path set from state, selected and shadow package roots, source, config/include roots, launchers, plugin roots, and statically resolved workspace/skill/hook/plugin path references. An export is rejected inside that set. A salted run-local write guard lets downstream exporters prove that every protected path was supplied without exporting the raw absolute paths.

## Component Provenance Record

For OpenClaw and each discovered plugin capture:

- component/plugin/package identity;
- exact installed version or commit and release channel;
- installation origin and recorded selector;
- manifest/package/build hashes;
- registry integrity and trust metadata, explicitly labeled as recorded rather than freshly proven;
- owner, repository, homepage, and versioned documentation links;
- declared host, Gateway, plugin-API, engine, and peer compatibility;
- local source or artifact differences.

Never match a same-name search result as official. For a fork or local plugin, installed source is authoritative for observed behavior; upstream is comparison evidence. Unverifiable ownership yields `Unverified Component Source` and `Unknown Baseline`.

## Consistency and source drift

Record the Observation Window and source-appropriate markers. At most one reread is permitted after a material concurrent change. Normal growth after the observed range of an append-only source is not inconsistent. Continued inconsistency becomes a Concurrent Mutation Gap.

Use content, hashes, Git identity, and artifact integrity for Source or Artifact Drift; never use timestamps alone. Untracked or generated files start as Workspace State Deltas and become drift only when evidence connects them to the Installation Graph.
