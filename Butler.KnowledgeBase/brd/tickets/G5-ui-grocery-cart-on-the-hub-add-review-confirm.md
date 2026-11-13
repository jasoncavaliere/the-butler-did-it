---
type: Ticket
title: "G5: UI - grocery cart on the hub (add, review, confirm)"
description: "Hub grocery screen: anyone adds items by typing, and a signed-in organizer confirms the cart."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/30
tags: [epic:grocery, area:ui, type:feature, priority:p0]
epic: ../50-epic-grocery-assisted-cart.md
blocked-by: [G3, G4, T4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# G5: UI - grocery cart on the hub (add, review, confirm)

**Sub-service(s):** `Butler.UI/`
**Blocked by:** G3 (`#<G3>`), G4 (`#<G4>`), T4 (`#<T4>`)
**Serves:** FR-5, BO-3

## Summary
Put the grocery flow on the hub: a screen where anyone can add an item by typing, the cart lists what has been added, and a signed-in organizer can confirm. This is the demoable "add oat milk -> review -> confirm" path from end to end against the simulated connector.

## Context
The UI surface for the whole epic. It builds on the F7 API client + household context and the T4 organizer sign-in state to gate the confirm action. Adding an item calls G3; confirming calls G4. The demo must work fully offline of any real store because the backing connector is the G1 simulated one. Follows the UI conventions from F4 ([Engineering Contract 7.1](../engineering-contract/71-repository-and-toolchains.md)); read the versioned Expo docs per `Butler.UI/AGENTS.md` before writing code.

## Acceptance Criteria
- [ ] A hub grocery screen lets anyone add an item by typing a term (for example `"oat milk"`); the entry resolves via the G3 capture endpoint and the resolved item appears in the cart.
- [ ] The cart lists items with their `DisplayName` and `Quantity`.
- [ ] A `Confirm` action is visible only to a signed-in organizer (from T4); it is hidden/absent for a tap-to-claim participant or unauthenticated hub session, and calls the G4 confirm endpoint.
- [ ] After a successful confirm, the screen shows a confirmed state (the cart reads as `Confirmed`).
- [ ] Ambiguous/no-match add input surfaces the G3 suggestions or a clear not-found message rather than a silent failure.
- [ ] The "add oat milk -> review -> confirm" path works end to end against the simulated connector (documented as the demo path).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: component tests covering add-item-renders (adding a term renders the item in the cart, mocked client), confirm-hidden-without-organizer (no organizer -> no Confirm action), and confirm-flow (organizer taps Confirm -> confirmed state, mocked client).

## Risks & Rollback
- R: the confirm control leaks to non-organizers. Mitigation: gate on the T4 organizer state and cover it with the confirm-hidden-without-organizer test (an AC); the API still enforces `403` (G4) as defense in depth. Rollback = revert; the API-side flow (G1-G4) stays intact and independently testable.
