---
type: Ticket
title: "F2: Butler.API test harness (xUnit + NSubstitute)"
description: The Butler.Api.Tests project (xUnit + NSubstitute) so dotnet test is a real gate for every later ticket.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/4
tags: [epic:foundations, area:api, type:test, priority:p0]
epic: ../10-epic-foundations.md
blocked-by: [F1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F2: Butler.API test harness (xUnit + NSubstitute)

**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`)
**Serves:** FR-1 (makes `dotnet test` a real gate)

## Summary
Create the `Butler.Api.Tests` project (xUnit + NSubstitute, centrally versioned) so `dotnet test` is a real gate for every later ticket, and back-test the F1 `PingQuery` handler.

## Context
`/implement-issue` Phase 2 detects gates and Phase 4 runs them. Without a test project, "unit tests pass" is a silent skip. This ticket makes the gate real and sets the test conventions (Arrange/Act/Assert, NSubstitute for fakes) later tickets follow.

## Acceptance Criteria
- [ ] `src/Butler.Api.Tests/Butler.Api.Tests.csproj` exists (net10.0), references the API project, and is added to `Butler.API.sln`.
- [ ] `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk`, and `NSubstitute` are referenced via `Directory.Packages.props`.
- [ ] At least one passing test exercises the F1 `PingQuery` handler (real handler, no HTTP).
- [ ] `dotnet test` from `Butler.API/` discovers and runs the suite green.
- [ ] Test build honors `TreatWarningsAsErrors` (matches CI in F5).
- [ ] Coverage tooling is wired: `coverlet.collector` (and/or `coverlet.msbuild`, centrally versioned) collects line, branch, and method coverage on `dotnet test` and emits a report (for example Cobertura).
- [ ] The 98 percent coverage gate from [Engineering Contract 7.7](../engineering-contract/77-testing-and-definition-of-done.md) is enforced locally: `dotnet test` fails when line, branch, or method coverage is below 98 percent (for example `/p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`). Any exclusion is explicit, minimal, and justified in the coverage config - never a blanket ignore.

## Testing
- Gates: `cd Butler.API && dotnet test /p:CollectCoverage=true /p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`.
- Add tests: `PingQueryHandlerTests` (green). Because coverage is enforced from here on, the F1 `System` slice must be fully covered by this ticket.

## Risks & Rollback
- Low; test-only project. Rollback = revert the PR.
