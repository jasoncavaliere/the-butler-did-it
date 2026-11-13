---
type: Ticket
title: "G2: Cart domain + `Carts`/`CartItems` tables"
description: Carts and CartItems tables, a get-or-create building cart for the week, and a cart read endpoint.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/27
tags: [epic:grocery, area:api, type:feature, priority:p0]
epic: ../50-epic-grocery-assisted-cart.md
blocked-by: [F3, H1]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# G2: Cart domain + `Carts`/`CartItems` tables

**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), H1 (`#<H1>`)
**Serves:** FR-5

## Summary
Persist the weekly cart: `Carts` and `CartItems` tables (partitioned by `householdId`, keyed by `weekIso`) with repositories, a get-or-create "building" cart for the current week, and a read endpoint that returns the cart with its items.

## Context
Implements the `Carts`/`CartItems` rows in [Engineering Contract 7.3](../engineering-contract/73-data-model.md) on the shared Table Storage base from F3. `weekIso` is computed server-side from an injected/supplied date (never `DateTime.Now` in a handler). The cart is the container the capture flow (G3) writes into and the confirm flow (G4) transitions.

## Acceptance Criteria
- [ ] A `Carts` entity exists (PartitionKey `householdId`, RowKey `{weekIso}`) with `Status` (`Building`|`Confirmed`), `ConfirmedByPersonId` (nullable), and `ConfirmedUtc` (nullable), behind an `ICartRepository`.
- [ ] A `CartItems` entity exists (PartitionKey `householdId`, RowKey `{cartWeekIso}_{itemId}`) with `ProductId`, `DisplayName`, `Quantity`, `AddedByPersonId`, and `SourceConnector`, behind an `ICartItemRepository`.
- [ ] A get-or-create operation returns the `Building` cart for the current week (creating one if none exists) - it never returns a `Confirmed` cart as the building cart.
- [ ] `GET` the cart for a household+week returns the cart plus its items in one response shape.
- [ ] Optimistic concurrency applies to the cart via the F3 helper: reads return `ETag`; updates require `If-Match` (`428` when missing, `412` when stale).
- [ ] An unknown household returns `404` (RFC 7807 problem details).
- [ ] `weekIso` is computed from an injected clock / supplied date, deterministically.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `CartRepositoryTests` (get-or-create returns a building cart, second call returns the same cart), `CartItemRepositoryTests` (add then list round-trips items with all fields), and a concurrency test (stale `If-Match` on the cart -> `412`).

## Risks & Rollback
- R: a confirmed week and a new building cart could collide on the same `weekIso` RowKey. Mitigation: get-or-create only ever hands back the single row for the week and blocks writes once `Confirmed` (enforced in G4). Rollback = revert; G3/G4 are blocked on this and would not have shipped.
