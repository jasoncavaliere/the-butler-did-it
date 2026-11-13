---
type: Epic
title: Epic 30 - Tap-to-Claim & the Hub Shell
description: No-password tap-to-claim, the always-on hub shell, organizer sign-in, and hub device pairing.
tags: [epic:tap-to-claim]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 30 - Tap-to-Claim & the Hub Shell

**Goal:** make whole-family participation ambient - a shared, always-on hub that anyone can use by tapping their name (no password, ever), while the organizer holds the only real credentials and the tablet itself is a paired, long-lived device identity. This epic delivers the multiplayer surface the vision calls "the whole game": the no-password participant session, the glanceable hub shell, the tap-to-claim UI where "what's mine glows", the organizer sign-in that gates sensitive actions, and hub-device pairing.

**Serves:** FR-3, BO-4 (and BO-5 for the glance-first shell).

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<Tn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it.

## Tickets

- [T1: Tap-to-claim endpoint + participant session (no password)](tickets/T1-tap-to-claim-endpoint-participant-session-no.md) - Unauthenticated claimable roster and a no-password tap-to-claim participant session scoped to one person.
- [T2: Hub shell and always-on "today" layout](tickets/T2-hub-shell-and-always-on-today-layout.md) - The always-on hub screen: header, participant name tiles, and the today panel region.
- [T3: Tap-to-claim UI (name tiles, claim, "what's mine glows")](tickets/T3-tap-to-claim-ui-name-tiles-claim-what-s-mine.md) - Tap-to-claim UI: tapping a name tile makes that person active and their items glow, with no password ever.
- [T4: Organizer sign-in UI (Entra External ID) + sensitive-action gating](tickets/T4-organizer-sign-in-ui-entra-external-id.md) - Organizer sign-in UI (Entra External ID) and gating of every sensitive action behind it.
- [T5: Hub device pairing (HubDevices)](tickets/T5-hub-device-pairing-hubdevices.md) - Pair a tablet as the household's hub device with a long-lived, household-scoped device token.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD: Engineering Contract (Section 7, auth in 7.4, data model in 7.3), personas (Section 4), and traceability (FR-3, BO-4).
- [filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order, and the `gh issue create` recipe.
- [20-epic-household-model.md](20-epic-household-model.md) - the spine (rooms, people, chores) this epic reads people from; provides H1 and H3.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - consumes the participant session (C4) and fills the today panel (C5) this epic scaffolds.
