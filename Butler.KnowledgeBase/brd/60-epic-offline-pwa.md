# Epic 60 - Offline-Tolerant PWA

**Goal:** make the shared hub survive with no network. The daily glance is a pull habit (Maya walks past, taps her name, taps a chore done), and a habit that breaks the moment the Wi-Fi drops is not a habit. This epic makes the last-known week stay glanceable and readable offline, and makes writes queue locally and sync on reconnect - without reintroducing conflicts. It lands late on purpose: it caches the loop (the chores board from C5, the cart from G5) that must already exist to be cached. See [BRD 6.5 (offline journey)](00-brd-master.md#65-offline-any-time) and risk [R-2 (sync conflicts)](00-brd-master.md#11-assumptions-risks-and-dependencies).

**Serves:** FR-6, BO-5.
**Lands last.** It depends on Chores (Epic 40) and Grocery (Epic 50) so there is a real loop to cache.

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<Fn>`/`#<Cn>`/`#<Gn>`/`#<On>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it. This is a UI epic: the hub is web-first (Expo web export -> Azure Static Web App / installable PWA), so all tickets touch `Butler.UI/` only and all gates are UI gates - `cd Butler.UI && npm run ci:verify` and `npx expo export --platform web`. Read the exact versioned Expo 57 docs before writing code (`Butler.UI/AGENTS.md`).

---

## O1: PWA manifest, service worker, and installability

**Labels:** `epic:offline` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** F4 (`#<F4>`)
**Serves:** FR-6, BO-5

## Summary
Turn the Expo web export into an installable PWA: ship a valid web app manifest, register a service worker, and cache the app shell so a second load works with no network. This is the foundation the offline cache (O2) and write queue (O3) build on.

## Context
The v1 hub is the Expo web export deployed as an Azure Static Web App and installed as a PWA on the family tablet ([BRD 2](00-brd-master.md#2-product-opportunity-and-vision-v1)). Installability requires three things served together - a manifest, a registered service worker, and an https (or localhost) origin - so this ticket lands them as one unit. The service worker here caches only static assets (the app shell); data caching is O2 and the write queue is O3. Follow the versioned Expo 57 web docs for how the export emits and references these files (`Butler.UI/AGENTS.md`); do not hand-roll a build step the exporter already provides.

## Acceptance Criteria
- [ ] The Expo web export includes a valid web app manifest with at least `name`/`short_name`, `icons` (including a maskable-capable icon at 192px and 512px), `display: "standalone"`, `start_url`, and `theme_color` + `background_color`.
- [ ] A service worker is registered by the exported app on load (registration is a no-op or graceful when the browser lacks service-worker support).
- [ ] The service worker precaches the app shell (the static JS/CSS/HTML/asset bundle) so a second load of the hub succeeds with the network disabled.
- [ ] The app remains installable: manifest + registered service worker + served over https/localhost satisfy the browser install criteria (installable prompt available on a supporting browser).
- [ ] `npx expo export --platform web` produces a `dist/` that contains the manifest and the service worker file(s), with the manifest linked from the exported HTML.
- [ ] A build/config test asserts the exported `dist/` contains the manifest and service worker and that the manifest has the required fields; if that cannot be asserted in the test runner, a documented manual Lighthouse "installable" check is included in the PR/README instead.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: a `dist/`-manifest assertion test (manifest present, required fields, SW file present) run after export; document the manual Lighthouse "installable" check if an automated assertion is not feasible.

## Risks & Rollback
- R: Expo 57 web export changes how the manifest/SW are emitted or referenced. Mitigation: follow the versioned docs per `AGENTS.md`; keep the config minimal and let the exporter own file placement. Rollback = revert the PR; the web export returns to a non-installable static site (no offline).
- R: an over-aggressive precache serves stale app code after a deploy. Mitigation: use the exporter's default cache-busting / versioned asset names and a service-worker update-on-activate; keep only static assets in this cache (data is O2).

---

## O2: Last-known-week cache (glanceable offline)

**Labels:** `epic:offline` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** O1 (`#<O1>`), C5 (`#<C5>`)
**Serves:** FR-6, BO-5

## Summary
Cache the data behind the daily glance - the household, its people, and the current week's assignments - in browser storage on every successful load, and render today's board and the name tiles from that cache when the network is down, clearly marked as last-known.

## Context
Implements [BRD 6.5 step 1](00-brd-master.md#65-offline-any-time): "the network drops, the hub still shows the last-known week and today's board." C5 built the chores board and name tiles from live data; this ticket wraps that read path so the same board renders from cache when the fetch fails. Guardrail BO-5: the hub renders today's board with the network disabled. Cache only what the glance needs (household + people + current-week assignments, keyed by `householdId`); this is a read cache - writes are O3. The cache must stay readable and glanceable (real tiles, real names), not a spinner or an error - and it must not silently look live, so it carries a freshness timestamp and a visible "showing last-known" indication.

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

---

## O3: Local write queue + sync-on-reconnect

**Labels:** `epic:offline` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** O2 (`#<O2>`), C4 (`#<C4>`)
**Serves:** FR-6, BO-5

## Summary
Let a chore-completion tap (and optionally a cart add) succeed while offline: write it to a durable local queue, reflect it optimistically in the UI, and replay the queue against the API in order when the network returns. Replay is safe because completions are append-only and assignment status is last-writer-wins.

## Context
Implements [BRD 6.5 step 2](00-brd-master.md#65-offline-any-time): "Maya taps a chore done; the write queues locally and syncs when the network returns." C4 built the complete-a-chore write path; this ticket wraps it so a tap does not require a live network. The safety argument is [R-2](00-brd-master.md#11-assumptions-risks-and-dependencies): `ChoreCompletions` are append-only and assignment `Status` is last-writer-wins per `(householdId, week, chore)` with optimistic concurrency, so replaying a queued write - even the same one twice - does not corrupt state or double-count. The queue must be durable (survive a reload/relaunch of the hub), replay in the order writes were made, and never silently drop a write: a failure is retried and, if it ultimately cannot sync, surfaced (O4 renders that surface). Optimistic UI means the tap looks done immediately; if the eventual sync fails, that is surfaced rather than reverted silently.

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

---

## O4: Offline status UI (indicator + queued-writes surfaced)

**Labels:** `epic:offline` `area:ui` `type:feature` `priority:p1`
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

---

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD: Section 6.5 (offline journey), Section 7 (Engineering Contract), risk R-2 (sync conflicts), BO-5.
- [README.md](README.md) - epic index, label taxonomy, dependency order, and the filing recipe.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - the chores board (C5) and complete-a-chore write path (C4) this epic caches and queues.
- [50-epic-grocery-assisted-cart.md](50-epic-grocery-assisted-cart.md) - the cart (G5) whose add MAY ride the same offline queue.
