---
name:          brd-ticket-issue-map
title:         Ticket to GitHub Issue Map (canonical crosswalk)
category:      Product & Strategy
lifecycle:     Living
owner:         product
generated-by:  brd/tools/generate_issue_map.py
---

# Butler v1 - Ticket to GitHub Issue Map

> **Canonical crosswalk.** This is the single source that bridges the BRD ticket IDs (F1, H1, ...), their epic-file specs, and the live GitHub issues. Future Claude sessions and team members reference this to translate between the planning docs and the tracker.

- **Repo:** `jasoncavaliere/the-butler-did-it`  -  **Issues:** https://github.com/jasoncavaliere/the-butler-did-it/issues
- **This file is generated.** Do not hand-edit the table. Re-run `python3 Butler.KnowledgeBase/brd/tools/generate_issue_map.py` after filing, renumbering, or closing issues.

## Conventions (how the three layers line up)

- **Ticket ID** (`F1`, `H3`, `C2`, ...) is the stable planning handle. Letter = epic (F=Foundations, H=Household, T=Tap-to-Claim, C=Chores, G=Grocery, O=Offline); the number orders within the epic.
- **Epic file** under `Butler.KnowledgeBase/brd/` holds the full spec (Summary, Context, Acceptance Criteria, Testing, Risks).
- **GitHub issue** title is `"<ID>: <title>"`, so the ID is always recoverable from the tracker: `gh issue list --search "F1 in:title"`.
- **Blocked by** is captured as GitHub `#` cross-references in each issue body; the epic-file specs use `#<ID>` placeholders that this generator resolves to live numbers.
- **Labels** classify each issue: `epic:*`, `area:*` (api / ui / infra / docs), `type:*`, `priority:*`. The `/implement-issue` workflow adds its own `status:*` labels on top.

## Crosswalk

| Ticket | GitHub | Priority | Epic | Blocked by | Title |
| --- | --- | --- | --- | --- | --- |
| **F1** | #3 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | - | Establish Butler.API layered skeleton (MediatR + feature-extension pattern) |
| **F2** | #4 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3 | Butler.API test harness (xUnit + NSubstitute) |
| **F3** | #5 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3, F2 #4 | Azure Table Storage access layer + Azurite local development |
| **F4** | #6 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | - | Butler.UI app structure + component test harness |
| **F5** | #7 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F2 #4, F4 #6 | CI workflows for API and UI (GitHub Actions) |
| **F6** | #8 | p0 | [Foundations & Delivery Rails](10-epic-foundations.md) | F1 #3, F2 #4 | Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass) |
| **F7** | #9 | p1 | [Foundations & Delivery Rails](10-epic-foundations.md) | F3 #5, F4 #6 | UI API client + household context provider |
| **H1** | #10 | p0 | [Household Model](20-epic-household-model.md) | F3 #5, F6 #8 | Household aggregate + Households table + create/get household |
| **H2** | #11 | p0 | [Household Model](20-epic-household-model.md) | H1 #10 | Rooms CRUD (Rooms table) |
| **H3** | #12 | p0 | [Household Model](20-epic-household-model.md) | H1 #10 | People CRUD (People table) - organizer-managed roster |
| **H4** | #13 | p0 | [Household Model](20-epic-household-model.md) | H2 #11 | Chores CRUD (Chores table) attached to a room |
| **H5** | #14 | p0 | [Household Model](20-epic-household-model.md) | H1 #10, H2 #11, H3 #12, H4 #13, F7 #9 | UI household setup flow (organizer onboarding) |
| **T1** | #15 | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H3 #12 | Tap-to-claim endpoint + participant session (no password) |
| **T2** | #16 | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H1 #10, F7 #9 | Hub shell and always-on "today" layout |
| **T3** | #17 | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | T1 #15, T2 #16 | Tap-to-claim UI (name tiles, claim, "what's mine glows") |
| **T4** | #18 | p0 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | F6 #8, F7 #9 | Organizer sign-in UI (Entra External ID) + sensitive-action gating |
| **T5** | #19 | p1 | [Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) | H1 #10, F6 #8 | Hub device pairing (HubDevices) |
| **C1** | #20 | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | F3 #5, H4 #13 | Assignment + completion domain and tables |
| **C2** | #21 | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C1 #20 | Fair-assignment engine (pure, deterministic) |
| **C3** | #22 | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C2 #21, H3 #12 | Generate / regenerate weekly assignments endpoint |
| **C4** | #23 | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C1 #20, T1 #15 | Complete a chore (tap-to-complete) endpoint |
| **C5** | #24 | p0 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C3 #22, C4 #23, T3 #17 | UI - today / this-week chore board with tap-to-complete |
| **C6** | #25 | p1 | [Chores & Fair Assignment](40-epic-chores-fair-assignment.md) | C4 #23 | Fairness view (contribution balance) |
| **G1** | #26 | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | F1 #3, F2 #4 | `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog) |
| **G2** | #27 | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | F3 #5, H1 #10 | Cart domain + `Carts`/`CartItems` tables |
| **G3** | #28 | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G1 #26, G2 #27 | Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice |
| **G4** | #29 | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G2 #27, F6 #8 | Assisted-cart confirm flow (human on the final tap) |
| **G5** | #30 | p0 | [Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) | G3 #28, G4 #29, T4 #18 | UI - grocery cart on the hub (add, review, confirm) |
| **O1** | #31 | p0 | [Offline PWA](60-epic-offline-pwa.md) | F4 #6 | PWA manifest, service worker, and installability |
| **O2** | #32 | p0 | [Offline PWA](60-epic-offline-pwa.md) | O1 #31, C5 #24 | Last-known-week cache (glanceable offline) |
| **O3** | #33 | p0 | [Offline PWA](60-epic-offline-pwa.md) | O2 #32, C4 #23 | Local write queue + sync-on-reconnect |
| **O4** | #34 | p1 | [Offline PWA](60-epic-offline-pwa.md) | O3 #33 | Offline status UI (indicator + queued-writes surfaced) |
| **DOC1** | #35 | - | (cross-cutting / docs) | - | Update the Knowledge Base to capture the v1 BRD architecture decisions |

**Totals:** 32 epic tickets + 1 cross-cutting = 33 issues.

## Implementation order

Follow the dependency order in [README.md](README.md): Foundations first, then Household Model, then Tap-to-Claim and Grocery, then Chores, then Offline. Each issue's `Blocked by` column above lists the issues that must land first. Start an issue with `/implement-issue <number>` and land it with `/merge-issue <number>`.

## Related

- [00-brd-master.md](00-brd-master.md) - the requirements and Engineering Contract.
- [README.md](README.md) - epic index, label taxonomy, dependency graph, filing recipe.
