---
type: Ticket
title: "H4: Chores CRUD (Chores table) attached to a room"
description: "Chores feature: create, list, update, and deactivate chores, each attached to a room."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/13
tags: [epic:household-model, area:api, type:feature, priority:p0]
epic: ../20-epic-household-model.md
blocked-by: [H2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# H4: Chores CRUD (Chores table) attached to a room

**Sub-service(s):** `Butler.API/`
**Blocked by:** H2 (`#<H2>`)
**Serves:** FR-2, FR-4

## Summary
Add the Chores feature (`Application/Chores/` + `Infrastructure/Chores/` + `AddChoresFeature()`) so chores can be created, listed, updated, and deactivated, each attached to a room in the same household. Chores are the input the Epic 40 fair-assignment engine reads, so `Effort`, `Cadence`, and `MinAge` are captured here.

## Context
Implements the `Chores` row in [Engineering Contract 7.3](../engineering-contract/73-data-model.md) (fields `Title`, `RoomId`, `Cadence` (`Daily`/`Weekly`), `Effort` (int), `MinAge` (nullable), `Active`). A chore references a `Room` (H2) in the same household; a chore pointing at a non-existent room is rejected. Deactivation (`Active = false`) is preferred over deletion so historical assignments and completions keep referential meaning. Mutations are organizer-gated per [7.4](../engineering-contract/74-authentication-and-authorization.md).

## Acceptance Criteria
- [ ] `Application/Chores/` exists with MediatR commands/queries + handlers, an application service, and `AddChoresFeature()`; registered in `Program.cs`.
- [ ] `Infrastructure/Chores/` contains `TableChoreRepository` behind `IChoreRepository`, scoping every operation by `PartitionKey = householdId`.
- [ ] `POST /households/{householdId}/chores` creates a `Chores` row with a server-generated `choreId`, storing `Title`, `RoomId`, `Cadence` (`Daily` or `Weekly`), `Effort` (positive int), `MinAge` (nullable int), and `Active` (default `true`); returns `201` with the chore and its `ETag`; carries `[Authorize(Policy = "Organizer")]`.
- [ ] `RoomId` must reference an existing `Room` in the same household; a create or update with an unknown `RoomId` returns `400` (RFC 7807 problem details) and persists nothing.
- [ ] `Effort` must be a positive integer; a non-positive value returns `400`.
- [ ] `GET /households/{householdId}/chores` lists the household's chores and supports filtering by `Active` (for example `?active=true`).
- [ ] `PUT /households/{householdId}/chores/{choreId}` updates the fields, requires `If-Match` (`428` missing / `412` stale), and carries `[Authorize(Policy = "Organizer")]`.
- [ ] Deactivation sets `Active = false` (via the update endpoint or a dedicated `POST .../deactivate`) rather than deleting the row; carries `[Authorize(Policy = "Organizer")]`.
- [ ] Unknown `choreId` or unknown `householdId` returns `404` on get/update/deactivate.
- [ ] Solution builds with `/p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `CreateChoreWithValidRoom` (persisted, `201`), `RejectUnknownRoom` (`400`, nothing persisted), `DeactivateChore` (`Active = false`, row retained), `ChoreConcurrency` (missing `If-Match` -> `428`, stale -> `412`), `ChoreActiveFilter` (list filters on `Active`).

## Risks & Rollback
- R: deleting chores would orphan assignments/completions in Epic 40. Mitigation: v1 deactivates rather than deletes. Rollback = revert the PR; `AddChoresFeature()` is unregistered and Epic 40 (which reads chores) is blocked until re-landed.
