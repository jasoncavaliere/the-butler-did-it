# Epic 30 - Tap-to-Claim & the Hub Shell

**Goal:** make whole-family participation ambient - a shared, always-on hub that anyone can use by tapping their name (no password, ever), while the organizer holds the only real credentials and the tablet itself is a paired, long-lived device identity. This epic delivers the multiplayer surface the vision calls "the whole game": the no-password participant session, the glanceable hub shell, the tap-to-claim UI where "what's mine glows", the organizer sign-in that gates sensitive actions, and hub-device pairing.

**Serves:** FR-3, BO-4 (and BO-5 for the glance-first shell).

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<Tn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it.

---

## T1: Tap-to-claim endpoint + participant session (no password)

**Labels:** `epic:tap-to-claim` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** H3 (`#<H3>`)
**Serves:** FR-3, BO-4

## Summary
Expose the claimable people roster with no authentication and let anyone at the hub "claim" a person by tapping, receiving a lightweight participant session scoped to `(householdId, personId)` that carries none of the organizer's authority. This is the server side of tap-to-claim (Decision D-3): participants are never behind auth.

## Context
Implements the participant half of [Engineering Contract 7.4](00-brd-master.md#74-authentication-and-authorization) and persona `Participant` in [Section 4](00-brd-master.md#4-personas-v1). The roster read must work on a shared device with no login (the daily-glance journey, 6.2). The participant session only identifies who is acting for completion writes - it must be impossible to escalate it into an organizer-policy action (billing, teardown, cart confirmation). The `People` table already exists from H3; this ticket does not create people, it reads them and issues sessions. Money never moves in v1 (D-8), which is what keeps an unauthenticated claim safe.

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

---

## T2: Hub shell and always-on "today" layout

**Labels:** `epic:tap-to-claim` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), F7 (`#<F7>`)
**Serves:** FR-3, BO-4, BO-5

## Summary
Build the always-on hub screen: a header (household name + date), a row of participant name tiles, and a "today" panel placeholder region. This is the shared-device shell the whole product renders inside; the chore-board content that fills the today panel lands in Epic 40 C5, so this ticket renders an empty/loading today panel fed by household + people data.

## Context
This is the shell for the daily-glance journey ([6.2](00-brd-master.md#62-the-daily-glance-any-participant-ambient)) and the surface BO-5 measures ("hub renders today's board"). It consumes household + people through the F7 API client and `HouseholdContext`; it does not fetch or render chores (that is C5's job - keep the today panel a clearly-owned empty region so C5 slots in without restructuring the layout). Web-first: read the versioned Expo 57 docs per `Butler.UI/AGENTS.md` before writing code, and follow the UI conventions F4 established.

## Acceptance Criteria
- [ ] An always-on hub screen renders three regions: a header showing the household name and the current date, a row of participant name tiles (one per person from the roster), and a clearly-bounded "today" panel placeholder region.
- [ ] Household name comes from household data (H1) and name tiles come from people data, both loaded via the F7 API client / `HouseholdContext`; a graceful loading and unreachable-API state is shown (no crash, no blank white screen).
- [ ] The today panel renders an empty/loading placeholder now and is structured so Epic 40 C5 can populate it without changing the shell layout (documented seam - for example a `TodayPanel` component that renders children).
- [ ] Layout is tablet-oriented and stays readable at glance distance (large type, high contrast, no dependence on hover); it does not assume a mouse.
- [ ] No password or sign-in prompt appears anywhere on this shell (participants glance and tap; organizer sign-in is a separate affordance from T4).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: `HubShell.test.tsx` (renders header household name and one name tile per mocked person; renders the empty today panel; shows the unreachable-API state when the client errors).

## Risks & Rollback
- R: the shell over-specifies the today panel and boxes in C5. Mitigation: keep the panel a dumb placeholder container with a documented seam. Rollback = revert the PR; the UI returns to the F4 placeholder Home screen.

---

## T3: Tap-to-claim UI (name tiles, claim, "what's mine glows")

**Labels:** `epic:tap-to-claim` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** T1 (`#<T1>`), T2 (`#<T2>`)
**Serves:** FR-3, BO-4

## Summary
Wire the name tiles to the T1 claim endpoint so tapping a name makes that person the active participant - no password prompt, ever - visually highlights their items ("what's mine glows"), lets a tap switch to another person, and clears the active participant back to the neutral glance state after an idle timeout.

## Context
This is the interactive core of the daily-glance journey ([6.2](00-brd-master.md#62-the-daily-glance-any-participant-ambient)) and the behavior BO-4 measures (distinct participants active per household per week). It renders on the T2 shell and calls the T1 endpoints. The active participant is UI state only; it becomes the actor Epic 40 C4 attributes completions to, via the participant session from T1. Never introduce a password or per-user login on the shared device (D-3, and the vision's "multiplayer is the whole game").

## Acceptance Criteria
- [ ] Tapping a name tile calls the T1 `claim` endpoint and, on success, sets that person as the active participant in UI state; **no** password or PIN prompt is shown at any point.
- [ ] The active participant is visually indicated (the selected tile), and their items are highlighted ("glow"); when no participant is active the shell is in a neutral glance state with nothing highlighted.
- [ ] Tapping the active participant again, or tapping a different name tile, switches the active participant (and moves the glow) - re-claiming via T1 as needed.
- [ ] An idle timeout (no interaction for a configured interval) clears the active participant back to the neutral glance state.
- [ ] The participant session returned by T1 is held in UI state for attributing completions (the seam Epic 40 C4 uses); it is never persisted as a credential and never sent to organizer-policy endpoints.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests (jest-expo, mocked claim client, fake timers): `claim-sets-active` (tapping a tile calls claim and marks that person active with glow), `switch` (tapping another name moves active + glow), `idle-clear` (advancing fake timers past the idle interval returns to the neutral state).

## Risks & Rollback
- R: an idle timeout that is too short annoys or too long leaks the wrong "active" person into a completion. Mitigation: the timeout is a single configured constant and the completion actor is re-read at write time (C4). Rollback = revert the PR; name tiles fall back to the non-interactive T2 shell.

---

## T4: Organizer sign-in UI (Entra External ID) + sensitive-action gating

**Labels:** `epic:tap-to-claim` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** F6 (`#<F6>`), F7 (`#<F7>`)
**Serves:** FR-3

## Summary
Add an organizer sign-in flow that obtains an Entra External ID JWT, expose the signed-in organizer and token to the API client via an `OrganizerContext`, and hide or disable every UI affordance for sensitive actions unless an organizer is signed in. This is the UI side of the only real login in the product.

## Context
Implements the organizer half of [Engineering Contract 7.4](00-brd-master.md#74-authentication-and-authorization) and persona `Organizer` ([Section 4](00-brd-master.md#4-personas-v1)). The organizer is the only authenticated user (D-2, D-3); participants never authenticate. In dev mode the F6 `DisableAuthentication` dev organizer is used so local and CI need no live tenant. The API enforces the `Organizer` policy server-side (F6); this ticket is the client-side counterpart - the token flows to the API client and the UI hides affordances the organizer alone may use, so a participant is never even presented a sensitive action.

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

---

## T5: Hub device pairing (HubDevices)

**Labels:** `epic:tap-to-claim` `area:api` `area:ui` `type:feature` `priority:p1`
**Sub-service(s):** `Butler.API/`, `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), F6 (`#<F6>`)
**Serves:** FR-3, BO-4

## Summary
Let an organizer pair the current tablet as the household's hub device: an organizer-only endpoint writes a `HubDevices` row and returns a long-lived device token scoped to the household that permits reads and completion writes but not organizer actions, and a minimal UI pairing step stores that token. This makes the tablet a first-class, long-lived actor (the persona "The Hub").

## Context
Implements the `HubDevices` table ([Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid)) and the device-identity persona ([Section 4](00-brd-master.md#4-personas-v1)) and onboarding step 6.1.3. The device token is deliberately weaker than an organizer JWT and stronger than an anonymous caller: it reads the household and records completions but is never trusted with organizer-policy actions. Pairing itself is a sensitive action, so it requires the `Organizer` policy (server-side, from F6). Partition is `householdId` like every table; the token is scoped to exactly one household.

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

---

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD: Engineering Contract (Section 7, auth in 7.4, data model in 7.3), personas (Section 4), and traceability (FR-3, BO-4).
- [README.md](README.md) - epic index, label taxonomy, dependency order, and the `gh issue create` recipe.
- [20-epic-household-model.md](20-epic-household-model.md) - the spine (rooms, people, chores) this epic reads people from; provides H1 and H3.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - consumes the participant session (C4) and fills the today panel (C5) this epic scaffolds.
