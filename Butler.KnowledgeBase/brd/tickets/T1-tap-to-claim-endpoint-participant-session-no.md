---
type: Ticket
title: "T1: Tap-to-claim endpoint + participant session (no password)"
description: Unauthenticated claimable roster and a no-password tap-to-claim participant session scoped to one person.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/15
tags: [epic:tap-to-claim, area:api, type:feature, priority:p0]
epic: ../30-epic-tap-to-claim-hub.md
blocked-by: [H3]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# T1: Tap-to-claim endpoint + participant session (no password)

**Sub-service(s):** `Butler.API/`
**Blocked by:** H3 (`#<H3>`)
**Serves:** FR-3, BO-4

## Summary
Expose the claimable people roster with no authentication and let anyone at the hub "claim" a person by tapping, receiving a lightweight participant session scoped to `(householdId, personId)` that carries none of the organizer's authority. This is the server side of tap-to-claim (Decision D-3): participants are never behind auth.

## Context
Implements the participant half of [Engineering Contract 7.4](../engineering-contract/74-authentication-and-authorization.md) and persona `Participant` in [Section 4](../00-brd-master.md#4-personas-v1). The roster read must work on a shared device with no login (the daily-glance journey, 6.2). The participant session only identifies who is acting for completion writes - it must be impossible to escalate it into an organizer-policy action (billing, teardown, cart confirmation). The `People` table already exists from H3; this ticket does not create people, it reads them and issues sessions. Money never moves in v1 (D-8), which is what keeps an unauthenticated claim safe.

## Acceptance Criteria
- [ ] `GET /households/{householdId}/people` returns the claimable roster as a list of `{ personId, displayName, claimColor, isChild }`, scoped to the partition `householdId`, and requires **no** authentication (works with no bearer token in every environment, including when auth is enabled).
- [ ] The roster excludes nothing needed to render name tiles but never leaks organizer-only fields (for example `OrganizerObjectId` is not returned).
- [ ] `POST /households/{householdId}/people/{personId}/claim` returns a lightweight participant session/token scoped to exactly `(householdId, personId)`; it requires no password and no organizer JWT.
- [ ] The participant session identifies the active participant for completion writes (the shape Epic 40 C4 consumes to attribute a `ChoreCompletion` to a `personId`); the contract (claim/header/token field) is documented in the ticket or code so C4 does not have to guess.
- [ ] The participant session carries **no** ability to perform organizer-policy actions: any endpoint marked `[Authorize(Policy = "Organizer")]` returns `403` when presented only a participant session (never `200`, never a silent allow).
- [ ] Claiming a `personId` that does not exist in the household returns `404` (RFC 7807 problem details); an unknown `householdId` returns `404`.
- [ ] Follows the layered MediatR path (query for roster, command for claim) and the feature-extension pattern; builds clean with `TreatWarningsAsErrors`.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `ClaimHappyPathTests` (claim returns a session scoped to the person), `RosterListingTests` (unauthenticated read returns only claimable fields), `ParticipantSessionCannotDoSensitiveActionTests` (a participant session against an `Organizer`-policy endpoint returns `403`), and `ClaimUnknownPersonReturns404Tests`.

## Risks & Rollback
- R-1 (BRD): tap-to-claim trusts whoever is at the hub. Mitigation is structural - the participant session cannot reach organizer-policy endpoints (an AC above) and no money moves (D-8). Rollback = revert the PR; the roster/claim endpoints disappear and Epic 30 UI (T3) has nothing to call, so land this before T3.
