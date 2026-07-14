# Epic 20 - Household Model (the spine)

**Goal:** build the household model that every other capability reads from and writes to - rooms, people, and chores, all scoped to one household. This is the durable moat: the system of record for the home. Chores, assignments, completions, and grocery all compose on top of these tables, so this epic gets the aggregate right (partition key `householdId`, optimistic concurrency, organizer-gated mutations) before anything else leans on it.

**Serves:** FR-2 and BO-2 (the household model spine).

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<Hn>` (and the `#<Fn>` dependency) placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it.

---

## H1: Household aggregate + Households table + create/get household

**Labels:** `epic:household-model` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), F6 (`#<F6>`)
**Serves:** FR-2

## Summary
Create the Households feature (`Application/Households/` + `Infrastructure/Households/` + `AddHouseholdFeature()`) with a `TableHouseholdRepository` on the F3 access layer, plus endpoints to create and read a household. This is the root aggregate every later table hangs off; creating a household also creates the organizer's `People` row so the household is never left without an organizer.

## Context
Implements the `Households` and (partially) `People` rows in [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid), following the feature-extension pattern from [7.2](00-brd-master.md#72-butlerapi-architecture-layered-mediatr-adopted-from-qcontrol) and the auth model in [7.4](00-brd-master.md#74-authentication-and-authorization). The organizer is the only authenticated user (F6); creating a household binds that organizer's object id to an `Organizer` `People` row so downstream features have a real roster owner. Uses the F3 repository base for CRUD and the F6 `Organizer` policy for the mutation.

## Acceptance Criteria
- [ ] `Application/Households/` exists with the MediatR command/query + handlers, an application service, and a `HouseholdServiceCollectionExtensions.cs` exposing `AddHouseholdFeature()`.
- [ ] `Infrastructure/Households/` contains `TableHouseholdRepository` behind an `IHouseholdRepository` interface, built on the F3 Table access seam.
- [ ] `AddHouseholdFeature()` is registered in `Program.cs` (composition root).
- [ ] `POST /households` carries `[Authorize(Policy = "Organizer")]` and, on success, creates a `Households` row with a server-generated `householdId` (PartitionKey = RowKey = `householdId`), storing `Name`, `OrganizerObjectId` (the caller's object id, or the deterministic dev organizer in `DisableAuthentication` mode), and `CreatedUtc` from the injected clock.
- [ ] The same `POST /households` call also creates the organizer's `People` row in that household (`Role = Organizer`, `OrganizerObjectId` set to the caller's object id, `IsChild = false`).
- [ ] `POST /households` returns `201` with the created household (including `householdId` and `ETag`).
- [ ] `GET /households/{householdId}` returns the household with its `ETag`; returns `404` (RFC 7807 problem details) when the `householdId` is unknown.
- [ ] `householdId` is the partition key of the `Households` row; no cross-household read path is introduced.
- [ ] Solution builds with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `HouseholdCreation` (POST creates the `Households` row and the organizer `People` row with `Role = Organizer`), `GetHousehold404` (unknown `householdId` returns `404` problem details).

## Risks & Rollback
- R: creating a household without an organizer row would orphan the roster (H3 depends on it). Mitigation: the organizer `People` row is created in the same command and asserted in tests. Rollback = revert the PR; the Households feature is unregistered from `Program.cs` and later data tickets (H2-H4) lose their root, so land this before them.

---

## H2: Rooms CRUD (Rooms table)

**Labels:** `epic:household-model` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** H1 (`#<H1>`)
**Serves:** FR-2

## Summary
Add the Rooms feature (`Application/Rooms/` + `Infrastructure/Rooms/` + `AddRoomsFeature()`) with create, list, update, and delete endpoints for rooms scoped to a household. Rooms are the physical map chores attach to (H4), so ordering and household scoping matter.

## Context
Implements the `Rooms` row in [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid) (PartitionKey `householdId`, RowKey `roomId`, fields `Name`, `SortOrder`). Reads are open to the hub device and participants; mutations are organizer-only per [7.4](00-brd-master.md#74-authentication-and-authorization). Uses the F3 optimistic-concurrency helper for updates.

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

---

## H3: People CRUD (People table) - organizer-managed roster

**Labels:** `epic:household-model` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** H1 (`#<H1>`)
**Serves:** FR-2, FR-3

## Summary
Add the People feature (`Application/People/` + `Infrastructure/People/` + `AddPeopleFeature()`) so the organizer can add, list, update, and remove people in the household. This is the organizer-managed roster only; the no-password tap-to-claim CLAIM action lives in Epic 30 (T1) and is out of scope here.

## Context
Implements the `People` row in [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid) (fields `DisplayName`, `Role` (`Organizer`/`Participant`), `IsChild`, `ClaimColor`, and `OrganizerObjectId` on the organizer only). H1 already seeds the organizer row; this ticket adds participant and child management. Per [7.4](00-brd-master.md#74-authentication-and-authorization) all mutations are organizer-gated. The household must always retain at least one organizer, so demoting or deleting the last organizer is rejected.

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

---

## H4: Chores CRUD (Chores table) attached to a room

**Labels:** `epic:household-model` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** H2 (`#<H2>`)
**Serves:** FR-2, FR-4

## Summary
Add the Chores feature (`Application/Chores/` + `Infrastructure/Chores/` + `AddChoresFeature()`) so chores can be created, listed, updated, and deactivated, each attached to a room in the same household. Chores are the input the Epic 40 fair-assignment engine reads, so `Effort`, `Cadence`, and `MinAge` are captured here.

## Context
Implements the `Chores` row in [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid) (fields `Title`, `RoomId`, `Cadence` (`Daily`/`Weekly`), `Effort` (int), `MinAge` (nullable), `Active`). A chore references a `Room` (H2) in the same household; a chore pointing at a non-existent room is rejected. Deactivation (`Active = false`) is preferred over deletion so historical assignments and completions keep referential meaning. Mutations are organizer-gated per [7.4](00-brd-master.md#74-authentication-and-authorization).

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

---

## H5: UI household setup flow (organizer onboarding)

**Labels:** `epic:household-model` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), H2 (`#<H2>`), H3 (`#<H3>`), H4 (`#<H4>`), F7 (`#<F7>`)
**Serves:** FR-2, BO-2

## Summary
Build the organizer onboarding screen: a multi-step setup flow that creates the household, adds rooms, adds people (including the child flag and claim color), and maps a starter set of chores to rooms - the UI over H1-H4. It uses the F7 typed API client and `HouseholdContext`, and is reachable only for an authenticated organizer.

## Context
Realizes the onboarding journey in [BRD 6.1](00-brd-master.md#61-onboarding-organizer-once) on top of the H1-H4 endpoints and the F7 client/context. Web-first Expo per [Engineering Contract 7.1](00-brd-master.md#71-repository-and-toolchains); follow the versioned Expo 57 docs (`Butler.UI/AGENTS.md`). Errors from the API arrive as RFC 7807 problem details ([7.5](00-brd-master.md#75-cross-cutting-conventions-binding-for-every-ticket)) and must surface as user-visible validation/error states, not silent failures. On completion the new `householdId` lives in `HouseholdContext` for the rest of the app.

## Acceptance Criteria
- [ ] A multi-step organizer setup screen exists with steps in order: create household -> add rooms -> add people (each with an `IsChild` flag and a `ClaimColor`) -> map starter chores to rooms.
- [ ] Every step calls the corresponding H1-H4 endpoint through the F7 typed API client (no ad-hoc `fetch`), sending `If-Match` on updates and surfacing `ETag` per the client contract.
- [ ] Validation and error states are surfaced from the API problem-details shape (for example an unknown `RoomId` on chore mapping, or a `400`/`412` from the API) as readable in-screen messages; a failed step does not advance.
- [ ] Setup is gated: it is reachable only for an authenticated organizer (using the F6/F7 auth state); a non-organizer/unauthenticated visitor cannot reach the flow.
- [ ] On completion the `HouseholdContext` holds the newly created `householdId` (via `useHousehold`), so subsequent screens read the correct household.
- [ ] `npm run ci:verify` passes (lint, typecheck, test) and `npx expo export --platform web` produces a `dist/` build with no errors.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests: `HouseholdSetup` happy path (mocked F7 client: create household -> add a room -> add a person incl. child flag -> map a chore; asserts `HouseholdContext` ends with the new `householdId`) and an error render (mocked client returns a problem-details error; the step shows the message and does not advance).

## Risks & Rollback
- R: Expo 57 API drift. Mitigation: follow the versioned docs per `AGENTS.md`. R: onboarding blocked if any H1-H4 endpoint shape differs from the F7 client types. Mitigation: use the F7 typed client and mock it in tests; integration is validated against the real API in the loop. Rollback = revert the PR; onboarding returns to the F7 placeholder Home screen.

---

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD and its binding [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) (Section 7).
- [brd/README.md](README.md) - epic index, label taxonomy, dependency order, and the `gh issue create` recipe.
- [10-epic-foundations.md](10-epic-foundations.md) - previous epic; F3, F6, and F7 block this one.
- [30-epic-tap-to-claim-hub.md](30-epic-tap-to-claim-hub.md) - next epic; adds the no-password tap-to-claim CLAIM action (T1) on top of this roster.
