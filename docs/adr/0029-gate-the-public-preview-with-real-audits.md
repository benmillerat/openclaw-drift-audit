---
status: accepted
---

# Gate Public Preview 0.1 with fixtures and real audits

Public Preview 0.1 is publishable only after fixture coverage for the current verified stable OpenClaw release and its immediate stable predecessor exercises every mandatory capability: installation discovery, configuration and include semantics, version and plugin provenance, Dynamic Baseline construction, relevant Migration Chains, direct Dependency Consistency Checks, secret redaction, and deterministic export rendering.

The Preview Release Gate additionally requires at least two real macOS audits covering a package installation and a source checkout, with at least one installation that accumulated updates and intentional local modifications. Before-and-after target fingerprints provide evidence that the audit caused no intentional Installation Target mutation. Adversarial secret and prompt-injection fixtures verify the model-disclosure boundary. Golden tests verify canonical `audit.json` and its derived `report.md`.

Linux, Windows, Nix, containers, and other untested combinations remain `supported-unverified` or `partial` until reproducible evidence supports a bounded Capability Verification Claim. Passing the preview gate does not imply a stable `1.0` schema or universal platform verification.
