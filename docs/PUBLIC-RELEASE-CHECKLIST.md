# Public release checklist

Complete this checklist before changing the GitHub repository from private to public.

## Required blockers

- [x] Select the MIT License and add a standard `LICENSE` file.
- [x] Replace the temporary `UNLICENSED` package metadata and update the README license section.
- [x] Review the complete Git history and current tree for private paths, identities, credentials, configs, databases, logs, memories, transcripts, and generated audit artifacts. Only documented synthetic redaction fixtures remain.
- [ ] Run `npm test`, syntax checks, the Codex skill validator, and the maintainer release gate on the exact commit intended for publication.
- [x] Verify that the README's capability and platform claims match recorded evidence.

## GitHub repository settings

- [x] Set a concise description and the topics `openclaw`, `codex`, `skill`, `configuration-audit`, and `drift-detection`.
- [x] Keep `main` as the default branch.
- [ ] Add a branch ruleset requiring the CI workflow and preventing force pushes and branch deletion.
- [x] Set the default `GITHUB_TOKEN` workflow permission to read-only and prevent Actions from approving pull requests.
- [x] Enable Dependabot alerts and security updates.
- [ ] Enable secret scanning, push protection, and private vulnerability reporting after the repository becomes public.
- [ ] Confirm that Issues and private security advisories are usable before inviting reports.
- [ ] Add a Code of Conduct and a private conduct-reporting contact before actively soliciting a contributor community.

As of 2026-09-03, the current GitHub plan does not expose rulesets, secret scanning, push protection, or private vulnerability reporting while this repository is private. GitHub makes these controls available to public repositories. Do not change visibility merely to satisfy this checklist; enable and verify them as part of the explicitly authorized public-release operation.

## Release

- [ ] Rebuild the release archive from the reviewed commit and publish its SHA-256 checksum.
- [ ] Create an annotated `v0.1.0` tag and a GitHub prerelease named `Public Preview 0.1`.
- [ ] Describe verified capabilities and all remaining Coverage Gaps in the release notes.
- [ ] Mark the schema as `0.x` and do not promise stable consumer compatibility.
- [ ] After changing visibility, verify the README links, CI badge, issue forms, security-reporting link, and GitHub Community Standards profile.
