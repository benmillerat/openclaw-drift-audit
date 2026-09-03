# OpenClaw Configuration Drift Audit

This context defines the language for a publishable Codex skill that assesses configuration drift in an installed OpenClaw system without silently changing that system.

## Language

**Audit**:
A non-repairing assessment that inventories an OpenClaw installation, compares observed state with version-appropriate baselines, prohibits intentional direct mutation of the Installation Target and known mutating commands, and reports evidence, uncertainty, and possible next actions.
_Avoid_: Repair run, cleanup, automatic migration

**Repair**:
A separate, explicitly authorized activity that changes selected installation state in response to an accepted audit finding.
_Avoid_: Audit, scan, automatic correction

**Recommended Baseline**:
The version- and context-specific value, range, or condition recommended by the authoritative owner of an OpenClaw component.
_Avoid_: Universal default, latest-value guess

**Configuration Drift**:
Any observable difference between an authored or effective installation setting and its applicable Recommended Baseline, including values outside a recommended range and options that were deprecated, replaced, removed, or made ineffective.
_Avoid_: Error, defect

**Compatibility Cascade**:
A chain in which Configuration Drift in one component leaves that component apparently operational but violates assumptions made by downstream components and contributes to later failures.
_Avoid_: Supply-chain attack, isolated component failure

**Recommendation Drift**:
A difference from an explicitly recommended value, range, or condition in the applicable Recommended Baseline.
_Avoid_: Default difference

**Default Delta**:
A difference from the applicable runtime default when no authoritative source establishes that default as a recommendation.
_Avoid_: Recommendation violation, defect

**Constraint Violation**:
A value or setting outside the bounds accepted by the applicable component version.
_Avoid_: Preference difference

**Unknown Baseline**:
A setting for which no sufficiently authoritative, version-matched value, range, or condition can be established.
_Avoid_: Compliant, recommended

**Operational Drift**:
Configuration Drift relative to the exact installed and active combination of OpenClaw and component versions.
_Avoid_: Upgrade warning, latest-version difference

**Upgrade Drift**:
Configuration Drift that would exist under the next stable, mutually compatible combination of OpenClaw and component versions.
_Avoid_: Current defect, comparison with an arbitrary latest version

**Upgrade Contract**:
The documented configuration and compatibility expectations of the next stable component-version combination that can validly replace the installed combination.
_Avoid_: Main branch behavior, newest version regardless of compatibility

**Audit Profile**:
A declared boundary describing which observable side effects and trust levels are permitted while collecting audit evidence.
_Avoid_: Severity level, repair mode

**Public Preview 0.1**:
The first public, audit-only release with an explicitly evolvable `0.x` export schema and a bounded implementation scope intended to be validated on real installations before any `1.0` stability promise.
_Avoid_: Stable product contract, complete Target Architecture

**Target Architecture**:
The accepted long-term audit model that guides compatibility and extension without making every planned capability a requirement of Public Preview 0.1.
_Avoid_: Current release scope, implicit feature promise

**Offline Core**:
The baseline Audit Profile that creates no intentional persistent artifacts, uses no network or live service probes, and executes no third-party component code; physical zero-write behavior requires separately proven operating-system isolation.
_Avoid_: Complete audit, live health check

**Physical Zero-Write Isolation**:
An operating-system-enforced environment in which the auditor and every invoked process lack write access to the Installation Target and other persistent destinations.
_Avoid_: Intent-only read-only promise, assumed command behavior

**Incidental Probe Effect**:
A known or plausible indirect side effect of an otherwise observational Live Probe, disclosed before authorization even though the audit does not intend to mutate the Installation Target.
_Avoid_: Hidden side effect, authorized repair

**Network Freshness**:
An Audit Profile that permits queries to authoritative documentation, release, and package sources without transmitting installation configuration or changing local target state.
_Avoid_: Provider probe, update

**Live Probe**:
An explicitly approved Audit Profile that may contact local services or configured external systems to verify effective behavior without authorizing repairs.
_Avoid_: Offline check, repair

**Coverage Gap**:
A check that could not be performed under the selected Audit Profiles or available evidence and therefore cannot support a compliant result.
_Avoid_: Passed check, no drift

**Sanitized Snapshot**:
An evidence representation from which secret values and private conversation content have been removed before model-based analysis, while retaining the non-sensitive values and provenance needed for comparison.
_Avoid_: Raw config dump, support archive

**Evidence Provenance**:
The traceable component owner, repository, version, revision, and source location supporting one audit claim.
_Avoid_: Unattributed guidance, search result

**Baseline Conflict**:
An unresolved contradiction between sufficiently authoritative, version-matched sources about the same expected value, range, condition, or behavior.
_Avoid_: Configuration Drift, silent source preference

**Shipped Evidence**:
An official change whose commit is contained in the release line relevant to the Operational Baseline or Upgrade Contract.
_Avoid_: Merged change outside the relevant release, closed issue

**Candidate Evidence**:
An official issue, pull request, comment, or unreleased change that can reveal risk, rationale, or intended direction but does not by itself alter a Recommended Baseline.
_Avoid_: Shipped behavior, normative recommendation

**Audited Component**:
OpenClaw or a directly operated extension surface whose configuration, compatibility contract, and effective behavior are evaluated against a baseline.
_Avoid_: Every package present on disk

**Transitive Dependency**:
A package used indirectly through an Audited Component and evaluated initially for declared compatibility, integrity, resolution, duplication, and known risk rather than a full configuration baseline.
_Avoid_: Direct plugin, automatically outdated component

**Dependency Escalation**:
The promotion of a Transitive Dependency into full component analysis when evidence connects it to a Compatibility Cascade.
_Avoid_: Blanket dependency audit

**Dependency Consistency Check**:
The mandatory static comparison, for each direct component, of declared dependency constraints, lockfile selections, physically installed package identities, integrity records, and statically determinable resolution paths.
_Avoid_: Full transitive audit, executing a component resolver

**Effective Resolution Analysis**:
An evidence-triggered deeper reconstruction of the dependency versions a component can actually load, performed only for a concrete inconsistency, relevant symptom, or Plausible Compatibility Cascade.
_Avoid_: Mandatory blanket resolution of every package

**Resolution Drift**:
An evidence-backed mismatch among declared, locked, installed, and effectively resolved dependency identities or constraints that cannot be explained as an intentional compatible parallel resolution.
_Avoid_: Every duplicate version, unverified runtime assumption

**Authored Configuration**:
The configuration explicitly present in the root or included configuration sources, preserving whether a value is missing, null, or set and where it originated.
_Avoid_: Effective runtime behavior

**Normalized Configuration**:
The current component version's deterministic, non-persisting read-time interpretation of Authored Configuration before runtime defaults and scope overlays are applied.
_Avoid_: Migration plan, rewritten config file, startup state mutation, effective configuration

**Doctor Persistence Migration**:
A version-specific Doctor operation that plans or persists configuration/state changes and is therefore outside Public Preview 0.1 Offline Core.
_Avoid_: Read-time normalization, audit-only inspection

**Startup Config Repair**:
An automatic startup path that can persist repaired configuration before normal runtime operation.
_Avoid_: Pure normalization, assumed read-only startup

**Startup State Migration**:
A startup path that can persistently transform sessions, databases, indexes, or other operational state.
_Avoid_: Authored configuration, non-persisting compatibility view

**Effective Configuration**:
The configuration that governs behavior after applicable defaults, inheritance, activation, and scope resolution have been applied.
_Avoid_: Raw config, presumed default

**State Overlay**:
Persisted operational state outside Authored Configuration that changes effective behavior for a session, model route, automation, agent, or runtime surface.
_Avoid_: Config-file value, transient observation

**Confirmed Cause**:
A causal relationship demonstrated by reproduction, trace or log evidence, a focused test, or an unambiguous executed code path.
_Avoid_: Correlation, plausible explanation

**Probable Contributor**:
A drift whose compatibility contract, code path, and observed timing strongly support a contributing role without fully demonstrating causation.
_Avoid_: Confirmed root cause

**Plausible Cascade**:
An evidence-linked technical path through which one or more drifts could affect downstream behavior, but which has not been practically confirmed.
_Avoid_: Proven failure chain

**Coexisting Drift**:
A visible drift for which no evidence currently connects it to the behavior or failure under investigation.
_Avoid_: Contributing cause

**Intent Record**:
An explicitly authored, reviewable explanation for accepting a specific drift under bounded values, component versions, scopes, and time.
_Avoid_: Suppression rule, permanent waiver

**Acknowledged Drift**:
Configuration Drift covered by a currently applicable Intent Record and therefore still visible but not presented as an unreviewed deviation.
_Avoid_: Compliant setting, hidden finding

**Expired Intent**:
An Intent Record that no longer applies because its value, component version, baseline, scope, or review period changed.
_Avoid_: Accepted risk

**Granular Repair**:
An explicitly approved change whose exact target, expected effect, validation, and rollback boundary are known before execution.
_Avoid_: General cleanup, broad migration

**Broad Migration**:
A repair operation that may change multiple detected configuration or state surfaces and cannot be constrained to one accepted finding.
_Avoid_: Granular repair, audit

**Repair Proof**:
Observable post-change evidence that the selected finding is resolved without violating the stated rollback criteria or introducing new drift.
_Avoid_: Successful command exit alone

**Repair Handoff**:
A non-executing, reviewable package for a separately authorized repair workflow containing selected findings, exact targets, proposed changes, expected side effects, validation criteria, and rollback boundaries.
_Avoid_: Repair authorization, executable audit instruction

**Audit Finding**:
A stable, evidence-backed record of drift, conflict, uncertainty, or missing coverage for one component, scope, and configuration layer.
_Avoid_: Log line, unstructured warning

**Audit Run Identity**:
The unique identity of one execution and its Observation Window, profiles, Capability Envelope, budgets, audit-logic version, and Installation Target binding.
_Avoid_: Stable finding identity, check definition

**Audit Rule Identity**:
The versioned identity of the audit logic that evaluates one defined condition independently of any particular run or observation.
_Avoid_: Finding instance, source citation

**Semantic Finding Key**:
The stable cross-run key for the same conceptual condition over component, Effective Scope, configuration surface, drift class, and Audit Rule Identity.
_Avoid_: Run identifier, hash of observed content

**Finding Observation**:
The run-specific observed value or condition, derived baseline, evidence, confidence, and status associated with a Semantic Finding Key.
_Avoid_: Rule definition, permanent finding identity

**Impact Severity**:
The independently assessed consequence of an Audit Finding if its stated conditions hold.
_Avoid_: Evidence confidence, drift visibility

**Evidence Confidence**:
The independently assessed strength and version relevance of the evidence supporting an Audit Finding.
_Avoid_: Impact severity, probability of harm

**Audit Export**:
An explicitly authorized persistent artifact containing a human report, machine-readable findings, or an evidence manifest from an Audit.
_Avoid_: Default audit output, repair authorization

**Canonical Audit Result**:
The optional schema-versioned `audit.json` that contains the complete exported run, coverage, source, baseline, rule, finding, and observation records from which other report views are derived.
_Avoid_: Markdown as source of truth, CI policy result

**Portable Export**:
An Audit Export additionally pseudonymized to reduce disclosure of local identities, paths, hosts, accounts, and conversation endpoints when shared outside the audited machine.
_Avoid_: Raw local report, automatically safe upload

**Metadata-Only Audit**:
An optional privacy profile that limits memories, transcripts, chats, logs, source diffs, and identity-bearing records to structural and operational metadata.
_Avoid_: Default audit, complete content diagnosis

**Coverage-First Audit**:
The default content profile that systematically scans all data classes in the active release's declared coverage contract locally, records every omission, and uses deterministic analysis before any authorized semantic model analysis.
_Avoid_: Metadata-only audit, bulk model ingestion

**Finding-Triggered State Analysis**:
Analysis of logs, memories, transcripts, or other high-volume operational state that begins only when an earlier finding, relevant symptom, or Plausible Compatibility Cascade identifies a bounded investigative need.
_Avoid_: Blanket runtime forensics, arbitrary sampling presented as coverage

**Forensic Deep Audit**:
An optional profile that permits broader semantic analysis of relevant content to investigate hidden or weakly signaled compatibility, performance, and quality problems.
_Avoid_: Standard audit, automatic repair

**Coverage Manifest**:
A record of discovered, examined, partially examined, and skipped data classes and boundaries, every remaining Coverage Gap, and the model-disclosure status of each data class.
_Avoid_: Claim of exhaustive coverage

**Semantic Disclosure Authorization**:
A per-audit, per-data-class authorization allowing models to receive more than the standard allowlisted and secret-redacted scanner structures, while never permitting disclosure of secrets.
_Avoid_: Per-excerpt prompt, blanket forensic permission, repair authorization

**Proven Local Model Boundary**:
An execution boundary whose model, transport, storage, and telemetry paths are evidenced to remain local to the audited trust domain; absent that evidence, the model is treated as external.
_Avoid_: Model marketed as local, localhost endpoint assumption

**Capability Envelope**:
The per-run record of which filesystem, process, service, database, network, provenance, and semantic-analysis capabilities were actually available and permitted for the pinned Installation Target.
_Avoid_: Static platform promise, audit completeness label

**Evidence Bundle**:
A locally produced, redacted, integrity-recorded package of installation evidence that can extend analysis away from the target host without granting live access or implying complete coverage.
_Avoid_: Raw support archive, complete installation clone, trusted instructions

**Tested Combination Status**:
The evidence-backed test status of one platform, installation method, topology, and audit-capability combination, such as `verified`, `supported-unverified`, or `partial`.
_Avoid_: General product support claim, inferred verification

**Capability Verification Claim**:
A bounded claim that a specific audit capability has been tested across only the version, platform, installation, and topology dimensions that can materially affect that capability.
_Avoid_: Cartesian product certification, whole-audit verification

**Best-Effort Version**:
An OpenClaw or component version outside the maintained verification fixtures for which compatible checks may run, while uncertain checks remain Coverage Gaps.
_Avoid_: Unsupported means unscannable, implicitly verified version

**Preview Release Gate**:
The minimum evidence required to publish Public Preview 0.1, combining version fixtures, capability tests, real-installation audits, non-mutation checks, adversarial privacy tests, and deterministic export validation.
_Avoid_: Stable 1.0 certification, untested platform claim

**Untrusted Evidence**:
Installation, log, transcript, memory, plugin, source, issue, or documentation content that may support a finding but can never authorize commands or alter audit instructions.
_Avoid_: Executable instruction, trusted control input

**Installation Graph**:
The bounded graph of active OpenClaw runtimes, state, configuration, workspaces, services, extensions, packages, source, data stores, and explicitly resolved external references that can affect the audited installation.
_Avoid_: Entire host filesystem, directory-name guess

**External Installation Reference**:
A path or component outside the primary OpenClaw roots that belongs to the Installation Graph through an explicit include, runtime reference, symlink, service definition, or dependency-resolution path.
_Avoid_: Unrelated neighboring project

**Snapshot-Assisted Audit**:
An explicitly authorized audit that examines a consistent private copy of live state when direct read-only inspection would be incomplete or disruptive.
_Avoid_: Default live scan, backup restore

**Audit Contention**:
Measurable lock waiting or service degradation caused or amplified by evidence collection against live installation state.
_Avoid_: Existing application load, permission failure

**Observation Window**:
The recorded start and end time during which an audit observed a mutable installation, bounding what its findings can claim about that state.
_Avoid_: Point-in-time snapshot, audit duration estimate

**Consistency Marker**:
A source-appropriate identity or monotonic indicator, such as a content hash, file identity and size, database transaction marker, or append position, used to determine whether evidence remained interpretable during its Observation Window.
_Avoid_: Universal file timestamp check

**Concurrent Mutation Gap**:
A Coverage Gap produced when a mutable source cannot be interpreted consistently after at most one source-appropriate reread.
_Avoid_: Normal append-only growth, automatically corrupted data

**Migration Chain**:
The version-ordered sequence of relevant option, value-range, default, recommendation, compatibility, and migration changes for one component.
_Avoid_: Current-version diff, applying migrations

**Skipped Migration Window**:
A period in a Migration Chain during which an official automatic migration was available but is no longer available to the installed or target version.
_Avoid_: Unsupported inference, failed repair

**Unknown Origin Version**:
The state in which available installation evidence cannot establish the component version from which a surviving setting or state shape originated.
_Avoid_: Current version, earliest possible version

**Operating Context Profile**:
The evidence-backed description of tenancy, exposure, sender trust, workload, priorities, hardware, and security posture under which recommendations are evaluated.
_Avoid_: Universal best practice, inferred user preference

**Conditional Recommendation**:
A recommended value, range, or condition that applies only when specified properties of the Operating Context Profile hold.
_Avoid_: Global default, unconditional requirement

**Effective Scope**:
A distinct combination of agent, channel, account, conversation boundary, workspace, plugin and tool policy, and State Overlay for which one Effective Configuration applies.
_Avoid_: Root config, declared account alone

**Inheritance Drift**:
Configuration Drift introduced or exposed when a value inherited from a broader scope is unsuitable, ineffective, or inconsistent in a narrower Effective Scope.
_Avoid_: Explicit local override

**Scope Equivalence Class**:
A group of Effective Scopes with the same relevant effective values and recommendation outcome, represented once until a difference requires expansion.
_Avoid_: Hidden scope, global assumption

**Non-Executing Analysis**:
Analysis that treats all installation and external evidence as data and does not import component code, run lifecycle scripts, or execute instructions found in that evidence.
_Avoid_: Runtime verification, trusted README command

**Runtime Analysis Profile**:
An explicitly authorized isolated profile for executing component code when static and observational evidence cannot resolve a material Coverage Gap.
_Avoid_: Standard audit, live installation repair

**Release Channel**:
The component's declared stability track, such as stable, beta, release candidate, nightly, or unreleased main.
_Avoid_: Version number alone

**Channel-Aligned Upgrade Contract**:
An Upgrade Contract selected from releases compatible with the component's intentionally installed Release Channel.
_Avoid_: Newest artifact regardless of channel

**Installation Target**:
One pinned OpenClaw installation identity comprising its runtime, service, configuration, state, workspace, source or package origin, and build metadata.
_Avoid_: Every OpenClaw-shaped path on a host

**Runtime-Service Incoherence**:
A mismatch among the CLI, managed service, running Gateway, build, configuration, or source identities expected to belong to one Installation Target.
_Avoid_: Multiple intentionally separate installations

**Shadow Installation**:
A separate OpenClaw package, checkout, runtime, or state root that may influence discovery or resolution but is not the selected Installation Target.
_Avoid_: Active target component, arbitrary backup

**Component Discovery**:
The evidence-based identification of components actually installed, referenced, resolved, or active within an Installation Graph before their baselines are researched.
_Avoid_: Hard-coded plugin list, popularity-based assumption

**Dynamic Baseline**:
A version-matched baseline assembled at audit time from the discovered component owner's authoritative schema, runtime behavior, manifests, releases, source, and documentation.
_Avoid_: Skill-embedded current default, latest documentation guess

**Source Evidence Cache**:
An optional content-addressed store outside the Installation Target containing immutable, verified snapshots of authoritative source material and its provenance, populated only through an explicitly authorized cache update.
_Avoid_: Precomputed baseline cache, mutable latest-value store

**Baseline Snapshot**:
The reproducible record of source identities, versions, revisions, hashes, retrieval times, and unresolved gaps used to construct a Dynamic Baseline.
_Avoid_: Timeless recommendation, undocumented cache

**Component Provenance Record**:
The evidence record linking one discovered component to its installed identity, package or plugin identifier, exact version or commit, installation origin, manifest and artifact integrity, publisher or owner, repository, documentation, release channel, and declared OpenClaw or API compatibility.
_Avoid_: Same-name search result, assumed official ownership

**Verified Owner Source**:
A component source whose ownership can be tied to the installed artifact through its manifest, package metadata, persisted installation record, signed or integrity-checked registry entry, or repository history.
_Avoid_: Popular third-party guide, unverified repository match

**Unverified Component Source**:
A discovered component for which the auditor cannot establish a trustworthy relationship between the installed artifact and the apparent publisher, repository, documentation, or release source.
_Avoid_: Automatically official source, automatically malicious component

**Source Drift**:
A content-level difference between locally used source or a tracked service wrapper and the exact verified upstream revision from which it claims to derive.
_Avoid_: Dirty timestamp, untracked cache, automatically defective patch

**Artifact Drift**:
A content or integrity difference between an installed executable, package, bundle, or generated runtime artifact and its verified release artifact, lockfile resolution, registry integrity, or reproducible build expectation.
_Avoid_: Source edit, version difference alone, mtime difference

**Workspace State Delta**:
An untracked, ignored, generated, cached, or otherwise local workspace difference whose relevance to the Installation Graph has not been established.
_Avoid_: Source Drift, automatically irrelevant file
