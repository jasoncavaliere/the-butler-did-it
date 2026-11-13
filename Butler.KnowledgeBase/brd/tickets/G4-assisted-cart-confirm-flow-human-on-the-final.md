---
type: Ticket
title: "G4: Assisted-cart confirm flow (human on the final tap)"
description: "Assisted-cart confirm flow: a human reviews the building cart and confirms it on the final tap."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/29
tags: [epic:grocery, area:api, type:feature, priority:p0]
epic: ../50-epic-grocery-assisted-cart.md
blocked-by: [G2, F6]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# G4: Assisted-cart confirm flow (human on the final tap)

**Sub-service(s):** `Butler.API/`
**Blocked by:** G2 (`#<G2>`), F6 (`#<F6>`)
**Serves:** FR-5, BO-3

## Summary
Let a human review the building cart and confirm it. Confirm requires the organizer, flips the cart to `Confirmed` with who/when, is idempotent, and - per D-8 - places no real order and moves no money. It records intent only.

## Context
This is the "human on the final tap" from [Section 6.4](../00-brd-master.md#64-grocery-the-monthly-wow) and the enforcement point for decision [D-8](../00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions). Confirm is a sensitive action, so it carries the `Organizer` policy from F6 ([Engineering Contract 7.4](../engineering-contract/74-authentication-and-authorization.md)); a tap-to-claim participant or the hub device cannot confirm. No money movement and no external order call is the whole point - it keeps tap-to-claim safe (R-1). The clock is injected for a deterministic `ConfirmedUtc`.

## Acceptance Criteria
- [ ] `GET` returns the current building cart (cart + items) for organizer review.
- [ ] `POST` confirm carries `[Authorize(Policy = "Organizer")]`; a participant/hub session (no organizer JWT) receives `403`.
- [ ] A successful confirm sets `Status = Confirmed`, `ConfirmedByPersonId` to the organizer's person, and `ConfirmedUtc` from the injected clock, using cart optimistic concurrency.
- [ ] Confirm is idempotent: confirming an already-`Confirmed` cart is a no-op success (does not change `ConfirmedByPersonId`/`ConfirmedUtc` and does not error).
- [ ] Confirm places no real order and moves no money - it records intent only (per D-8); there is no external HTTP/store/payment call in the confirm path.
- [ ] Unknown household or no building cart to confirm returns `404` (RFC 7807).
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `ConfirmCartTests` covering confirm-requires-organizer (participant/hub -> `403`), confirm-sets-status (status/who/when set from injected clock), double-confirm-idempotent (second confirm is a no-op success), and no-money-side-effect (assert no external/store/payment call is made - the connector is not invoked on confirm).

## Risks & Rollback
- R-1 (BRD): tap-to-claim trusts whoever is at the hub. Mitigation: the organizer policy on confirm plus D-8 (no money moves) is the safety boundary; the no-side-effect test is an AC. Rollback = revert; the cart stays reviewable but not confirmable.
