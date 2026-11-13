---
type: Ticket
title: "O1: PWA manifest, service worker, and installability"
description: "Installable PWA: web app manifest, service worker registration, and an app-shell cache for offline reloads."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/31
tags: [epic:offline, area:ui, type:feature, priority:p0]
epic: ../60-epic-offline-pwa.md
blocked-by: [F4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# O1: PWA manifest, service worker, and installability

**Sub-service(s):** `Butler.UI/`
**Blocked by:** F4 (`#<F4>`)
**Serves:** FR-6, BO-5

## Summary
Turn the Expo web export into an installable PWA: ship a valid web app manifest, register a service worker, and cache the app shell so a second load works with no network. This is the foundation the offline cache (O2) and write queue (O3) build on.

## Context
The v1 hub is the Expo web export deployed as an Azure Static Web App and installed as a PWA on the family tablet ([BRD 2](../00-brd-master.md#2-product-opportunity-and-vision-v1)). Installability requires three things served together - a manifest, a registered service worker, and an https (or localhost) origin - so this ticket lands them as one unit. The service worker here caches only static assets (the app shell); data caching is O2 and the write queue is O3. Follow the versioned Expo 57 web docs for how the export emits and references these files (`Butler.UI/AGENTS.md`); do not hand-roll a build step the exporter already provides.

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
