---
type: Ticket
title: "T3: Tap-to-claim UI (name tiles, claim, \"what's mine glows\")"
description: "Tap-to-claim UI: tapping a name tile makes that person active and their items glow, with no password ever."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/17
tags: [epic:tap-to-claim, area:ui, type:feature, priority:p0]
epic: ../30-epic-tap-to-claim-hub.md
blocked-by: [T1, T2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# T3: Tap-to-claim UI (name tiles, claim, "what's mine glows")

**Sub-service(s):** `Butler.UI/`
**Blocked by:** T1 (`#<T1>`), T2 (`#<T2>`)
**Serves:** FR-3, BO-4

## Summary
Wire the name tiles to the T1 claim endpoint so tapping a name makes that person the active participant - no password prompt, ever - visually highlights their items ("what's mine glows"), lets a tap switch to another person, and clears the active participant back to the neutral glance state after an idle timeout.

## Context
This is the interactive core of the daily-glance journey ([6.2](../00-brd-master.md#62-the-daily-glance-any-participant-ambient)) and the behavior BO-4 measures (distinct participants active per household per week). It renders on the T2 shell and calls the T1 endpoints. The active participant is UI state only; it becomes the actor Epic 40 C4 attributes completions to, via the participant session from T1. Never introduce a password or per-user login on the shared device (D-3, and the vision's "multiplayer is the whole game").

## Acceptance Criteria
- [ ] Tapping a name tile calls the T1 `claim` endpoint and, on success, sets that person as the active participant in UI state; **no** password or PIN prompt is shown at any point.
- [ ] The active participant is visually indicated (the selected tile), and their items are highlighted ("glow"); when no participant is active the shell is in a neutral glance state with nothing highlighted.
- [ ] Tapping the active participant again, or tapping a different name tile, switches the active participant (and moves the glow) - re-claiming via T1 as needed.
- [ ] An idle timeout (no interaction for a configured interval) clears the active participant back to the neutral glance state.
- [ ] The participant session returned by T1 is held in UI state for attributing completions (the seam Epic 40 C4 uses); it is never persisted as a credential and never sent to organizer-policy endpoints.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (jest-expo, mocked claim client, fake timers): `claim-sets-active` (tapping a tile calls claim and marks that person active with glow), `switch` (tapping another name moves active + glow), `idle-clear` (advancing fake timers past the idle interval returns to the neutral state).

## Risks & Rollback
- R: an idle timeout that is too short annoys or too long leaks the wrong "active" person into a completion. Mitigation: the timeout is a single configured constant and the completion actor is re-read at write time (C4). Rollback = revert the PR; name tiles fall back to the non-interactive T2 shell.
