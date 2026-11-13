---
type: Ticket
title: "G1: `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog)"
description: The IStoreConnector seam and a deterministic SimulatedHebConnector over a checked-in fixture catalog.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/26
tags: [epic:grocery, area:api, type:feature, priority:p0]
epic: ../50-epic-grocery-assisted-cart.md
blocked-by: [F1, F2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# G1: `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog)

**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-5, BO-3

## Summary
Ship the real store-connector seam and its one v1 implementation: an `IStoreConnector` interface plus a deterministic `SimulatedHebConnector` that searches a checked-in fixture catalog with no network dependency, so the rest of the grocery flow builds against a stable, swappable abstraction.

## Context
Implements decision [D-4](../00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions): HEB has no public consumer API, so v1 ships the real interface and a simulated implementation. The abstraction is what keeps "plug into any store later" honest. An aggregator/assisted connector and an official connector are explicitly deferred behind this exact seam (Section 9 fast-follow) - do not build them here, but do not close the interface against them either (hence `SourceConnector` on results). Follows the feature-extension pattern in [Engineering Contract 7.2](../engineering-contract/72-api-architecture.md).

## Acceptance Criteria
- [ ] An `IStoreConnector` interface defines at least `SearchProducts(query)` and `GetProduct(id)`, returning product DTOs with `ProductId`, `DisplayName`, `Size`/`Unit`, and an indicative price string (labelled non-transactional - it is display text, never a charge).
- [ ] A `SimulatedHebConnector` implements `IStoreConnector` against a checked-in fixture catalog (for example `SeedData/grocery/heb-catalog.json`) with at least a dozen representative products; search is case-insensitive and matches on `DisplayName` (and any catalog synonyms).
- [ ] Every result carries a `SourceConnector` value (for example `"simulated-heb"`) so a later connector can be swapped in without changing consumers.
- [ ] The feature is registered via an `AddStoreConnectorFeature()` extension wired in `Program.cs`; `IStoreConnector` resolves to `SimulatedHebConnector` in v1.
- [ ] No network calls exist in the connector or its tests (fully offline; the catalog is read from the checked-in fixture).
- [ ] Search is deterministic: the same query always returns the same ordered results.
- [ ] Builds clean with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `SimulatedHebConnectorTests` covering search-matches (a known term returns the expected product), search-no-match (empty result, not an exception), get-by-id (known and unknown id), and determinism (repeated identical queries return identical ordered results).

## Risks & Rollback
- R-3 (BRD): the simulated store is not a real integration. Mitigation: it is honest by design and swappable behind `IStoreConnector`; the demo is real even if the store is not. Rollback = revert the PR; no other feature has shipped against the seam yet at this point.
