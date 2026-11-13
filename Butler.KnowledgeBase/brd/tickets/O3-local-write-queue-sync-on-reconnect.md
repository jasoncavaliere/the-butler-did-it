---
type: Ticket
title: "O3: Local write queue + sync-on-reconnect"
description: Durable local write queue for offline chore completions, replayed in order on reconnect.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/33
tags: [epic:offline, area:ui, type:feature, priority:p0]
epic: ../60-epic-offline-pwa.md
blocked-by: [O2, C4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# O3: Local write queue + sync-on-reconnect

**Sub-service(s):** `Butler.UI/`
**Blocked by:** O2 (`#<O2>`), C4 (`#<C4>`)
**Serves:** FR-6, BO-5

## Summary
Let a chore-completion tap (and optionally a cart add) succeed while offline: write it to a durable local queue, reflect it optimistically in the UI, and replay the queue against the API in order when the network returns. Replay is safe because completions are append-only and assignment status is last-writer-wins.

## Context
Implements [BRD 6.5 step 2](../00-brd-master.md#65-offline-any-time): "Maya taps a chore done; the write queues locally and syncs when the network returns." C4 built the complete-a-chore write path; this ticket wraps it so a tap does not require a live network. The safety argument is [R-2](../00-brd-master.md#11-assumptions-risks-and-dependencies): `ChoreCompletions` are append-only and assignment `Status` is last-writer-wins per `(householdId, week, chore)` with optimistic concurrency, so replaying a queued write - even the same one twice - does not corrupt state or double-count. The queue must be durable (survive a reload/relaunch of the hub), replay in the order writes were made, and never silently drop a write: a failure is retried and, if it ultimately cannot sync, surfaced (O4 renders that surface). Optimistic UI means the tap looks done immediately; if the eventual sync fails, that is surfaced rather than reverted silently.

## Acceptance Criteria
- [ ] While offline, a chore-completion tap is written to a durable local queue (survives a page reload / app relaunch) and is reflected optimistically in the UI immediately.
- [ ] A cart add MAY use the same queue; if included it follows the identical durable-queue + replay contract. If deferred, the queue is designed to carry more than one write type (not hard-wired to completions only).
- [ ] On reconnect, queued writes are replayed against the API in the order they were enqueued.
- [ ] Replay is idempotent and safe: because completions are append-only and assignment status is last-writer-wins, a completion that syncs twice does not double-count and does not corrupt assignment state (a client-side de-duplication key or equivalent guards double-send).
- [ ] A failed replay is retried (with backoff, not a tight loop); a write is only removed from the queue after the API confirms it.
- [ ] A write that ultimately fails to sync is not silently dropped - it remains queued/flagged and is surfaced (the surface itself is O4).
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (mocked network + storage + fake timers): queue-persists-offline (enqueue while offline -> survives a simulated reload -> still present), replay-on-reconnect (going online drains the queue via the API in order), replay-idempotent (the same completion sent twice does not double-count and the queue clears once), and failed-replay-is-retried-not-dropped.

## Risks & Rollback
- R-2 (BRD): offline sync conflicts (two devices, same chore). Mitigation is the contract itself - append-only completions + last-writer-wins assignment status - which this ticket relies on rather than adding client-side conflict resolution; the idempotency test is the AC that proves replay is safe. Rollback = revert; a tap offline reverts to failing (no queue), while cached reads (O2) remain.
- R: a poison write blocks the queue forever. Mitigation: bounded retries then flag-and-continue (surface via O4), never an unbounded blocking retry.
