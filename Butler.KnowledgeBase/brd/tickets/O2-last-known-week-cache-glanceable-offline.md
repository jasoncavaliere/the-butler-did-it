---
type: Ticket
title: "O2: Last-known-week cache (glanceable offline)"
description: Last-known-week cache so today's board and the name tiles still render with no network.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/32
tags: [epic:offline, area:ui, type:feature, priority:p0]
epic: ../60-epic-offline-pwa.md
blocked-by: [O1, C5]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# O2: Last-known-week cache (glanceable offline)

**Sub-service(s):** `Butler.UI/`
**Blocked by:** O1 (`#<O1>`), C5 (`#<C5>`)
**Serves:** FR-6, BO-5

## Summary
Cache the data behind the daily glance - the household, its people, and the current week's assignments - in browser storage on every successful load, and render today's board and the name tiles from that cache when the network is down, clearly marked as last-known.

## Context
Implements [BRD 6.5 step 1](../00-brd-master.md#65-offline-any-time): "the network drops, the hub still shows the last-known week and today's board." C5 built the chores board and name tiles from live data; this ticket wraps that read path so the same board renders from cache when the fetch fails. Guardrail BO-5: the hub renders today's board with the network disabled. Cache only what the glance needs (household + people + current-week assignments, keyed by `householdId`); this is a read cache - writes are O3. The cache must stay readable and glanceable (real tiles, real names), not a spinner or an error - and it must not silently look live, so it carries a freshness timestamp and a visible "showing last-known" indication.

## Acceptance Criteria
- [ ] On a successful load, the household, its people, and the current week's assignments are written to browser storage, scoped by `householdId`, with a freshness timestamp.
- [ ] When a load fails because the network is unavailable, the hub renders today's board and the name tiles from the cached data - readable and glanceable, not an error or empty state.
- [ ] A clear, unobtrusive "showing last-known" indication (with or derived from the freshness timestamp) is visible whenever the view is served from cache.
- [ ] On reconnect / next successful load, the cache and its freshness timestamp are refreshed with the live data, and the last-known indication clears.
- [ ] The cache is a read cache only; it does not swallow or replace the write path (O3 owns writes) and it does not display data from a different `householdId`.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (mocked network + storage): render-from-cache-when-offline (fetch rejects -> board and name tiles render from seeded cache with the last-known indication), cache-write-on-successful-load, and cache-refresh-on-reconnect (indication clears, timestamp updates).

## Risks & Rollback
- R: cache goes stale or shows a prior week as if current. Mitigation: freshness timestamp + visible last-known indication + refresh on every successful load; key by `householdId` and `weekIso`. Rollback = revert; offline load reverts to the O1 app-shell-only behavior (shell loads, data view is empty/error offline).
- R: storage quota or a corrupt cache entry. Mitigation: treat a missing/unparseable cache as "no cache" (fall through to the normal empty/error path), never crash the render.
