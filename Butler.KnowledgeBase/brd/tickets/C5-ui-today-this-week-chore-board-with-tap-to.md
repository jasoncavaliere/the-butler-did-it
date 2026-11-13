---
type: Ticket
title: "C5: UI - today / this-week chore board with tap-to-complete"
description: Hub chore board for today and this week, with the active participant's items glowing and tap-to-complete.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/24
tags: [epic:chores, area:ui, type:feature, priority:p0]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [C3, C4, T3]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C5: UI - today / this-week chore board with tap-to-complete

**Sub-service(s):** `Butler.UI/`
**Blocked by:** C3 (`#<C3>`), C4 (`#<C4>`), T3 (`#<T3>`)
**Serves:** FR-4, BO-1

## Summary
Fill the hub "today" panel with the week's assignments grouped by day and person, glow the active participant's items (from the T3 tap-to-claim state), and let a tap mark an item done via C4 with an optimistic UI update and a distinct completed visual state.

## Context
This is the visible half of the wedge and the payoff of journey 6.2. The board reads assignments from C3 and completes through C4 using the F7 API client. The active-participant glow reuses the tap-to-claim selection from Epic 30 (T3); this ticket does not re-implement claim, it consumes it. Follow the web-first Expo conventions and test runner set up in F4 (see `Butler.UI/AGENTS.md` for the exact versioned APIs).

## Acceptance Criteria
- [ ] The hub "today" panel (the placeholder from T2) renders the current week's assignments grouped by day and by person, sourced from the C3-generated assignment set via the F7 client.
- [ ] When a participant is active (the T3 selection), that person's assignment items are visually highlighted ("glow"); with no active participant the board still renders read-only.
- [ ] Tapping an assignment item calls the C4 complete endpoint and applies an optimistic UI update (the item shows a completed state immediately), reconciling on the response and reverting on error.
- [ ] Completed items are visually distinct from open items (for example checked/dimmed), and a completed item is not re-submittable in a way that produces an error (matches C4 idempotency).
- [ ] Component tests cover: render-grouped-board (assignments appear grouped by day and person), glow-for-active-participant (the active person's items are highlighted), and tap-marks-done (tapping calls the mocked client and the item moves to the completed state).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: `ChoreBoard.test.tsx` (render-grouped-board, glow-for-active-participant, tap-marks-done) with the API client mocked.

## Risks & Rollback
- R: an optimistic update that never reconciles leaves a chore looking done when the write failed. Mitigation: the revert-on-error path is an AC and is covered by the tap test. Rollback = revert; the "today" panel returns to its T2 placeholder.
