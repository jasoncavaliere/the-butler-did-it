---
type: Ticket
title: "H5: UI household setup flow (organizer onboarding)"
description: "Organizer onboarding UI: create the household, add rooms and people, and map starter chores to rooms."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/14
tags: [epic:household-model, area:ui, type:feature, priority:p0]
epic: ../20-epic-household-model.md
blocked-by: [H1, H2, H3, H4, F7]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# H5: UI household setup flow (organizer onboarding)

**Sub-service(s):** `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), H2 (`#<H2>`), H3 (`#<H3>`), H4 (`#<H4>`), F7 (`#<F7>`)
**Serves:** FR-2, BO-2

## Summary
Build the organizer onboarding screen: a multi-step setup flow that creates the household, adds rooms, adds people (including the child flag and claim color), and maps a starter set of chores to rooms - the UI over H1-H4. It uses the F7 typed API client and `HouseholdContext`, and is reachable only for an authenticated organizer.

## Context
Realizes the onboarding journey in [BRD 6.1](../00-brd-master.md#61-onboarding-organizer-once) on top of the H1-H4 endpoints and the F7 client/context. Web-first Expo per [Engineering Contract 7.1](../engineering-contract/71-repository-and-toolchains.md); follow the versioned Expo 57 docs (`Butler.UI/AGENTS.md`). Errors from the API arrive as RFC 7807 problem details ([7.5](../engineering-contract/75-cross-cutting-conventions.md)) and must surface as user-visible validation/error states, not silent failures. On completion the new `householdId` lives in `HouseholdContext` for the rest of the app.

## Acceptance Criteria
- [ ] A multi-step organizer setup screen exists with steps in order: create household -> add rooms -> add people (each with an `IsChild` flag and a `ClaimColor`) -> map starter chores to rooms.
- [ ] Every step calls the corresponding H1-H4 endpoint through the F7 typed API client (no ad-hoc `fetch`), sending `If-Match` on updates and surfacing `ETag` per the client contract.
- [ ] Validation and error states are surfaced from the API problem-details shape (for example an unknown `RoomId` on chore mapping, or a `400`/`412` from the API) as readable in-screen messages; a failed step does not advance.
- [ ] Setup is gated: it is reachable only for an authenticated organizer (using the F6/F7 auth state); a non-organizer/unauthenticated visitor cannot reach the flow.
- [ ] On completion the `HouseholdContext` holds the newly created `householdId` (via `useHousehold`), so subsequent screens read the correct household.
- [ ] `npm run ci:verify` passes (lint, typecheck, test) and `npx expo export --platform web` produces a `dist/` build with no errors.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests: `HouseholdSetup` happy path (mocked F7 client: create household -> add a room -> add a person incl. child flag -> map a chore; asserts `HouseholdContext` ends with the new `householdId`) and an error render (mocked client returns a problem-details error; the step shows the message and does not advance).

## Risks & Rollback
- R: Expo 57 API drift. Mitigation: follow the versioned docs per `AGENTS.md`. R: onboarding blocked if any H1-H4 endpoint shape differs from the F7 client types. Mitigation: use the F7 typed client and mock it in tests; integration is validated against the real API in the loop. Rollback = revert the PR; onboarding returns to the F7 placeholder Home screen.
