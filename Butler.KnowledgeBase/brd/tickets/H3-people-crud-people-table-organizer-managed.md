---
type: Ticket
title: "H3: People CRUD (People table) - organizer-managed roster"
description: "People feature: the organizer adds, lists, updates, and removes people in the household roster."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/12
tags: [epic:household-model, area:api, type:feature, priority:p0]
epic: ../20-epic-household-model.md
blocked-by: [H1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# H3: People CRUD (People table) - organizer-managed roster

**Sub-service(s):** `Butler.API/`
**Blocked by:** H1 (`#<H1>`)
**Serves:** FR-2, FR-3

## Summary
Add the People feature (`Application/People/` + `Infrastructure/People/` + `AddPeopleFeature()`) so the organizer can add, list, update, and remove people in the household. This is the organizer-managed roster only; the no-password tap-to-claim CLAIM action lives in Epic 30 (T1) and is out of scope here.

## Context
Implements the `People` row in [Engineering Contract 7.3](../engineering-contract/73-data-model.md) (fields `DisplayName`, `Role` (`Organizer`/`Participant`), `IsChild`, `ClaimColor`, and `OrganizerObjectId` on the organizer only). H1 already seeds the organizer row; this ticket adds participant and child management. Per [7.4](../engineering-contract/74-authentication-and-authorization.md) all mutations are organizer-gated. The household must always retain at least one organizer, so demoting or deleting the last organizer is rejected.

## Acceptance Criteria
- [ ] `Application/People/` exists with MediatR commands/queries + handlers, an application service, and `AddPeopleFeature()`; registered in `Program.cs`.
- [ ] `Infrastructure/People/` contains `TablePersonRepository` behind `IPersonRepository`, scoping every operation by `PartitionKey = householdId`.
- [ ] `POST /households/{householdId}/people` creates a `People` row with a server-generated `personId`, storing `DisplayName`, `Role` (`Organizer` or `Participant`), `IsChild`, and `ClaimColor`; returns `201` with the person and its `ETag`; carries `[Authorize(Policy = "Organizer")]`.
- [ ] `GET /households/{householdId}/people` lists the household's people (reads allowed to the hub/participant so tap-to-claim in Epic 30 can render names).
- [ ] `PUT /households/{householdId}/people/{personId}` updates `DisplayName`/`Role`/`IsChild`/`ClaimColor`, requires `If-Match` (`428` missing / `412` stale), and carries `[Authorize(Policy = "Organizer")]`.
- [ ] `DELETE /households/{householdId}/people/{personId}` removes a person and carries `[Authorize(Policy = "Organizer")]`.
- [ ] Adding a child stores `IsChild = true` (so the H4/Epic 40 assignment engine can respect age-appropriateness).
- [ ] The last remaining `Organizer` in a household cannot be demoted to `Participant` nor deleted: such a request is rejected with `400` (RFC 7807 problem details) and the row is unchanged.
- [ ] Unknown `personId` or unknown `householdId` returns `404` on get/update/delete.
- [ ] Solution builds with `/p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `AddParticipant` (creates a `Participant` row), `AddChild` (`IsChild = true` persisted), `PreventLastOrganizerRemoval` (demote and delete of the sole organizer both rejected `400`), `PeopleConcurrency` (missing `If-Match` -> `428`, stale -> `412`).

## Risks & Rollback
- R: a household left with zero organizers has no one who can perform sensitive actions. Mitigation: the last-organizer guard is an AC and unit-tested. Rollback = revert the PR; `AddPeopleFeature()` is unregistered (the H1 organizer seed remains).
