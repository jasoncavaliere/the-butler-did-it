---
type: Ticket
title: "T5: Hub device pairing (HubDevices)"
description: Pair a tablet as the household's hub device with a long-lived, household-scoped device token.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/19
tags: [epic:tap-to-claim, area:api, area:ui, type:feature, priority:p1]
epic: ../30-epic-tap-to-claim-hub.md
blocked-by: [H1, F6]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# T5: Hub device pairing (HubDevices)

**Sub-service(s):** `Butler.API/`, `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), F6 (`#<F6>`)
**Serves:** FR-3, BO-4

## Summary
Let an organizer pair the current tablet as the household's hub device: an organizer-only endpoint writes a `HubDevices` row and returns a long-lived device token scoped to the household that permits reads and completion writes but not organizer actions, and a minimal UI pairing step stores that token. This makes the tablet a first-class, long-lived actor (the persona "The Hub").

## Context
Implements the `HubDevices` table ([Engineering Contract 7.3](../engineering-contract/73-data-model.md)) and the device-identity persona ([Section 4](../00-brd-master.md#4-personas-v1)) and onboarding step 6.1.3. The device token is deliberately weaker than an organizer JWT and stronger than an anonymous caller: it reads the household and records completions but is never trusted with organizer-policy actions. Pairing itself is a sensitive action, so it requires the `Organizer` policy (server-side, from F6). Partition is `householdId` like every table; the token is scoped to exactly one household.

## Acceptance Criteria
- [ ] `POST /households/{householdId}/hub-devices/pair` requires the `Organizer` policy (returns `403` for a participant session or anonymous caller; `200` for a signed-in organizer, or the dev organizer in dev mode).
- [ ] A successful pair writes a `HubDevices` row (PartitionKey `householdId`, RowKey `deviceId`) with `DeviceName`, `PairedUtc`, and `LastSeenUtc`, and returns a long-lived device token scoped to that `householdId`.
- [ ] The device token permits household reads and completion writes but **not** organizer-policy actions: presenting only a device token to any `[Authorize(Policy = "Organizer")]` endpoint returns `403`.
- [ ] `LastSeenUtc` on the paired `HubDevices` row updates when the device token is used (time injected via the clock seam, not `DateTime.Now`).
- [ ] A minimal UI pairing step (available only to a signed-in organizer, from T4) calls the pair endpoint and stores the returned device token for subsequent use by the hub.
- [ ] API builds clean with `TreatWarningsAsErrors`; UI `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`; `cd Butler.UI && npm run ci:verify`.
- Add tests: API `PairRequiresOrganizerTests` (participant/anonymous -> `403`, organizer -> `200` + row written), `DeviceTokenCannotDoSensitiveActionTests` (device token against an `Organizer`-policy endpoint -> `403`), `LastSeenUtcUpdatesOnUseTests` (with an injected clock); UI `HubPairing.test.tsx` (pairing affordance calls the endpoint and stores the token; hidden without an organizer).

## Risks & Rollback
- R: a long-lived device token is a broader credential than a session. Mitigation: it is scoped to one `householdId`, cannot reach organizer-policy endpoints (an AC above), and no money moves (D-8), so the blast radius is reads + completions for one household. Rollback = revert the PR; the hub falls back to the unauthenticated roster/claim path (T1) with no persistent device identity.
