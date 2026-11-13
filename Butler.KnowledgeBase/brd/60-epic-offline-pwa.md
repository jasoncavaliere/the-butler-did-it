---
type: Epic
title: Epic 60 - Offline-Tolerant PWA
description: "Installable, offline-tolerant PWA: manifest and service worker, last-known-week cache, durable write queue, and offline status UI."
tags: [epic:offline]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 60 - Offline-Tolerant PWA

**Goal:** make the shared hub survive with no network. The daily glance is a pull habit (Maya walks past, taps her name, taps a chore done), and a habit that breaks the moment the Wi-Fi drops is not a habit. This epic makes the last-known week stay glanceable and readable offline, and makes writes queue locally and sync on reconnect - without reintroducing conflicts. It lands late on purpose: it caches the loop (the chores board from C5, the cart from G5) that must already exist to be cached. See [BRD 6.5 (offline journey)](00-brd-master.md#65-offline-any-time) and risk [R-2 (sync conflicts)](00-brd-master.md#11-assumptions-risks-and-dependencies).

**Serves:** FR-6, BO-5.
**Lands last.** It depends on Chores (Epic 40) and Grocery (Epic 50) so there is a real loop to cache.

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<Fn>`/`#<Cn>`/`#<Gn>`/`#<On>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it. This is a UI epic: the hub is web-first (Expo web export -> Azure Static Web App / installable PWA), so all tickets touch `Butler.UI/` only and all gates are UI gates - `cd Butler.UI && npm run ci:verify` and `npx expo export --platform web`. Read the exact versioned Expo 57 docs before writing code (`Butler.UI/AGENTS.md`).

## Tickets

- [O1: PWA manifest, service worker, and installability](tickets/O1-pwa-manifest-service-worker-and-installability.md) - Installable PWA: web app manifest, service worker registration, and an app-shell cache for offline reloads.
- [O2: Last-known-week cache (glanceable offline)](tickets/O2-last-known-week-cache-glanceable-offline.md) - Last-known-week cache so today's board and the name tiles still render with no network.
- [O3: Local write queue + sync-on-reconnect](tickets/O3-local-write-queue-sync-on-reconnect.md) - Durable local write queue for offline chore completions, replayed in order on reconnect.
- [O4: Offline status UI (indicator + queued-writes surfaced)](tickets/O4-offline-status-ui-indicator-queued-writes.md) - Offline status UI: online/offline indicator, pending-write count, sync confirmation, and failed writes surfaced.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD: Section 6.5 (offline journey), Section 7 (Engineering Contract), risk R-2 (sync conflicts), BO-5.
- [filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order, and the filing recipe.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - the chores board (C5) and complete-a-chore write path (C4) this epic caches and queues.
- [50-epic-grocery-assisted-cart.md](50-epic-grocery-assisted-cart.md) - the cart (G5) whose add MAY ride the same offline queue.
