---
type: Ticket
title: "H1: Household aggregate + Households table + create/get household"
description: "Households feature: the household aggregate, its table repository, and create and get endpoints."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/10
tags: [epic:household-model, area:api, type:feature, priority:p0]
epic: ../20-epic-household-model.md
blocked-by: [F3, F6]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# H1: Household aggregate + Households table + create/get household

**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), F6 (`#<F6>`)
**Serves:** FR-2

## Summary
Create the Households feature (`Application/Households/` + `Infrastructure/Households/` + `AddHouseholdFeature()`) with a `TableHouseholdRepository` on the F3 access layer, plus endpoints to create and read a household. This is the root aggregate every later table hangs off; creating a household also creates the organizer's `People` row so the household is never left without an organizer.

## Context
Implements the `Households` and (partially) `People` rows in [Engineering Contract 7.3](../engineering-contract/73-data-model.md), following the feature-extension pattern from [7.2](../engineering-contract/72-api-architecture.md) and the auth model in [7.4](../engineering-contract/74-authentication-and-authorization.md). The organizer is the only authenticated user (F6); creating a household binds that organizer's object id to an `Organizer` `People` row so downstream features have a real roster owner. Uses the F3 repository base for CRUD and the F6 `Organizer` policy for the mutation.

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
