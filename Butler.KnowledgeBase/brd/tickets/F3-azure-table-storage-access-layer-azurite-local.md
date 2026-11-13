---
type: Ticket
title: "F3: Azure Table Storage access layer + Azurite local development"
description: Shared Table Storage access seam with optimistic-concurrency helpers, and local development on Azurite.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/5
tags: [epic:foundations, area:api, area:infra, type:feature, priority:p0]
epic: ../10-epic-foundations.md
blocked-by: [F1, F2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F3: Azure Table Storage access layer + Azurite local development

**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-1, BO-6

## Summary
Provide the shared Table Storage access seam (a table-client factory + a generic repository base with optimistic-concurrency helpers) and a local dev path against Azurite, so every data feature (H1+, C1+, G1+) has a consistent, tested persistence base.

## Context
Implements [Engineering Contract 7.3](../engineering-contract/73-data-model.md). `householdId` is the partition key everywhere. Mirrors QControl's `Azure.Data.Tables` repositories + Azurite + seed-fallback so the API runs with no cloud storage.

## Acceptance Criteria
- [ ] `Azure.Data.Tables` and `Azure.Identity` are referenced (central versions).
- [ ] A `TableClientFactory` (or equivalent seam) resolves a `TableClient` per table name from configuration; connection is configurable (connection string locally, managed identity in deployed envs).
- [ ] A shared repository base or helper provides: entity CRUD scoped by `PartitionKey = householdId`, and optimistic concurrency (`ETag` on read; `If-Match` on update -> `428` when missing, `412` when stale) via a reusable helper under `Application/Concurrency/`.
- [ ] A `Start-LocalSession.ps1` (or documented equivalent) starts repo-local Azurite and runs the API in Development; README documents it.
- [ ] A configuration flag lets the API fall back to an in-memory/seed store when no storage is configured (so local runs and tests need no Azurite).
- [ ] Unit tests cover the concurrency helper (missing `If-Match` -> `428`, stale -> `412`, match -> success) using an in-memory/faked table client.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `OptimisticConcurrencyTests`, `TableClientFactoryTests` (config resolution).

## Risks & Rollback
- R: an over-abstracted base slows later tickets. Mitigation: keep the base minimal (CRUD + concurrency only). Rollback = revert; later data tickets would then each wire their own client (undesirable) so land this before H1.
