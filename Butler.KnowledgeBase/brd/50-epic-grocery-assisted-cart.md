# Epic 50 - Grocery: Assisted Cart (real-world execution)

**Goal:** prove Butler does work, not just tracks it - one demoable grocery flow that goes capture -> cart -> human-confirmed order, behind a real `IStoreConnector` seam whose only v1 implementation is a deterministic `SimulatedHebConnector` backed by a checked-in fixture catalog. This is the "add oat milk -> review -> confirm" journey from [Section 6.4](00-brd-master.md#64-grocery-the-monthly-wow), made real end to end with no network and no money.

**Serves:** FR-5, BO-3.
**Blocked by Foundations and the household spine.** These tickets assume the storage, auth, test, and household layers from Epics 10 and 20 already landed.

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<Xn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it. Three decisions are load-bearing for this epic and are not up for reinterpretation: D-4 (real seam, simulated connector), D-5 (capture seam, live Alexa deferred), and D-8 (no money moves - confirm records intent only).

---

## G1: `IStoreConnector` abstraction + `SimulatedHebConnector` (fixture catalog)

**Labels:** `epic:grocery` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-5, BO-3

## Summary
Ship the real store-connector seam and its one v1 implementation: an `IStoreConnector` interface plus a deterministic `SimulatedHebConnector` that searches a checked-in fixture catalog with no network dependency, so the rest of the grocery flow builds against a stable, swappable abstraction.

## Context
Implements decision [D-4](00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions): HEB has no public consumer API, so v1 ships the real interface and a simulated implementation. The abstraction is what keeps "plug into any store later" honest. An aggregator/assisted connector and an official connector are explicitly deferred behind this exact seam (Section 9 fast-follow) - do not build them here, but do not close the interface against them either (hence `SourceConnector` on results). Follows the feature-extension pattern in [Engineering Contract 7.2](00-brd-master.md#72-butlerapi-architecture-layered-mediatr-adopted-from-qcontrol).

## Acceptance Criteria
- [ ] An `IStoreConnector` interface defines at least `SearchProducts(query)` and `GetProduct(id)`, returning product DTOs with `ProductId`, `DisplayName`, `Size`/`Unit`, and an indicative price string (labelled non-transactional - it is display text, never a charge).
- [ ] A `SimulatedHebConnector` implements `IStoreConnector` against a checked-in fixture catalog (for example `SeedData/grocery/heb-catalog.json`) with at least a dozen representative products; search is case-insensitive and matches on `DisplayName` (and any catalog synonyms).
- [ ] Every result carries a `SourceConnector` value (for example `"simulated-heb"`) so a later connector can be swapped in without changing consumers.
- [ ] The feature is registered via an `AddStoreConnectorFeature()` extension wired in `Program.cs`; `IStoreConnector` resolves to `SimulatedHebConnector` in v1.
- [ ] No network calls exist in the connector or its tests (fully offline; the catalog is read from the checked-in fixture).
- [ ] Search is deterministic: the same query always returns the same ordered results.
- [ ] Builds clean with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `SimulatedHebConnectorTests` covering search-matches (a known term returns the expected product), search-no-match (empty result, not an exception), get-by-id (known and unknown id), and determinism (repeated identical queries return identical ordered results).

## Risks & Rollback
- R-3 (BRD): the simulated store is not a real integration. Mitigation: it is honest by design and swappable behind `IStoreConnector`; the demo is real even if the store is not. Rollback = revert the PR; no other feature has shipped against the seam yet at this point.

---

## G2: Cart domain + `Carts`/`CartItems` tables

**Labels:** `epic:grocery` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), H1 (`#<H1>`)
**Serves:** FR-5

## Summary
Persist the weekly cart: `Carts` and `CartItems` tables (partitioned by `householdId`, keyed by `weekIso`) with repositories, a get-or-create "building" cart for the current week, and a read endpoint that returns the cart with its items.

## Context
Implements the `Carts`/`CartItems` rows in [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid) on the shared Table Storage base from F3. `weekIso` is computed server-side from an injected/supplied date (never `DateTime.Now` in a handler). The cart is the container the capture flow (G3) writes into and the confirm flow (G4) transitions.

## Acceptance Criteria
- [ ] A `Carts` entity exists (PartitionKey `householdId`, RowKey `{weekIso}`) with `Status` (`Building`|`Confirmed`), `ConfirmedByPersonId` (nullable), and `ConfirmedUtc` (nullable), behind an `ICartRepository`.
- [ ] A `CartItems` entity exists (PartitionKey `householdId`, RowKey `{cartWeekIso}_{itemId}`) with `ProductId`, `DisplayName`, `Quantity`, `AddedByPersonId`, and `SourceConnector`, behind an `ICartItemRepository`.
- [ ] A get-or-create operation returns the `Building` cart for the current week (creating one if none exists) - it never returns a `Confirmed` cart as the building cart.
- [ ] `GET` the cart for a household+week returns the cart plus its items in one response shape.
- [ ] Optimistic concurrency applies to the cart via the F3 helper: reads return `ETag`; updates require `If-Match` (`428` when missing, `412` when stale).
- [ ] An unknown household returns `404` (RFC 7807 problem details).
- [ ] `weekIso` is computed from an injected clock / supplied date, deterministically.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `CartRepositoryTests` (get-or-create returns a building cart, second call returns the same cart), `CartItemRepositoryTests` (add then list round-trips items with all fields), and a concurrency test (stale `If-Match` on the cart -> `412`).

## Risks & Rollback
- R: a confirmed week and a new building cart could collide on the same `weekIso` RowKey. Mitigation: get-or-create only ever hands back the single row for the week and blocks writes once `Confirmed` (enforced in G4). Rollback = revert; G3/G4 are blocked on this and would not have shipped.

---

## G3: Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice

**Labels:** `epic:grocery` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** G1 (`#<G1>`), G2 (`#<G2>`)
**Serves:** FR-5, BO-3

## Summary
Turn a spoken or typed utterance ("add oat milk") into a cart item: an `ICaptureSource` seam resolves the utterance to a product via the G1 connector and adds it to the current building cart. v1 ships a hub text-capture implementation and a simulated voice-capture implementation behind the same seam.

## Context
Implements decision [D-5](00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions): the capture seam ships in v1; live Alexa is deferred behind it (Section 9 fast-follow) and is explicitly out of scope here. Both v1 sources reduce to the same operation - resolve text -> product -> add to the building cart - so the seam is a thin normalizer over a shared handler, not two code paths. The active participant/hub identity supplies `AddedByPersonId` (tap-to-claim, [D-3](00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions)); capture is not an organizer-only action.

## Acceptance Criteria
- [ ] An `ICaptureSource` seam accepts a free-text utterance (for example `"add oat milk"`), extracts the product term, resolves it via `IStoreConnector.SearchProducts`, and adds the top match to the household's current building cart with `Quantity` defaulting to `1` and `AddedByPersonId` from the active participant/hub session.
- [ ] Added items carry the `SourceConnector` from the resolved product (G1).
- [ ] A hub text-capture implementation and a simulated voice-capture implementation both exist behind `ICaptureSource` and share the same resolve-and-add handler.
- [ ] Ambiguous or no-match input returns a clear, structured result - suggestions (candidate products) or a `404`/`400`-style problem detail - and never throws an unhandled exception.
- [ ] Live Alexa is explicitly out of scope for this ticket (stated in the issue); only the two simulated/hub sources ship.
- [ ] The feature registers via its `Add<Feature>Feature()` extension and adds to the building cart from G2 (get-or-create), respecting cart optimistic concurrency.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `TextCaptureTests` (a matching utterance adds the expected item to the building cart), `SimulatedVoiceCaptureTests` (the voice source resolves and adds through the same handler), and `AmbiguousCaptureTests` (no-match / ambiguous input returns suggestions or a problem detail, no exception).

## Risks & Rollback
- R: naive term extraction mis-parses utterances. Mitigation: v1 uses a simple, documented normalization (strip a leading "add", trim) and returns suggestions on low confidence rather than guessing silently. Rollback = revert; G2 and the connector remain intact.

---

## G4: Assisted-cart confirm flow (human on the final tap)

**Labels:** `epic:grocery` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** G2 (`#<G2>`), F6 (`#<F6>`)
**Serves:** FR-5, BO-3

## Summary
Let a human review the building cart and confirm it. Confirm requires the organizer, flips the cart to `Confirmed` with who/when, is idempotent, and - per D-8 - places no real order and moves no money. It records intent only.

## Context
This is the "human on the final tap" from [Section 6.4](00-brd-master.md#64-grocery-the-monthly-wow) and the enforcement point for decision [D-8](00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions). Confirm is a sensitive action, so it carries the `Organizer` policy from F6 ([Engineering Contract 7.4](00-brd-master.md#74-authentication-and-authorization)); a tap-to-claim participant or the hub device cannot confirm. No money movement and no external order call is the whole point - it keeps tap-to-claim safe (R-1). The clock is injected for a deterministic `ConfirmedUtc`.

## Acceptance Criteria
- [ ] `GET` returns the current building cart (cart + items) for organizer review.
- [ ] `POST` confirm carries `[Authorize(Policy = "Organizer")]`; a participant/hub session (no organizer JWT) receives `403`.
- [ ] A successful confirm sets `Status = Confirmed`, `ConfirmedByPersonId` to the organizer's person, and `ConfirmedUtc` from the injected clock, using cart optimistic concurrency.
- [ ] Confirm is idempotent: confirming an already-`Confirmed` cart is a no-op success (does not change `ConfirmedByPersonId`/`ConfirmedUtc` and does not error).
- [ ] Confirm places no real order and moves no money - it records intent only (per D-8); there is no external HTTP/store/payment call in the confirm path.
- [ ] Unknown household or no building cart to confirm returns `404` (RFC 7807).
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `ConfirmCartTests` covering confirm-requires-organizer (participant/hub -> `403`), confirm-sets-status (status/who/when set from injected clock), double-confirm-idempotent (second confirm is a no-op success), and no-money-side-effect (assert no external/store/payment call is made - the connector is not invoked on confirm).

## Risks & Rollback
- R-1 (BRD): tap-to-claim trusts whoever is at the hub. Mitigation: the organizer policy on confirm plus D-8 (no money moves) is the safety boundary; the no-side-effect test is an AC. Rollback = revert; the cart stays reviewable but not confirmable.

---

## G5: UI - grocery cart on the hub (add, review, confirm)

**Labels:** `epic:grocery` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** G3 (`#<G3>`), G4 (`#<G4>`), T4 (`#<T4>`)
**Serves:** FR-5, BO-3

## Summary
Put the grocery flow on the hub: a screen where anyone can add an item by typing, the cart lists what has been added, and a signed-in organizer can confirm. This is the demoable "add oat milk -> review -> confirm" path from end to end against the simulated connector.

## Context
The UI surface for the whole epic. It builds on the F7 API client + household context and the T4 organizer sign-in state to gate the confirm action. Adding an item calls G3; confirming calls G4. The demo must work fully offline of any real store because the backing connector is the G1 simulated one. Follows the UI conventions from F4 ([Engineering Contract 7.1](00-brd-master.md#71-repository-and-toolchains)); read the versioned Expo docs per `Butler.UI/AGENTS.md` before writing code.

## Acceptance Criteria
- [ ] A hub grocery screen lets anyone add an item by typing a term (for example `"oat milk"`); the entry resolves via the G3 capture endpoint and the resolved item appears in the cart.
- [ ] The cart lists items with their `DisplayName` and `Quantity`.
- [ ] A `Confirm` action is visible only to a signed-in organizer (from T4); it is hidden/absent for a tap-to-claim participant or unauthenticated hub session, and calls the G4 confirm endpoint.
- [ ] After a successful confirm, the screen shows a confirmed state (the cart reads as `Confirmed`).
- [ ] Ambiguous/no-match add input surfaces the G3 suggestions or a clear not-found message rather than a silent failure.
- [ ] The "add oat milk -> review -> confirm" path works end to end against the simulated connector (documented as the demo path).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: component tests covering add-item-renders (adding a term renders the item in the cart, mocked client), confirm-hidden-without-organizer (no organizer -> no Confirm action), and confirm-flow (organizer taps Confirm -> confirmed state, mocked client).

## Risks & Rollback
- R: the confirm control leaks to non-organizers. Mitigation: gate on the T4 organizer state and cover it with the confirm-hidden-without-organizer test (an AC); the API still enforces `403` (G4) as defense in depth. Rollback = revert; the API-side flow (G1-G4) stays intact and independently testable.

---

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD; Section 7 Engineering Contract, Section 6.4 grocery journey, and decisions D-4/D-5/D-8 that bind this epic.
- [README.md](README.md) - epic index, label taxonomy, dependency order, and the `gh issue create` recipe.
- [40-epic-chores-fair-assignment.md](40-epic-chores-fair-assignment.md) - the wedge epic; shares the household spine and the organizer/participant authorization boundary.
- [60-epic-offline-pwa.md](60-epic-offline-pwa.md) - offline PWA; the cart is one of the writes that must queue and sync.
