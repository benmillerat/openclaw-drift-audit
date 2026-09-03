# Non-executing repair handoff

A Repair Handoff is optional output data for a different, separately authorized repair workflow. This audit skill never applies it.

For each selected finding include:

- finding key and evidence IDs;
- exact component, version, Effective Scope, configuration layer, and target surface;
- proposed Granular Repair and why it addresses this finding;
- expected authored/effective diff without embedding secrets;
- known file, config, database, package, process, service, network, and restart effects;
- prerequisites and conflicts;
- backup or rollback boundary;
- post-change validation and Repair Proof;
- unresolved uncertainty and safer alternatives;
- `executable: false`.

Prefer one finding and one bounded change. Mark broad operations such as `doctor --fix` as Broad Migrations and do not translate them into a granular command unless exact-version evidence proves the boundary. A command's successful exit is not Repair Proof.

Do not include authorization language, auto-run markers, shell scripts, or instructions that cause the receiving agent to skip confirmation. Commands may be shown as inert review material only when sourced and necessary; the receiving workflow must independently validate and authorize them.

The canonical handoff object uses the schema fields `findingKey`, `componentId`, `componentVersion`, `effectiveScope`, `configurationLayer`, `targetSurface`, `proposedChange`, `expectedDiff`, `sideEffects`, `prerequisites`, `conflicts`, `rollbackBoundary`, `validation`, `repairProof`, `uncertainties`, `saferAlternatives`, and the constant `executable: false`. Omitted dimensions are invalid; represent an assessed empty list as `[]`.
