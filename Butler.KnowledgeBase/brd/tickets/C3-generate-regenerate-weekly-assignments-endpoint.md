---
type: Ticket
title: "C3: Generate / regenerate weekly assignments endpoint"
description: Endpoint that runs the C2 engine for a week and persists (or regenerates) the household's assignments.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/22
tags: [epic:chores, area:api, type:feature, priority:p0]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [C2, H3]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C3: Generate / regenerate weekly assignments endpoint

**Sub-service(s):** `Butler.API/`
**Blocked by:** C2 (`#<C2>`), H3 (`#<H3>`)
**Serves:** FR-4

## Summary
Add the endpoint that generates a household's assignments for a given (or current) `weekIso` by running the C2 engine over the household's active chores and eligible people, then persists the result via the C1 repositories. Regenerating an already-generated week replaces `Open` assignments but preserves `Done` ones and their completions.

## Context
This is journey 6.3 (weekly, automatic - with an organizer regenerate). The endpoint is the only place that composes fetch -> compute -> persist: it reads active chores (H3) and people (H4), computes each person's trailing-4-week load from `ChoreCompletions`, computes `weekIso` from the injected clock when none is supplied, calls the pure C2 engine, and writes `Assignments`. Regenerate must be idempotent and safe: a week already partly completed must not lose its `Done` records.

## Acceptance Criteria
- [ ] `POST /api/households/{householdId}/assignments/generate` (accepting an optional `weekIso`; when omitted, `weekIso` is computed server-side from the injected clock) generates assignments for that week using the C2 engine over the household's `Active` chores and its people, persisting them via the C1 `IAssignmentRepository`.
- [ ] Each person's load input to the engine is computed by scanning the household `ChoreCompletions` partition over the trailing 4 weeks (no cross-household query).
- [ ] **Regenerate rule (stated, idempotent):** regenerating a week that already has assignments replaces only `Open` assignments; `Done` assignments and their `ChoreCompletions` are preserved untouched, and the effort of preserved `Done` chores is reflected in the recomputed loads so regeneration does not re-assign already-completed chores.
- [ ] Authorization: the endpoint may be triggered by an `Organizer` (JWT, `[Authorize(Policy = "Organizer")]`) or by a paired hub device; a plain participant session may not trigger it and is rejected.
- [ ] The response returns the resulting assignment set for the week (including any chores the engine left unassigned with their reason from C2).
- [ ] Unknown `householdId` returns `404` as RFC 7807 problem details.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: generate-produces-assignments-for-active-chores; regenerate-preserves-done (a `Done` assignment plus its completion survive a regenerate while `Open` ones are replaced, and the done chore is not reassigned); unauthorized-participant-rejected; unknown-household-404. Use NSubstitute fakes for the repositories and a fixed injected clock.

## Risks & Rollback
- R-2 (BRD): regenerate racing a completion could drop a `Done` record. Mitigation: the preserve-`Done` rule is an AC with a dedicated test; writes go through the C1 repos' concurrency helper. Rollback = revert; C5 is `Blocked by` this ticket.
