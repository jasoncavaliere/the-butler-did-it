---
type: Crosswalk
title: Ticket to GitHub Issue Map (canonical crosswalk)
description: Generated map from each v1 ticket ID to its ticket file, epic, priority, blockers, and GitHub issue number.
tags: [brd, tickets, github-issues, crosswalk]
owner: product
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues
generated: { by: process:generate_issue_map, at: 2026-11-13T18:04:27Z }
---

# Butler v1 - Ticket to GitHub Issue Map

> **Canonical crosswalk.** This is the single source that bridges the BRD ticket IDs (F1, H1, ...), their ticket files, and the live GitHub issues. Future Claude sessions and team members reference this to translate between the planning docs and the tracker.

- **Repo:** `jasoncavaliere/the-butler-did-it`  -  **Issues:** https://github.com/jasoncavaliere/the-butler-did-it/issues
- **This file is generated.** Do not hand-edit the table. Re-run `python3 Butler.KnowledgeBase/brd/tools/generate_issue_map.py` after filing, renumbering, or closing issues.

## Conventions (how the three layers line up)

- **Ticket ID** (`F1`, `H3`, `C2`, ...) is the stable planning handle. Letter = epic (F=Foundations, H=Household, T=Tap-to-Claim, C=Chores, G=Grocery, O=Offline); the number orders within the epic.
- **Ticket file** `Butler.KnowledgeBase/brd/tickets/<ID>-<slug>.md` holds the full spec (Summary, Context, Acceptance Criteria, Testing, Risks); its epic file lists it.
- **GitHub issue** title is `"<ID>: <title>"`, so the ID is always recoverable from the tracker: `gh issue list --search "F1 in:title"`.
- **Blocked by** is captured as GitHub `#` cross-references in each issue body; the ticket files use `#<ID>` placeholders that this generator resolves to live numbers.
- **Labels** classify each issue: `epic:*`, `area:*` (api / ui / infra / docs), `type:*`, `priority:*`. The `/implement-issue` workflow adds its own `status:*` labels on top.

## Crosswalk

| Ticket | GitHub | Priority | Epic | Blocked by | Title |
| --- | --- | --- | --- | --- | --- |
| [**F1**](tickets/F1-establish-butler-api-layered-skeleton-mediatr.md) | #3 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | - | Establish Butler.API layered skeleton (MediatR + feature-extension pattern) |
| [**F2**](tickets/F2-butler-api-test-harness-xunit-nsubstitute.md) | #4 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3 (closed) | Butler.API test harness (xUnit + NSubstitute) |
| [**F3**](tickets/F3-azure-table-storage-access-layer-azurite-local.md) | #5 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3 (closed), F2 #4 (closed) | Azure Table Storage access layer + Azurite local development |
| [**F4**](tickets/F4-butler-ui-app-structure-component-test-harness.md) | #6 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | - | Butler.UI app structure + component test harness |
| [**F5**](tickets/F5-ci-workflows-for-api-and-ui-github-actions.md) | #7 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F2 #4 (closed), F4 #6 (closed) | CI workflows for API and UI (GitHub Actions) |
| [**F6**](tickets/F6-organizer-authentication-seam-entra-external-id.md) | #8 (closed) | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3 (closed), F2 #4 (closed) | Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass) |
| [**F7**](tickets/F7-ui-api-client-household-context-provider.md) | #9 (closed) | p1 | [Foundations & Delivery Rails](10-epic-foundations.md) | F3 #5 (closed), F4 #6 (closed) | UI API client + household context provider |
| [**H1**](tickets/H1-household-aggregate-households-table-create-get.md) | #10 (closed) | p0 | [Household Model](20-epic-household-model.md) | F3 #5 (closed), F6 #8 (closed) | Household aggregate + Households table + create/get household |
| [**H2**](tickets/H2-rooms-crud-rooms-table.md) | #11 (closed) | p0 | [Household Model](20-epic-household-model.md) | H1 #10 (closed) | Rooms CRUD (Rooms table) |
| [**H3**](tickets/H3-people-crud-people-table-organizer-managed.md) | #12 (closed) | p0 | [Household Model](20-epic-household-model.md) | H1 #10 (closed) | People CRUD (People table) - organizer-managed roster |
| [**H4**](tickets/H4-chores-crud-chores-table-attached-to-a-room.md) | #13 (closed) | p0 | [Household Model](20-epic-household-model.md) | H2 #11 (closed) | Chores CRUD (Chores table) attached to a room |
| [**H5**](tickets/H5-ui-household-setup-flow-organizer-onboarding.md) | #14 (closed) | p0 | [Household Model](20-epic-household-model.md) | H1 #10 (closed), H2 #11 (closed), H3 #12 (closed), H4 #13 (closed), F7 #9 (closed) | UI household setup flow (organizer onboarding) |
| [**T1**](tickets/T1-tap-to-claim-endpoint-participant-session-no.md) | #15 (closed) | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H3 #12 (closed) | Tap-to-claim endpoint + participant session (no password) |
| [**T2**](tickets/T2-hub-shell-and-always-on-today-layout.md) | #16 (closed) | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H1 #10 (closed), F7 #9 (closed) | Hub shell and always-on "today" layout |
| [**T3**](tickets/T3-tap-to-claim-ui-name-tiles-claim-what-s-mine.md) | #17 (closed) | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | T1 #15 (closed), T2 #16 (closed) | Tap-to-claim UI (name tiles, claim, "what's mine glows") |
| [**T4**](tickets/T4-organizer-sign-in-ui-entra-external-id.md) | #18 (closed) | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | F6 #8 (closed), F7 #9 (closed) | Organizer sign-in UI (Entra External ID) + sensitive-action gating |
| [**T5**](tickets/T5-hub-device-pairing-hubdevices.md) | #19 (closed) | p1 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H1 #10 (closed), F6 #8 (closed) | Hub device pairing (HubDevices) |
| [**C1**](tickets/C1-assignment-completion-domain-and-tables.md) | #20 (closed) | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | F3 #5 (closed), H4 #13 (closed) | Assignment + completion domain and tables |
| [**C2**](tickets/C2-fair-assignment-engine-pure-deterministic.md) | #21 (closed) | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C1 #20 (closed) | Fair-assignment engine (pure, deterministic) |
| [**C3**](tickets/C3-generate-regenerate-weekly-assignments-endpoint.md) | #22 (closed) | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C2 #21 (closed), H3 #12 (closed) | Generate / regenerate weekly assignments endpoint |
| [**C4**](tickets/C4-complete-a-chore-tap-to-complete-endpoint.md) | #23 (closed) | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C1 #20 (closed), T1 #15 (closed) | Complete a chore (tap-to-complete) endpoint |
| [**C5**](tickets/C5-ui-today-this-week-chore-board-with-tap-to.md) | #24 (closed) | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C3 #22 (closed), C4 #23 (closed), T3 #17 (closed) | UI - today / this-week chore board with tap-to-complete |
| [**C6**](tickets/C6-fairness-view-contribution-balance.md) | #25 (closed) | p1 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C4 #23 (closed) | Fairness view (contribution balance) |
| [**G1**](tickets/G1-istoreconnector-abstraction.md) | #26 (closed) | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | F1 #3 (closed), F2 #4 (closed) | `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog) |
| [**G2**](tickets/G2-cart-domain-carts-cartitems-tables.md) | #27 (closed) | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | F3 #5 (closed), H1 #10 (closed) | Cart domain + `Carts`/`CartItems` tables |
| [**G3**](tickets/G3-capture-seam-icapturesource-add-to-cart-via.md) | #28 (closed) | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G1 #26 (closed), G2 #27 (closed) | Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice |
| [**G4**](tickets/G4-assisted-cart-confirm-flow-human-on-the-final.md) | #29 (closed) | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G2 #27 (closed), F6 #8 (closed) | Assisted-cart confirm flow (human on the final tap) |
| [**G5**](tickets/G5-ui-grocery-cart-on-the-hub-add-review-confirm.md) | #30 (closed) | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G3 #28 (closed), G4 #29 (closed), T4 #18 (closed) | UI - grocery cart on the hub (add, review, confirm) |
| [**O1**](tickets/O1-pwa-manifest-service-worker-and-installability.md) | #31 (closed) | p0 | [Offline PWA](60-epic-offline-pwa.md) | F4 #6 (closed) | PWA manifest, service worker, and installability |
| [**O2**](tickets/O2-last-known-week-cache-glanceable-offline.md) | #32 (closed) | p0 | [Offline PWA](60-epic-offline-pwa.md) | O1 #31 (closed), C5 #24 (closed) | Last-known-week cache (glanceable offline) |
| [**O3**](tickets/O3-local-write-queue-sync-on-reconnect.md) | #33 (closed) | p0 | [Offline PWA](60-epic-offline-pwa.md) | O2 #32 (closed), C4 #23 (closed) | Local write queue + sync-on-reconnect |
| [**O4**](tickets/O4-offline-status-ui-indicator-queued-writes.md) | #34 | p1 | [Offline PWA](60-epic-offline-pwa.md) | O3 #33 (closed) | Offline status UI (indicator + queued-writes surfaced) |
| **D1** | #94 | - | (cross-cutting / docs) | - | Docker Compose demo stack: Azurite (persistent) + API + Caddy serving the PWA build |
| **DOC1** | #35 (closed) | - | (cross-cutting / docs) | - | Update the Knowledge Base to capture the v1 BRD architecture decisions |
| **D2** | #95 | - | (cross-cutting / docs) | - | Butler.API Dockerfile and `Demo` environment configuration |
| **DOC2** | #69 | - | (cross-cutting / docs) | - | Wire the adr/ decision records into the knowledge graph (pre-existing orphan cluster) |
| **D3** | #96 | - | (cross-cutting / docs) | - | Single origin: Caddy serves the hub at `/` and proxies `/api/*` to the API |
| **D4** | #97 | - | (cross-cutting / docs) | - | Demo seeder: a sample family with history, dated relative to today |
| **D5** | #98 | - | (cross-cutting / docs) | - | `demo reset`: wipe Azurite and re-seed |
| **D6** | #99 | - | (cross-cutting / docs) | - | `demo snapshot <name>` / `demo restore <name>` |
| **D7** | #100 | - | (cross-cutting / docs) | - | Dataset id: the hub clears its offline cache and write queue after a reset |
| **D8** | #101 | - | (cross-cutting / docs) | - | `demo share`: HTTPS URL for the tablet via Tailscale, printed as a QR code |
| **D9** | #102 | - | (cross-cutting / docs) | - | `demo` CLI for Windows and Linux/macOS (up, down, status, logs, reset, share) |
| **D10** | #103 | - | (cross-cutting / docs) | - | Local smoke tests run by `demo up` and end in 'Demo ready' |
| **D11** | #104 | - | (cross-cutting / docs) | - | Point `.workspace/workspace.yaml` at the Azurite-backed stack |
| **D12** | #105 | - | (cross-cutting / docs) | - | Local organizer PIN sign-in so sensitive-action gating is visible in demos |
| **D13** | #106 | - | (cross-cutting / docs) | - | Guardrails: demo seeding and auth bypass refuse to run outside Development/Demo |
| **D14** | #107 | - | (cross-cutting / docs) | - | API logs to a rolling file, shown by `demo logs` |
| **D15** | #108 | - | (cross-cutting / docs) | - | Tablets pick up new builds automatically (service worker update flow) |
| **D16** | #109 | - | (cross-cutting / docs) | - | Hub stays awake and self-recovers (Wake Lock, retry, auto-reload) |
| **K1** | #127 | - | (cross-cutting / docs) | - | Runbook: Hub tablet kiosk setup (Android device owner, Fire tablet, iPad) |
| **K2** | #128 | - | (cross-cutting / docs) | - | `provision-tablet` script (adb) for Android device-owner kiosk setup |
| **K3** | #129 | - | (cross-cutting / docs) | - | Fully Kiosk settings file for the Butler hub |
| **K4** | #130 | - | (cross-cutting / docs) | - | Make the hub kiosk-friendly: full screen, no pull-to-refresh, zoom, selection, or long-press menus |
| **K5** | #131 | - | (cross-cutting / docs) | - | Hidden organizer menu on the hub (long-press, then PIN): reload, clear cache, connection info, version |
| **K6** | #132 | - | (cross-cutting / docs) | - | On-device acceptance checklist (run by a human on the real tablet) |
| **K7** | #133 | - | (cross-cutting / docs) | - | Decision record: reference demo device |
| **P1** | #110 | - | (cross-cutting / docs) | - | Generate each week's assignments automatically (lazy on first read of a new week) |
| **P2** | #111 | - | (cross-cutting / docs) | - | Starter chore templates during household setup (age-tagged, one-tap add) |
| **P3** | #112 | - | (cross-cutting / docs) | - | Edit rooms and chores from the hub after setup |
| **P4** | #113 | - | (cross-cutting / docs) | - | Grocery: add a custom item when the catalog has no match |
| **P5** | #114 | - | (cross-cutting / docs) | - | Expand the simulated HEB catalog to ~200 common items with prices and images |
| **P6** | #115 | - | (cross-cutting / docs) | - | Order-confirmed receipt screen |
| **P7** | #116 | - | (cross-cutting / docs) | - | Browser voice capture on the hub ('add oat milk'), behind the capture seam |
| **P8** | #117 | - | (cross-cutting / docs) | - | Empty, loading, and error states across every hub widget |
| **P9** | #118 | - | (cross-cutting / docs) | - | Polish the hub layout for a 10" landscape tablet |
| **P10** | #119 | - | (cross-cutting / docs) | - | A small celebration when a chore is completed |
| **P11** | #120 | - | (cross-cutting / docs) | - | Touch targets and contrast check on name tiles and chore rows |
| **P12** | #121 | - | (cross-cutting / docs) | - | Browser test of the full demo path against the local stack |
| **S1** | #134 | - | (cross-cutting / docs) | - | Landing page with a pilot sign-up form (static, free hosting) |
| **S2** | #135 | - | (cross-cutting / docs) | - | 90-second demo video script and shot list |
| **S3** | #136 | - | (cross-cutting / docs) | - | Pilot one-pager |
| **S4** | #137 | - | (cross-cutting / docs) | - | Pricing hypothesis and pilot-to-paid offer |
| **S5** | #138 | - | (cross-cutting / docs) | - | Demo-day runbook |
| **S6** | #139 | - | (cross-cutting / docs) | - | Customer interview guide and feedback log |
| **S7** | #140 | - | (cross-cutting / docs) | - | Pilot success criteria and go/no-go signals |
| **S8** | #141 | - | (cross-cutting / docs) | - | Build-in-public post: 'Butler runs on the kitchen wall' |
| **V1** | #122 | - | (cross-cutting / docs) | - | Record usage events (glance, claim, complete, cart confirmed) in Table Storage |
| **V2** | #123 | - | (cross-cutting / docs) | - | Organizer insights screen: fairness trend, completions per person, carts |
| **V3** | #124 | - | (cross-cutting / docs) | - | Household teardown deletes all of the household's data |
| **V4** | #125 | - | (cross-cutting / docs) | - | In-app 'Your data' page: what is stored, kids' data, nothing leaves the home |
| **V5** | #126 | - | (cross-cutting / docs) | - | Show the build version on the hub and API |
| **X1** | #142 | - | (cross-cutting / docs) | - | Lower the UI coverage gate to ~90% for presentation code during the demo push |
| **X2** | #143 | - | (cross-cutting / docs) | - | Freeze knowledge-base and decision-record process until the demo ships |

**Totals:** 32 epic tickets + 52 cross-cutting = 84 issues.

## Implementation order

Follow the dependency order in [filing-guide.md](filing-guide.md): Foundations first, then Household Model, then Tap-to-Claim and Grocery, then Chores, then Offline. Each issue's `Blocked by` column above lists the issues that must land first. Start an issue with `/implement-issue <number>` and land it with `/merge-issue <number>`.

## Related

- [00-brd-master.md](00-brd-master.md) - the requirements; [07-engineering-contract.md](07-engineering-contract.md) - the binding Engineering Contract.
- [index.md](index.md) - the BRD map; [filing-guide.md](filing-guide.md) - label taxonomy, dependency order, filing recipe.
