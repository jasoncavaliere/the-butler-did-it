# Epic 40 - Chores & Fair Assignment (the wedge)

**Goal:** turn the household spine into the v1 wedge - a deterministic engine that divides the week's chores fairly across eligible people, a hub board where anyone can tap a chore done with no login, and a fairness view that shows the balance trending even. This is the loop [BO-1](00-brd-master.md#3-business-objectives-and-how-v1-serves-them) is won or lost on: make the work visible, make it fair, make completing it a one-tap habit.

**Serves:** FR-4, BO-1 (the wedge), and the Section 10 fairness success metric.

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<...>` placeholders (`#<C1>`, `#<F3>`, and so on) with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it. The fair-assignment algorithm is implemented **exactly** as specified in [Engineering Contract 7.6](00-brd-master.md#76-the-v1-fair-assignment-algorithm-deterministic-specified-so-nobody-guesses); a ticket may not reinterpret it.

---

## C1: Assignment + completion domain and tables

**Labels:** `epic:chores` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F3 (`#<F3>`), H4 (`#<H4>`)
**Serves:** FR-4

## Summary
Add the `Assignments` and `ChoreCompletions` domain shapes, tables, and repositories - plus an injected clock and a deterministic `weekIso` helper - so the assignment engine (C2) and the endpoints (C3, C4) have a tested persistence and time base to build on.

## Context
Implements the `Assignments` and `ChoreCompletions` rows from [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid), on top of the F3 Table Storage access seam. `weekIso` is the ISO-8601 year-week string (for example `2026-W29`) and must be computed from an injected clock/`TimeProvider`, never `DateTime.Now` inside a handler - this is what keeps the engine and endpoints deterministically testable. Completions are append-only (BRD R-2); assignment status is mutated under optimistic concurrency (that behavior lands with C4, but the row and repository seam are created here).

## Acceptance Criteria
- [ ] An `Assignments` table shape exists with `PartitionKey = householdId`, `RowKey = {weekIso}_{choreId}`, and fields `AssignedPersonId`, `WeekIso`, `DueDateUtc`, `Status` (`Open`/`Done`).
- [ ] A `ChoreCompletions` table shape exists with `PartitionKey = householdId`, `RowKey = {completedUtcTicks}_{choreId}`, and fields `ChoreId`, `PersonId`, `CompletedUtc`, `Effort`, `WeekIso`.
- [ ] Both are exposed behind repository interfaces (`IAssignmentRepository`, `IChoreCompletionRepository`) with Table-backed implementations built on the F3 access seam; every read and write is scoped by `PartitionKey = householdId` (no cross-household query).
- [ ] An injected clock (`TimeProvider` or an `IClock` seam) is registered; no assignment/completion code path reads `DateTime.Now`/`DateTime.UtcNow` directly.
- [ ] A deterministic `WeekIso` helper computes the ISO-8601 year-week string from a supplied `DateTimeOffset` (for example `2026-07-14` -> `2026-W29`), handling the ISO week-numbering-year boundary (a late-December date can belong to week 01 of the next year, and an early-January date to week 52/53 of the prior year).
- [ ] An `AddAssignmentsFeature()` (or equivalently named) service-collection extension registers the repositories, clock, and helper, and is wired in `Program.cs` per the [feature-extension pattern](00-brd-master.md#72-butlerapi-architecture-layered-mediatr-adopted-from-qcontrol).
- [ ] Solution builds with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true` (zero warnings); `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `WeekIsoHelperTests` (known dates including an ISO week-53 year and a year-boundary date proving the week-numbering-year rule), `AssignmentRepositoryTests` and `ChoreCompletionRepositoryTests` (round-trip write/read scoped by `householdId`, using the F3 faked/in-memory table client).

## Risks & Rollback
- R: an off-by-one ISO week helper silently mis-buckets completions and breaks fairness math. Mitigation: the year-boundary unit tests above are an AC, not optional. Rollback = revert the PR; C2-C6 are `Blocked by` this ticket so nothing downstream ships against a wrong helper.

---

## C2: Fair-assignment engine (pure, deterministic)

**Labels:** `epic:chores` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** C1 (`#<C1>`)
**Serves:** FR-4, BO-1

## Summary
Implement the v1 fair-assignment algorithm as a pure, deterministic service exactly per [Engineering Contract 7.6](00-brd-master.md#76-the-v1-fair-assignment-algorithm-deterministic-specified-so-nobody-guesses): given the week's active chores, the eligible people, and each person's trailing completion load, it returns the assignment set. No storage, no clock, no randomness - all inputs are passed in. This is the highest-value test surface in the epic.

## Context
This is D-6 (the v1 fair-assignment decision) made real. The engine is a pure function so it is exhaustively unit-testable and so C3 can call it with data it fetched and C2 stays free of I/O. The exact rules from 7.6 are binding: eligibility, load definition, processing order, assignment target, and tie-breaks. Determinism is a hard requirement - the same inputs must always produce the identical assignment set (no ML, no learning, no external calls).

## Acceptance Criteria
- [ ] A pure service (for example `FairAssignmentEngine.Assign(...)`) takes only in-memory inputs: the week's active chores, the eligible people (each carrying `IsChild`), and each person's precomputed running load (trailing-4-week completed `Effort`); it performs no storage access, reads no clock, and uses no RNG.
- [ ] **Eligibility** matches 7.6 exactly: a child (`IsChild == true`) is eligible only for chores with `MinAge == null`; a non-child is eligible for every active chore.
- [ ] **Processing order:** chores are processed by descending `Effort`, then by `choreId` ascending for stability.
- [ ] **Assignment target:** each chore is assigned to the eligible person with the lowest current load, where load = trailing-4-week completed `Effort` plus effort already assigned this week; the chore's `Effort` is then added to that person's running load.
- [ ] **Tie-break:** equal load breaks to fewest chores assigned this week, then to lowest `personId`.
- [ ] **Determinism:** running the engine twice on the same inputs returns an identical assignment set (same person per chore, same order).
- [ ] **No eligible person:** when a chore has no eligible person, it is returned unassigned with a stated reason (for example an `Unassigned` result carrying a reason code); the engine does not throw and does not skip the chore silently.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests (`FairAssignmentEngineTests`, the epic's primary test surface): eligibility (a child is excluded from a `MinAge != null` chore and included for a `MinAge == null` chore); load balancing (higher trailing load receives less new effort so the distribution evens out); determinism (same input run twice yields byte-identical assignment sets); processing order and tie-break (descending `Effort` then `choreId`; equal load resolves by fewest-chores-this-week then `personId`); no-eligible-person (chore returned unassigned with a reason, no exception).

## Risks & Rollback
- R: a subtle deviation from 7.6 (wrong tie-break order, wrong load window) produces plausible-but-unfair assignments. Mitigation: the AC restate 7.6 verbatim and each rule has a dedicated test. Rollback = revert; C3 is `Blocked by` this ticket.

---

## C3: Generate / regenerate weekly assignments endpoint

**Labels:** `epic:chores` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** C2 (`#<C2>`), H3 (`#<H3>`)
**Serves:** FR-4

## Summary
Add the endpoint that generates a household's assignments for a given (or current) `weekIso` by running the C2 engine over the household's active chores and eligible people, then persists the result via the C1 repositories. Regenerating an already-generated week replaces `Open` assignments but preserves `Done` ones and their completions.

## Context
This is journey 6.3 (weekly, automatic - with an organizer regenerate). The endpoint is the only place that composes fetch -> compute -> persist: it reads active chores (H3) and people (H4), computes each person's trailing-4-week load from `ChoreCompletions`, computes `weekIso` from the injected clock when none is supplied, calls the pure C2 engine, and writes `Assignments`. Regenerate must be idempotent and safe: a week already partly completed must not lose its `Done` records.

## Acceptance Criteria
- [ ] `POST /api/households/{householdId}/assignments/generate` (accepting an optional `weekIso`; when omitted, `weekIso` is computed server-side from the injected clock) generates assignments for that week using the C2 engine over the household's `Active` chores and its people, persisting them via the C1 `IAssignmentRepository`.
- [ ] Each person's load input to the engine is computed by scanning the household `ChoreCompletions` partition over the trailing 4 weeks (no cross-household query).
- [ ] **Regenerate rule (stated, idempotent):** regenerating a week that already has assignments replaces only `Open` assignments; `Done` assignments and their `ChoreCompletions` are preserved untouched, and the effort of preserved `Done` chores is reflected in the recomputed loads so regeneration does not re-assign already-completed chores.
- [ ] Authorization: the endpoint may be triggered by an `Organizer` (JWT, `[Authorize(Policy = "Organizer")]`) or by a paired hub device; a plain participant session may not trigger it and is rejected.
- [ ] The response returns the resulting assignment set for the week (including any chores the engine left unassigned with their reason from C2).
- [ ] Unknown `householdId` returns `404` as RFC 7807 problem details.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: generate-produces-assignments-for-active-chores; regenerate-preserves-done (a `Done` assignment plus its completion survive a regenerate while `Open` ones are replaced, and the done chore is not reassigned); unauthorized-participant-rejected; unknown-household-404. Use NSubstitute fakes for the repositories and a fixed injected clock.

## Risks & Rollback
- R-2 (BRD): regenerate racing a completion could drop a `Done` record. Mitigation: the preserve-`Done` rule is an AC with a dedicated test; writes go through the C1 repos' concurrency helper. Rollback = revert; C5 is `Blocked by` this ticket.

---

## C4: Complete a chore (tap-to-complete) endpoint

**Labels:** `epic:chores` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** C1 (`#<C1>`), T1 (`#<T1>`)
**Serves:** FR-4, BO-1

## Summary
Add the endpoint that completes an assignment from a tap: it appends a `ChoreCompletion` and sets the assignment `Status = Done` under optimistic concurrency. A participant session or a paired hub device may complete - no organizer required - and a double-complete is idempotent, not an error.

## Context
This is journey 6.2 (the daily glance and tap-to-complete) and the write side of the wedge. Per D-3 completing a chore is not a sensitive action, so tap-to-claim participants (T1) and the hub device may do it without an organizer JWT. Per BRD R-2 completions are append-only and assignment status is last-writer-wins per `(householdId, week, chore)` with optimistic concurrency, which is exactly what makes offline resync (Epic 60) safe.

## Acceptance Criteria
- [ ] `POST /api/households/{householdId}/assignments/{weekIso}/{choreId}/complete` appends a `ChoreCompletion` with `PersonId` from the active participant session or paired hub device, `Effort` copied from the chore, `CompletedUtc` from the injected clock, and the assignment's `WeekIso`.
- [ ] The same call sets the matching `Assignment.Status = Done` via optimistic concurrency (`If-Match` on the read `ETag`); the write is last-writer-wins per `(householdId, weekIso, choreId)`.
- [ ] **Idempotent double-complete:** completing an assignment already `Done` succeeds (returns success, does not throw); completions remain append-only, so the handler does not delete or overwrite prior `ChoreCompletion` rows.
- [ ] Authorization: a participant session or a paired hub device may complete; no `Organizer` policy is required on this endpoint.
- [ ] Unknown assignment (`householdId`/`weekIso`/`choreId` with no matching row) returns `404` as RFC 7807 problem details.
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: complete-sets-done-and-records-completion (status flips to `Done` and exactly one `ChoreCompletion` is appended with the chore's `Effort` and the clock's `CompletedUtc`); double-complete-idempotent (second call succeeds, no exception); completion-is-append-only (a second completion of the same chore never mutates or removes the first row); unknown-assignment-404. Use a fixed injected clock and NSubstitute repository fakes.

## Risks & Rollback
- R-2 (BRD): two devices completing the same chore offline then syncing. Mitigation: append-only completions + last-writer-wins status is the stated resolution and the idempotency test proves it. Rollback = revert; C5 is `Blocked by` this ticket.

---

## C5: UI - today / this-week chore board with tap-to-complete

**Labels:** `epic:chores` `area:ui` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** C3 (`#<C3>`), C4 (`#<C4>`), T3 (`#<T3>`)
**Serves:** FR-4, BO-1

## Summary
Fill the hub "today" panel with the week's assignments grouped by day and person, glow the active participant's items (from the T3 tap-to-claim state), and let a tap mark an item done via C4 with an optimistic UI update and a distinct completed visual state.

## Context
This is the visible half of the wedge and the payoff of journey 6.2. The board reads assignments from C3 and completes through C4 using the F7 API client. The active-participant glow reuses the tap-to-claim selection from Epic 30 (T3); this ticket does not re-implement claim, it consumes it. Follow the web-first Expo conventions and test runner set up in F4 (see `Butler.UI/AGENTS.md` for the exact versioned APIs).

## Acceptance Criteria
- [ ] The hub "today" panel (the placeholder from T2) renders the current week's assignments grouped by day and by person, sourced from the C3-generated assignment set via the F7 client.
- [ ] When a participant is active (the T3 selection), that person's assignment items are visually highlighted ("glow"); with no active participant the board still renders read-only.
- [ ] Tapping an assignment item calls the C4 complete endpoint and applies an optimistic UI update (the item shows a completed state immediately), reconciling on the response and reverting on error.
- [ ] Completed items are visually distinct from open items (for example checked/dimmed), and a completed item is not re-submittable in a way that produces an error (matches C4 idempotency).
- [ ] Component tests cover: render-grouped-board (assignments appear grouped by day and person), glow-for-active-participant (the active person's items are highlighted), and tap-marks-done (tapping calls the mocked client and the item moves to the completed state).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: `ChoreBoard.test.tsx` (render-grouped-board, glow-for-active-participant, tap-marks-done) with the API client mocked.

## Risks & Rollback
- R: an optimistic update that never reconciles leaves a chore looking done when the write failed. Mitigation: the revert-on-error path is an AC and is covered by the tap test. Rollback = revert; the "today" panel returns to its T2 placeholder.

---

## C6: Fairness view (contribution balance)

**Labels:** `epic:chores` `area:api` `area:ui` `type:feature` `priority:p1`
**Sub-service(s):** `Butler.API/`, `Butler.UI/`
**Blocked by:** C4 (`#<C4>`)
**Serves:** FR-4, BO-1, and the Section 10 fairness success metric.

## Summary
Add the fairness view: an API endpoint that aggregates completed `Effort` per person over a trailing window for the household and returns each person's share, plus a simple UI balance view that shows the distribution and highlights the top contributor's share - the Section 10 fairness guardrail.

## Context
This is journey 6.3's "fairness view" and the metric that tells us the wedge works: the top contributor's share of completed chores should trend down over time (Section 10). The aggregate is computed by scanning the household `ChoreCompletions` partition only (no cross-household query, per 7.3). This is a read-only view over data C4 already writes; it introduces no new write path.

## Acceptance Criteria
- [ ] `GET /api/households/{householdId}/fairness` (accepting an optional trailing-window length, default 4 weeks) returns, per person, the total completed `Effort` and that person's share (fraction or percentage) of the household total over the window.
- [ ] The aggregate is computed by scanning only the household's `ChoreCompletions` partition (`PartitionKey = householdId`); no cross-household query is issued.
- [ ] The share math is correct and total-safe: shares sum to 100 percent (within rounding) when there is at least one completion, and a household with zero completions in the window returns a well-formed empty/zero result rather than a divide-by-zero error.
- [ ] Unknown `householdId` returns `404` as RFC 7807 problem details.
- [ ] A UI balance view renders the per-person distribution and highlights the top contributor's share (the fairness guardrail).
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green; `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test` and `cd Butler.UI && npm run ci:verify`.
- Add tests: `FairnessAggregationTests` (API: shares computed correctly from a set of completions, shares sum to ~100 percent, zero-completion window returns a safe empty result, unknown-household-404); `FairnessView.test.tsx` (UI: renders the distribution and highlights the top contributor) with the API client mocked.

## Risks & Rollback
- R: a divide-by-zero or rounding error in the share math undermines the one metric the wedge is judged on. Mitigation: the zero-completion and sum-to-100 cases are ACs with dedicated tests. Rollback = revert; this is a P1 read-only view, so removing it does not break the C1-C5 loop.

---

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD; this epic implements FR-4 and serves BO-1, with the binding [Engineering Contract 7.6](00-brd-master.md#76-the-v1-fair-assignment-algorithm-deterministic-specified-so-nobody-guesses) fair-assignment algorithm and the [7.3 data model](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid).
- [brd/README.md](README.md) - epic index, label taxonomy, dependency order, and the `gh issue create` recipe.
- [30-epic-tap-to-claim-hub.md](30-epic-tap-to-claim-hub.md) - the hub shell, the tap-to-claim participant identity (T1), the active-participant glow (T3), and the "today" panel (T2) this epic fills in.
- [60-epic-offline-pwa.md](60-epic-offline-pwa.md) - caches the board and queues the completions this epic writes, so the wedge loop survives no network.
