---
type: Epic
title: "Epic 50 - Grocery: Assisted Cart (real-world execution)"
description: "One demoable grocery flow: the IStoreConnector seam with a simulated HEB catalog, cart, capture, and the confirm step."
tags: [epic:grocery]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 50 - Grocery: Assisted Cart (real-world execution)

**Goal:** prove Butler does work, not just tracks it - one demoable grocery flow that goes capture -> cart -> human-confirmed order, behind a real `IStoreConnector` seam whose only v1 implementation is a deterministic `SimulatedHebConnector` backed by a checked-in fixture catalog. This is the "add oat milk -> review -> confirm" journey from [Section 6.4](00-brd-master.md#64-grocery-the-monthly-wow), made real end to end with no network and no money.

**Serves:** FR-5, BO-3.
**Blocked by Foundations and the household spine.** These tickets assume the storage, auth, test, and household layers from Epics 10 and 20 already landed.

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<Xn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it. Three decisions are load-bearing for this epic and are not up for reinterpretation: D-4 (real seam, simulated connector), D-5 (capture seam, live Alexa deferred), and D-8 (no money moves - confirm records intent only).

## Tickets

- [G1: `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog)](tickets/G1-istoreconnector-abstraction.md) - The IStoreConnector seam and a deterministic SimulatedHebConnector over a checked-in fixture catalog.
- [G2: Cart domain + `Carts`/`CartItems` tables](tickets/G2-cart-domain-carts-cartitems-tables.md) - Carts and CartItems tables, a get-or-create building cart for the week, and a cart read endpoint.
- [G3: Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice](tickets/G3-capture-seam-icapturesource-add-to-cart-via.md) - ICaptureSource seam that turns a typed or simulated spoken utterance into an item in the building cart.
- [G4: Assisted-cart confirm flow (human on the final tap)](tickets/G4-assisted-cart-confirm-flow-human-on-the-final.md) - Assisted-cart confirm flow: a human reviews the building cart and confirms it on the final tap.
- [G5: UI - grocery cart on the hub (add, review, confirm)](tickets/G5-ui-grocery-cart-on-the-hub-add-review-confirm.md) - Hub grocery screen: anyone adds items by typing, and a signed-in organizer confirms the cart.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD; Section 7 Engineering Contract, Section 6.4 grocery journey, and decisions D-4/D-5/D-8 that bind this epic.
- [filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order, and the `gh issue create` recipe.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - the wedge epic; shares the household spine and the organizer/participant authorization boundary.
- [60-epic-offline-pwa.md](60-epic-offline-pwa.md) - offline PWA; the cart is one of the writes that must queue and sync.
