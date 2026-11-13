---
type: Ticket
title: "C4: Complete a chore (tap-to-complete) endpoint"
description: "Tap-to-complete endpoint: append a ChoreCompletion and mark the assignment Done under optimistic concurrency."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/23
tags: [epic:chores, area:api, type:feature, priority:p0]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [C1, T1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C4: Complete a chore (tap-to-complete) endpoint

**Sub-service(s):** `Butler.API/`
**Blocked by:** C1 (`#<C1>`), T1 (`#<T1>`)
**Serves:** FR-4, BO-1

## Summary
Add the endpoint that completes an assignment from a tap: it appends a `ChoreCompletion` and sets the assignment `Status = Done` under optimistic concurrency. A participant session or a paired hub device may complete - no organizer required - and a double-complete is idempotent, not an error.

## Context
This is journey 6.2 (the daily glance and tap-to-complete) and the write side of the wedge. Per D-3 completing a chore is not a sensitive action, so tap-to-claim participants (T1) and the hub device may do it without an organizer JWT. Per BRD R-2 completions are append-only and assignment status is last-writer-wins per `(householdId, week, chore)` with optimistic concurrency, which is exactly what makes offline resync (Epic 60) safe.

## Acceptance Criteria
- [ ] `POST /api/households/{householdId}/assignments/{weekIso}/{choreId}/complete` appends a `ChoreCompletion` with `PersonId` from the active participant session or paired hub device, `Effort` copied from the chore, `CompletedUtc` from the injected clock, and the assignment's `WeekIso`.
- [ ] The same call sets the matching `Assignment.Status = Done` via optimistic concurrency (`If-Match` on the read `ETag`); the write is last-writer-wins per `(householdId, weekIso, choreId)`.
- [ ] **Idempotent double-complete:** completing an assignment already `Done` succeeds (returns success, does not throw); completions remain append-only, so the handler does not delete or overwrite prior `ChoreCompletion` rows.
- [ ] Authorization: a participant session or a paired hub device may complete; no `Organizer` policy is required on this endpoint.
- [ ] Unknown assignment (`householdId`/`weekIso`/`choreId` with no matching row) returns `404` as RFC 7807 problem details.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: complete-sets-done-and-records-completion (status flips to `Done` and exactly one `ChoreCompletion` is appended with the chore's `Effort` and the clock's `CompletedUtc`); double-complete-idempotent (second call succeeds, no exception); completion-is-append-only (a second completion of the same chore never mutates or removes the first row); unknown-assignment-404. Use a fixed injected clock and NSubstitute repository fakes.

## Risks & Rollback
- R-2 (BRD): two devices completing the same chore offline then syncing. Mitigation: append-only completions + last-writer-wins status is the stated resolution and the idempotency test proves it. Rollback = revert; C5 is `Blocked by` this ticket.
