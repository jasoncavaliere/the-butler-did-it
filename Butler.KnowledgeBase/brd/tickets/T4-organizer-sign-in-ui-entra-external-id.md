---
type: Ticket
title: "T4: Organizer sign-in UI (Entra External ID) + sensitive-action gating"
description: Organizer sign-in UI (Entra External ID) and gating of every sensitive action behind it.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/18
tags: [epic:tap-to-claim, area:ui, type:feature, priority:p0]
epic: ../30-epic-tap-to-claim-hub.md
blocked-by: [F6, F7]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# T4: Organizer sign-in UI (Entra External ID) + sensitive-action gating

**Sub-service(s):** `Butler.UI/`
**Blocked by:** F6 (`#<F6>`), F7 (`#<F7>`)
**Serves:** FR-3

## Summary
Add an organizer sign-in flow that obtains an Entra External ID JWT, expose the signed-in organizer and token to the API client via an `OrganizerContext`, and hide or disable every UI affordance for sensitive actions unless an organizer is signed in. This is the UI side of the only real login in the product.

## Context
Implements the organizer half of [Engineering Contract 7.4](../engineering-contract/74-authentication-and-authorization.md) and persona `Organizer` ([Section 4](../00-brd-master.md#4-personas-v1)). The organizer is the only authenticated user (D-2, D-3); participants never authenticate. In dev mode the F6 `DisableAuthentication` dev organizer is used so local and CI need no live tenant. The API enforces the `Organizer` policy server-side (F6); this ticket is the client-side counterpart - the token flows to the API client and the UI hides affordances the organizer alone may use, so a participant is never even presented a sensitive action.

## Acceptance Criteria
- [ ] An organizer sign-in flow obtains a JWT via Entra External ID; in dev mode (`DisableAuthentication`) the F6 dev organizer is used so local and CI runs need no live tenant and no committed secrets.
- [ ] An `OrganizerContext` provider exposes the signed-in organizer (identity) and the token; the F7 API client sends that token as the bearer on organizer-policy requests, and sends none when no organizer is signed in.
- [ ] UI affordances for sensitive actions - at minimum household teardown, confirm order, and edit roster - are hidden or disabled unless an organizer is signed in; they become available only while an organizer session is active.
- [ ] Sign-out clears the organizer from `OrganizerContext` (and the token from the API client), returning the UI to the participant-only state.
- [ ] Signing in as the organizer does not disturb the participant tap-to-claim state (organizer auth and the active participant are independent concepts).
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (mocked auth): `gated-affordance-hidden-without-organizer` (sensitive affordances are absent/disabled with no organizer), `gated-affordance-shown-with-organizer` (they appear once a mocked organizer is signed in), `sign-out-clears-organizer` (affordances disappear and the token is dropped after sign-out).

## Risks & Rollback
- R: relying on hidden UI as the only guard. Mitigation: this is defense-in-depth only - the server enforces the `Organizer` policy (F6, T5), so a hidden affordance is convenience, not the security boundary. Rollback = revert the PR; sensitive affordances are hidden and the organizer cannot sign in on the hub until re-landed.
