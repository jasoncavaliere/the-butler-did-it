---
type: Ticket
title: "C2: Fair-assignment engine (pure, deterministic)"
description: The fair-assignment engine as a pure, deterministic function, exactly per Contract 7.6.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/21
tags: [epic:chores, area:api, type:feature, priority:p0]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [C1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C2: Fair-assignment engine (pure, deterministic)

**Sub-service(s):** `Butler.API/`
**Blocked by:** C1 (`#<C1>`)
**Serves:** FR-4, BO-1

## Summary
Implement the v1 fair-assignment algorithm as a pure, deterministic service exactly per [Engineering Contract 7.6](../engineering-contract/76-fair-assignment-algorithm.md): given the week's active chores, the eligible people, and each person's trailing completion load, it returns the assignment set. No storage, no clock, no randomness - all inputs are passed in. This is the highest-value test surface in the epic.

## Context
This is D-6 (the v1 fair-assignment decision) made real. The engine is a pure function so it is exhaustively unit-testable and so C3 can call it with data it fetched and C2 stays free of I/O. The exact rules from 7.6 are binding: eligibility, load definition, processing order, assignment target, and tie-breaks. Determinism is a hard requirement - the same inputs must always produce the identical assignment set (no ML, no learning, no external calls).

## Acceptance Criteria
- [ ] A pure service (for example `FairAssignmentEngine.Assign(...)`) takes only in-memory inputs: the week's active chores, the eligible people (each carrying `IsChild`), and each person's precomputed running load (trailing-4-week completed `Effort`); it performs no storage access, reads no clock, and uses no RNG.
- [ ] **Eligibility** matches 7.6 exactly: a child (`IsChild == true`) is eligible only for chores with `MinAge == null`; a non-child is eligible for every active chore.
- [ ] **Processing order:** chores are processed by descending `Effort`, then by `choreId` ascending for stability.
- [ ] **Assignment target:** each chore is assigned to the eligible person with the lowest current load, where load = trailing-4-week completed `Effort` plus effort already assigned this week; the chore's `Effort` is then added to that person's running load.
- [ ] **Tie-break:** equal load breaks to fewest chores assigned this week, then to lowest `personId`.
- [ ] **Determinism:** running the engine twice on the same inputs returns an identical assignment set (same person per chore, same order).
- [ ] **No eligible person:** when a chore has no eligible person, it is returned unassigned with a stated reason (for example an `Unassigned` result carrying a reason code); the engine does not throw and does not skip the chore silently.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests (`FairAssignmentEngineTests`, the epic's primary test surface): eligibility (a child is excluded from a `MinAge != null` chore and included for a `MinAge == null` chore); load balancing (higher trailing load receives less new effort so the distribution evens out); determinism (same input run twice yields byte-identical assignment sets); processing order and tie-break (descending `Effort` then `choreId`; equal load resolves by fewest-chores-this-week then `personId`); no-eligible-person (chore returned unassigned with a reason, no exception).

## Risks & Rollback
- R: a subtle deviation from 7.6 (wrong tie-break order, wrong load window) produces plausible-but-unfair assignments. Mitigation: the AC restate 7.6 verbatim and each rule has a dedicated test. Rollback = revert; C3 is `Blocked by` this ticket.
