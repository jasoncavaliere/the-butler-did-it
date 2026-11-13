---
type: Ticket
title: "O4: Offline status UI (indicator + queued-writes surfaced)"
description: "Offline status UI: online/offline indicator, pending-write count, sync confirmation, and failed writes surfaced."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/34
tags: [epic:offline, area:ui, type:feature, priority:p1]
epic: ../60-epic-offline-pwa.md
blocked-by: [O3]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# O4: Offline status UI (indicator + queued-writes surfaced)

**Sub-service(s):** `Butler.UI/`
**Blocked by:** O3 (`#<O3>`)
**Serves:** FR-6, BO-5

## Summary
Give the hub a persistent, unobtrusive online/offline indicator, show a pending count while writes are queued, confirm briefly when a sync succeeds, and surface any write that ultimately fails so the organizer can see it - never hide it.

## Context
O2 marks reads as last-known and O3 queues writes; this ticket makes the hub's connection and sync state legible on the shared tablet without nagging. The indicator is ambient (the hub is glanceable all day, so it must not shout), but a queued-write pending count and a failed-write surface are the honest feedback that keeps the pull habit trustworthy: a family member who taps a chore done offline should be able to see it is pending, then confirmed. A write that cannot sync (O3's terminal-failure case) is surfaced for the organizer rather than dropped.

## Acceptance Criteria
- [ ] A persistent, unobtrusive indicator reflects the current online/offline state and updates when connectivity changes.
- [ ] When one or more writes are queued (from O3), the indicator shows a pending count.
- [ ] On successful sync, the pending state clears and a brief, non-blocking confirmation is shown.
- [ ] A queued write that ultimately fails to sync is surfaced for the organizer to see (a visible failed state), not hidden or auto-cleared.
- [ ] The indicator does not obstruct the daily glance (it is unobtrusive by default and does not cover the board or name tiles).
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (mocked network + storage, driving O3's queue state): indicator-reflects-state (online <-> offline toggles the indicator), pending-count-updates (enqueuing writes raises the count), cleared-after-sync (drain clears pending and shows the confirmation), and failed-write-is-surfaced.

## Risks & Rollback
- R: the indicator becomes a nag or covers the board, hurting the ambient glance (BO-5). Mitigation: unobtrusive-by-default is an AC; keep the failed-write surface compact and organizer-facing. Rollback = revert; O3's queue still functions, only its state is not shown (undesirable, so land this with O3).
- R: connectivity "online" reported by the browser but the API is unreachable. Mitigation: drive the indicator from actual sync success/failure (O3), not only the browser online event.
