---
type: Ticket
title: "C1: Assignment + completion domain and tables"
description: Assignments and ChoreCompletions tables and repositories, plus an injected clock and a weekIso helper.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/20
tags: [epic:chores, area:api, type:feature, priority:p0]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [F3, H4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C1: Assignment + completion domain and tables

**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), H4 (`#<H4>`)
**Serves:** FR-4

## Summary
Add the `Assignments` and `ChoreCompletions` domain shapes, tables, and repositories - plus an injected clock and a deterministic `weekIso` helper - so the assignment engine (C2) and the endpoints (C3, C4) have a tested persistence and time base to build on.

## Context
Implements the `Assignments` and `ChoreCompletions` rows from [Engineering Contract 7.3](../engineering-contract/73-data-model.md), on top of the F3 Table Storage access seam. `weekIso` is the ISO-8601 year-week string (for example `2026-W29`) and must be computed from an injected clock/`TimeProvider`, never `DateTime.Now` inside a handler - this is what keeps the engine and endpoints deterministically testable. Completions are append-only (BRD R-2); assignment status is mutated under optimistic concurrency (that behavior lands with C4, but the row and repository seam are created here).

## Acceptance Criteria
- [ ] An `Assignments` table shape exists with `PartitionKey = householdId`, `RowKey = {weekIso}_{choreId}`, and fields `AssignedPersonId`, `WeekIso`, `DueDateUtc`, `Status` (`Open`/`Done`).
- [ ] A `ChoreCompletions` table shape exists with `PartitionKey = householdId`, `RowKey = {completedUtcTicks}_{choreId}`, and fields `ChoreId`, `PersonId`, `CompletedUtc`, `Effort`, `WeekIso`.
- [ ] Both are exposed behind repository interfaces (`IAssignmentRepository`, `IChoreCompletionRepository`) with Table-backed implementations built on the F3 access seam; every read and write is scoped by `PartitionKey = householdId` (no cross-household query).
- [ ] An injected clock (`TimeProvider` or an `IClock` seam) is registered; no assignment/completion code path reads `DateTime.Now`/`DateTime.UtcNow` directly.
- [ ] A deterministic `WeekIso` helper computes the ISO-8601 year-week string from a supplied `DateTimeOffset` (for example `2026-07-14` -> `2026-W29`), handling the ISO week-numbering-year boundary (a late-December date can belong to week 01 of the next year, and an early-January date to week 52/53 of the prior year).
- [ ] An `AddAssignmentsFeature()` (or equivalently named) service-collection extension registers the repositories, clock, and helper, and is wired in `Program.cs` per the [feature-extension pattern](../engineering-contract/72-api-architecture.md).
- [ ] Solution builds with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `WeekIsoHelperTests` (known dates including an ISO week-53 year and a year-boundary date proving the week-numbering-year rule), `AssignmentRepositoryTests` and `ChoreCompletionRepositoryTests` (round-trip write/read scoped by `householdId`, using the F3 faked/in-memory table client).

## Risks & Rollback
- R: an off-by-one ISO week helper silently mis-buckets completions and breaks fairness math. Mitigation: the year-boundary unit tests above are an AC, not optional. Rollback = revert the PR; C2-C6 are `Blocked by` this ticket so nothing downstream ships against a wrong helper.
