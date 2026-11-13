---
type: Epic
title: Epic 40 - Chores & Fair Assignment (the wedge)
description: "The v1 wedge: the deterministic fair-assignment engine, tap-to-complete chore board, and the fairness balance view."
tags: [epic:chores]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 40 - Chores & Fair Assignment (the wedge)

**Goal:** turn the household spine into the v1 wedge - a deterministic engine that divides the week's chores fairly across eligible people, a hub board where anyone can tap a chore done with no login, and a fairness view that shows the balance trending even. This is the loop [BO-1](00-brd-master.md#3-business-objectives-and-how-v1-serves-them) is won or lost on: make the work visible, make it fair, make completing it a one-tap habit.

**Serves:** FR-4, BO-1 (the wedge), and the Section 10 fairness success metric.

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<...>` placeholders (`#<C1>`, `#<F3>`, and so on) with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it. The fair-assignment algorithm is implemented **exactly** as specified in [Engineering Contract 7.6](engineering-contract/76-fair-assignment-algorithm.md); a ticket may not reinterpret it.

## Tickets

- [C1: Assignment + completion domain and tables](tickets/C1-assignment-completion-domain-and-tables.md) - Assignments and ChoreCompletions tables and repositories, plus an injected clock and a weekIso helper.
- [C2: Fair-assignment engine (pure, deterministic)](tickets/C2-fair-assignment-engine-pure-deterministic.md) - The fair-assignment engine as a pure, deterministic function, exactly per Contract 7.6.
- [C3: Generate / regenerate weekly assignments endpoint](tickets/C3-generate-regenerate-weekly-assignments-endpoint.md) - Endpoint that runs the C2 engine for a week and persists (or regenerates) the household's assignments.
- [C4: Complete a chore (tap-to-complete) endpoint](tickets/C4-complete-a-chore-tap-to-complete-endpoint.md) - Tap-to-complete endpoint: append a ChoreCompletion and mark the assignment Done under optimistic concurrency.
- [C5: UI - today / this-week chore board with tap-to-complete](tickets/C5-ui-today-this-week-chore-board-with-tap-to.md) - Hub chore board for today and this week, with the active participant's items glowing and tap-to-complete.
- [C6: Fairness view (contribution balance)](tickets/C6-fairness-view-contribution-balance.md) - Fairness view: an endpoint for each person's share of completed effort and a calm balance bar in the UI.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD; this epic implements FR-4 and serves BO-1, with the binding [Engineering Contract 7.6](engineering-contract/76-fair-assignment-algorithm.md) fair-assignment algorithm and the [7.3 data model](engineering-contract/73-data-model.md).
- [brd/filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order, and the `gh issue create` recipe.
- [30-epic-tap-to-claim-hub.md](30-epic-tap-to-claim-hub.md) - the hub shell, the tap-to-claim participant identity (T1), the active-participant glow (T3), and the "today" panel (T2) this epic fills in.
- [60-epic-offline-pwa.md](60-epic-offline-pwa.md) - caches the board and queues the completions this epic writes, so the wedge loop survives no network.
