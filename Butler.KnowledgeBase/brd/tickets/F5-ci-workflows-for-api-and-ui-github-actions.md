---
type: Ticket
title: "F5: CI workflows for API and UI (GitHub Actions)"
description: GitHub Actions CI that runs the API and UI gates on every PR.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/7
tags: [epic:foundations, area:infra, type:chore, priority:p0]
epic: ../10-epic-foundations.md
blocked-by: [F2, F4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F5: CI workflows for API and UI (GitHub Actions)

**Sub-service(s):** `Butler.API/`, `Butler.UI/` (workflow files only)
**Blocked by:** F2 (`#<F2>`), F4 (`#<F4>`)
**Serves:** FR-1

## Summary
Add GitHub Actions so the gates the tickets name actually run on every PR: the API builds+tests with warnings-as-errors, and the UI lints, typechecks, tests, and web-exports.

## Context
`/merge-issue` waits on pre-merge CI checks to go green. Those checks must exist. Two independent jobs (paths-filtered) because the two sub-services have separate toolchains and no root build.

## Acceptance Criteria
- [ ] `.github/workflows/api-ci.yml` runs on PRs touching `Butler.API/**`: `dotnet restore`, `dotnet build --configuration Release /p:TreatWarningsAsErrors=true`, and a coverage-gated `dotnet test` (`/p:CollectCoverage=true /p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`).
- [ ] `.github/workflows/ui-ci.yml` runs on PRs touching `Butler.UI/**`: `npm ci`, `npm run ci:verify` (which runs the coverage-gated test at the 98 percent global threshold), `npx expo export --platform web`.
- [ ] The 98 percent coverage gate from [Engineering Contract 7.7](../engineering-contract/77-testing-and-definition-of-done.md) fails the CI check in both sub-services when coverage on lines, methods, or branches drops below 98 percent (verified by a deliberately-undercovered change failing the check, then reverted).
- [ ] Both workflows pin the toolchain versions (.NET 10 via `global.json`; Node LTS).
- [ ] Both are required-check-eligible (named, appear on PRs) and pass on the current `main` after F1-F4 land.
- [ ] A short `CONTRIBUTING`/README note documents the local commands that mirror CI.

## Testing
- Gates: the workflows themselves are the gate; validate by opening the PR and confirming both checks run and pass.
- Add tests: none (CI config).

## Risks & Rollback
- R: flaky first run. Mitigation: keep jobs minimal and deterministic. Rollback = revert workflow files.
