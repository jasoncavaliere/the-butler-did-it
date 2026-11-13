---
type: Ticket
title: "H2: Rooms CRUD (Rooms table)"
description: "Rooms feature: create, list, update, and delete rooms scoped to a household."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/11
tags: [epic:household-model, area:api, type:feature, priority:p0]
epic: ../20-epic-household-model.md
blocked-by: [H1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# H2: Rooms CRUD (Rooms table)

**Sub-service(s):** `Butler.API/`
**Blocked by:** H1 (`#<H1>`)
**Serves:** FR-2

## Summary
Add the Rooms feature (`Application/Rooms/` + `Infrastructure/Rooms/` + `AddRoomsFeature()`) with create, list, update, and delete endpoints for rooms scoped to a household. Rooms are the physical map chores attach to (H4), so ordering and household scoping matter.

## Context
Implements the `Rooms` row in [Engineering Contract 7.3](../engineering-contract/73-data-model.md) (PartitionKey `householdId`, RowKey `roomId`, fields `Name`, `SortOrder`). Reads are open to the hub device and participants; mutations are organizer-only per [7.4](../engineering-contract/74-authentication-and-authorization.md). Uses the F3 optimistic-concurrency helper for updates.

## Acceptance Criteria
- [ ] `Application/Rooms/` exists with MediatR commands/queries + handlers, an application service, and `AddRoomsFeature()`; registered in `Program.cs`.
- [ ] `Infrastructure/Rooms/` contains `TableRoomRepository` behind `IRoomRepository`, scoping every operation by `PartitionKey = householdId`.
- [ ] `POST /households/{householdId}/rooms` creates a room with a server-generated `roomId`, storing `Name` and `SortOrder`; returns `201` with the room and its `ETag`; carries `[Authorize(Policy = "Organizer")]`.
- [ ] `GET /households/{householdId}/rooms` lists rooms for the household ordered by `SortOrder` (ascending, stable); reads are allowed to the hub/participant (not organizer-gated).
- [ ] `PUT /households/{householdId}/rooms/{roomId}` updates `Name`/`SortOrder`, requires `If-Match` (returns `428` when the header is missing, `412` when the `ETag` is stale), and carries `[Authorize(Policy = "Organizer")]`.
- [ ] `DELETE /households/{householdId}/rooms/{roomId}` removes the room and carries `[Authorize(Policy = "Organizer")]`.
- [ ] Unknown `roomId` or unknown `householdId` returns `404` (RFC 7807 problem details) on get/update/delete.
- [ ] Solution builds with `/p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `RoomsCrud` (create/list/update/delete round trip), `RoomsOrdering` (list returns by `SortOrder`), `RoomsConcurrency` (missing `If-Match` -> `428`, stale -> `412`, match -> success), `RoomNotFound` (`404` on unknown room).

## Risks & Rollback
- R: unbounded room lists degrade the hub board. Mitigation: v1 lists a single household's rooms (one partition, small N); no cross-household scan. Rollback = revert the PR; `AddRoomsFeature()` is unregistered and H4 (chores reference rooms) is blocked until re-landed.
