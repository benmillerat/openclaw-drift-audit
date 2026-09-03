# Security policy

## Supported versions

| Version | Status |
|---|---|
| `0.1.x` | Public Preview, security fixes accepted |
| Earlier or unreleased snapshots | Not supported |

Public Preview means the schema and capability boundaries may still change. It does not reduce the importance of disclosure-boundary or target-mutation defects.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/benmillerat/openclaw-drift-audit/security/advisories/new).

Do not open a public issue for a vulnerability. Do not attach a real OpenClaw configuration, database, log, memory, transcript, credential, account identifier, absolute private path, or unredacted audit artifact.

Useful reports include:

- affected commit or release;
- the smallest synthetic reproducer;
- expected and observed behavior;
- impact on confidentiality, target integrity, or audit correctness;
- whether the issue crosses the deterministic collector-to-model boundary.

High-priority examples include secret or identity disclosure, target writes, command or plugin execution, path traversal, export-root bypass, schema confusion, and unsafe interpretation of untrusted evidence.

There is no formal response-time SLA during Public Preview. If a report has not been acknowledged after seven days, open a public issue containing no vulnerability details and ask the maintainer to check private advisories.

Ordinary false positives, missing compatibility adapters, and incomplete documentation can use the bug-report form unless they reveal private data or enable target mutation.
