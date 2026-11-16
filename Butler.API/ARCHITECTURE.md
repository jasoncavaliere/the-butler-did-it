# Butler.API - Architecture notes

Per-feature design notes moved out of the README so it stays a quick start. Read only the section for the feature you are touching. The binding rules are in the [Engineering Contract](../Butler.KnowledgeBase/brd/07-engineering-contract.md).

## Architecture notes

The API is a layered, MediatR-based skeleton (Engineering Contract 7.2 in the BRD): `Program.cs` is the
composition root, and each feature plugs in by creating `Application/<Feature>/` (+
`Infrastructure/<Feature>/` and `Domain/<Feature>/` as needed), exposing an `Add<Feature>Feature()`
extension, and registering it in `Program.cs`. Controllers stay thin - they only call
`_sender.Send(...)` and return the result. Every unhandled exception or validation failure becomes an
RFC 7807 problem-details response via `Mediation/ApiExceptionHandler`. MediatR pipeline behaviors live in
`Mediation/`; the first is `HouseholdExistsBehavior` (#295, see "Households" below).

`System` (`Application/System/`, `Controllers/SystemController`) is the reference vertical slice that
proves this path end to end - see `GET /api/system/ping`. `GET /health` remains a plain liveness check
outside the MediatR pipeline, and `GET /me` (see "Organizer authentication" above) is the reference
organizer-only endpoint, gated by the `Organizer` authorization policy rather than MediatR.

Persistence is a shared seam (Engineering Contract 7.3), not per-feature wiring. `Infrastructure/Storage/`
holds an `ITableClientFactory` that resolves an `Azure.Data.Tables` `TableClient` per table name from the
`Storage` config (connection string locally, managed identity via `DefaultAzureCredential` in deployed
envs), plus an `IEntityRepository<TEntity>` base with two implementations - a Table-backed one and an
in-memory seed/fallback one - both scoping every read and write to `PartitionKey = householdId` and
sharing the optimistic-concurrency rules in `Application/Concurrency/` (`If-Match` required -> `428` when
missing, `412` when stale). A feature registers its table with
`services.AddTableRepository<TEntity>("<TableName>")`; the flag picks in-memory vs Table automatically. Each
call also records the table name, and in Table mode `TableProvisioningHostedService` (an `IHostedService`,
so the host awaits it before serving) creates every distinct registered table with `CreateIfNotExists` at
startup. A table that cannot be created is logged by name and fails startup. The whole pass is bounded by
`Storage:ProvisioningTimeout` (default 30s, capped at 3 minutes: a larger value, such as a bare `30` that binds as
30 days, is clamped and logged as warning event 9105 (#256)): on expiry the table in flight is logged (event 9104) and startup
fails with a `TimeoutException` instead of waiting out the SDK retry window (#174). A restart against existing
tables is a no-op; in-memory mode skips provisioning and never builds a storage client. `--seed-demo`
runs before the hosted services, so it provisions the tables itself first. Deploy prerequisite: the API's
managed identity needs the `Storage Table Data Contributor` role on the storage account to create tables. Each
`AddTableRepository` call also registers one `IHouseholdPartitionPurger` per entity type
(`HouseholdPartitionPurger<TEntity>`), and household teardown enumerates them, so a new table is wiped on
teardown with no change to the teardown code (#124).

### Households (the root aggregate)

`Households` (`Application/Households/`, `Infrastructure/Households/`, `Controllers/HouseholdsController`)
is the first data feature and the household model's root aggregate - every later table (rooms, people,
chores, ...) hangs off a `householdId`. The whole controller requires the `Organizer` authorization
policy; only the organizer authenticates in v1 (Engineering Contract 7.4). Persistence goes through
`TableHouseholdRepository` (`IHouseholdRepository`) on the shared Table access seam above, and the
feature registers via `AddHouseholdFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households` | Creates a `Households` row with a server-generated `householdId` (partition key = row key), the caller's object id as `OrganizerObjectId`, and `CreatedUtc` from the injected clock. In the same operation it seeds the organizer's `People` row (`Role = Organizer`, `IsChild = false`) so a household is never left without a roster owner. Returns `201` with the created household (including `ETag`) and a `Location` pointing at `GET /households/{householdId}`. |
| `GET /households/{householdId}` | Returns the household (with its current `ETag`) for a known id, or `404` RFC 7807 problem details for an unknown one. Open to the organizer or a paired hub device (`OrganizerOrHubDevice` policy, #105), so a hub with no organizer signed in still shows its household; a participant session is `403`. `POST /households` stays organizer-only. |
| `DELETE /households/{householdId}` | Tears the household down (#124). Organizer-only. Body `{ "confirmName": "<household name>" }`, which must exactly equal the stored name (ordinal, case-sensitive, no trimming). `HouseholdTeardownService` then runs every registered `IHouseholdPartitionPurger` (no hard-coded table list), deleting every row in the household's partition of every table with the wildcard `If-Match`. It deletes the `Households` row after that first sweep, then sweeps every other table again so a write that lands in an already-purged table mid-teardown is deleted too (#223), and returns `204`. Organizer creates and updates check that the household exists first and answer `404` after teardown (#295, below). Known limit: that check is not atomic with the write, so a write whose check passed before the `Households` row was deleted and that commits after the second sweep can still leave an orphan row. If the `Households` delete or the second sweep throws or is cancelled, the service restores the `Households` row and the response is a `500` RFC 7807 problem with `reason` `teardownIncomplete` and the `householdId`, so a retry of the `DELETE` finishes the purge (#294); only a failure of that restore write itself still leaves the remaining rows unreachable through teardown. A missing, blank, or inexact name (or no body) is a `400` RFC 7807 problem and an unknown id is a `404` problem; a participant session or hub device is `403`; none of these delete anything. Teardown also revokes access: the household's hub-device tokens fail (their `HubDevices` rows are gone) and its participant sessions fail (the handler checks the household still exists), both `401`. This also holds under a race, because the hub touch only replaces an existing row, so a request in flight during the purge cannot re-create it (#222). |

Organizer writes need an existing household (#295). The organizer creates and updates
(`CreateRoomCommand`, `UpdateRoomCommand`, `CreatePersonCommand`, `UpdatePersonCommand`,
`CreateChoreCommand`, `UpdateChoreCommand`, `DeactivateChoreCommand`, `PairHubDeviceCommand`) carry the
`IHouseholdWriteRequest` marker. The open MediatR pipeline behavior `Mediation/HouseholdExistsBehavior`
reads the `Households` row for a marked request before its handler runs; when the household does not
exist (torn down, or never created) it throws `HouseholdNotFoundException`, which `ApiExceptionHandler`
maps to a `404` RFC 7807 problem titled `Household not found.` with detail
`No household with id '<id>' exists.` and a `householdId` extension. Nothing is written. Unmarked requests
pass through with no read. Deletes, tap-to-claim, complete/undo, capture, events and cart writes are not
marked; assignment generation and cart confirm already return `404` for an unknown household.

Organizer auth in Demo (#105): the organizer signs in with a PIN from `BUTLER_DEMO_PIN` through
`POST /auth/pin/sign-in` (`OrganizerPinController` -> `SignInWithPinCommand` ->
`IPinOrganizerSessions`). The singleton `PinOrganizerSessions` holds opaque random tokens in memory with
a sliding idle expiry and a failed-attempt lockout, all timed by the injected `TimeProvider`;
`PinOrganizerAuthenticationHandler` (scheme `PinOrganizer`) turns a live bearer into the dev-organizer
principal. `OrganizerAuthModeResolver` picks the dev bypass, the PIN, or Entra JWT at startup and
fails closed outside Development and Demo. See "Demo organizer PIN" in the README.

### Rooms (the household's physical map)

`Rooms` (`Application/Rooms/`, `Infrastructure/Rooms/`, `Controllers/RoomsController`) is the next spine
piece off the household aggregate - the physical map chores will attach to (H4). Every route is scoped
under `/households/{householdId}/rooms`. Reads (`GET`, list and single) are open to the hub device and
participants; mutations (`POST`, `PUT`, `DELETE`) require the `Organizer` authorization policy
(Engineering Contract 7.4). Updates carry the `If-Match` optimistic-concurrency precondition on the
shared seam above (7.3) - missing it is `428`, a stale value is `412`. An unknown `roomId` is `404` RFC
7807 problem details on `GET`, `PUT`, and `DELETE`. Persistence goes through `TableRoomRepository`
(`IRoomRepository`), and the feature registers via `AddRoomsFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/rooms` | Creates a room with a server-generated `roomId`, the given `Name` and `SortOrder`. Returns `201` with the created room (including `ETag`) and a `Location` pointing at `GET .../rooms/{roomId}`, or `404` `Household not found.` when the household does not exist (#295). |
| `GET /households/{householdId}/rooms` | Lists the household's rooms ordered ascending by `SortOrder` (ties broken by `roomId` for stable ordering). |
| `GET /households/{householdId}/rooms/{roomId}` | Returns the room (with its current `ETag`) for a known id, or `404` for an unknown one. |
| `PUT /households/{householdId}/rooms/{roomId}` | Updates `Name`/`SortOrder` under the `If-Match` precondition. Returns `200` with the updated room, `404` for an unknown room (or `Household not found.` for a missing household, #295), `428` when `If-Match` is missing, or `412` when it is stale. |
| `DELETE /households/{householdId}/rooms/{roomId}` | Deletes the room unconditionally (delete is not concurrency-gated). Returns `204`, or `404` for an unknown room. |

### People (the household's organizer-managed roster)

`People` (`Application/People/`, `Infrastructure/People/`, `Controllers/PeopleController`) is the
organizer-managed roster of participants and children off the household aggregate; H1's household
creation already seeds the organizer's own row, so this feature adds participant/child management. Every
route is scoped under `/households/{householdId}/people`. The organizer CRUD reads (`GET`, list and
single) are open to any authenticated caller; the list route now returns the **trimmed tap-to-claim
roster** (see below) rather than the full organizer shape. Mutations (`POST`, `PUT`, `DELETE`) require
the `Organizer` authorization policy (Engineering Contract 7.4). Updates carry the `If-Match`
optimistic-concurrency precondition on the shared seam above (7.3) - missing it is `428`, a stale value
is `412`. An unknown `personId` is `404` RFC 7807 problem details on `GET`, `PUT`, and `DELETE`. A
household must always retain at least one organizer: a request that would demote or delete the last
remaining organizer is rejected with `400` RFC 7807 problem details and the row is left unchanged.
Persistence goes through `TablePersonRepository` (`IPersonRepository`), and the feature registers via
`AddPeopleFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/people` | Creates a person with a server-generated `personId`, the given `DisplayName`, `Role` (`Organizer` or `Participant`), `IsChild`, and `ClaimColor`. Returns `201` with the created person (including `ETag`) and a `Location` pointing at `GET .../people/{personId}`, or `404` `Household not found.` when the household does not exist (#295). |
| `GET /households/{householdId}/people` | Returns the claimable tap-to-claim roster: `{ personId, displayName, claimColor, isChild }` for every person in the household (open, unauthenticated read - no bearer token needed even when authentication is enabled). It never carries organizer-only fields such as `OrganizerObjectId`, nor `role`/`ETag`. |
| `GET /households/{householdId}/people/{personId}` | Returns the full person detail (with its current `ETag`) for a known id, or `404` for an unknown one (the organizer CRUD contract; open read). |
| `POST /households/{householdId}/people/{personId}/claim` | Tap-to-claim (T1): requires no password and no organizer JWT. Issues a participant session scoped to exactly `(householdId, personId)` - see "Participant sessions (tap-to-claim)" above. Returns `200` with `{ householdId, personId, displayName, claimColor, isChild, token }`, or `404` RFC 7807 problem details for an unknown `personId` or `householdId`. |
| `PUT /households/{householdId}/people/{personId}` | Updates `DisplayName`/`Role`/`IsChild`/`ClaimColor` under the `If-Match` precondition. Returns `200` with the updated person, `404` for an unknown person (or `Household not found.` for a missing household, #295), `428` when `If-Match` is missing, `412` when it is stale, or `400` when the change would demote the household's last organizer. |
| `DELETE /households/{householdId}/people/{personId}` | Deletes the person unconditionally (delete is not concurrency-gated). Returns `204`, `404` for an unknown person, or `400` when the deletion would remove the household's last organizer. |

### Chores (recurring tasks attached to a room)

`Chores` (`Application/Chores/`, `Infrastructure/Chores/`, `Controllers/ChoresController`) is the last
spine piece off the household aggregate before assignment - each chore attaches to a `Room` (H2) and
carries the `Effort`, `Cadence`, and `MinAge` the Epic 40 fair-assignment engine reads. Every route is
scoped under `/households/{householdId}/chores`. Reads (`GET`, list and single) are open to the hub
device and participants; mutations (`POST`, `PUT`, `POST .../deactivate`) require the `Organizer`
authorization policy (Engineering Contract 7.4). Updates carry the `If-Match` optimistic-concurrency
precondition on the shared seam above (7.3) - missing it is `428`, a stale value is `412`. `RoomId` must
reference an existing room in the same household (create/update with an unknown `RoomId` is `400`), and
`Effort` must be a positive integer (a non-positive value is `400`). A chore is deactivated
(`Active = false`) rather than deleted, so historical assignments and completions keep referential
meaning; there is no delete endpoint. An unknown `choreId` is `404` RFC 7807 problem details on `GET`,
`PUT`, and `POST .../deactivate`. Persistence goes through `TableChoreRepository` (`IChoreRepository`),
and the feature registers via `AddChoresFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/chores` | Creates a chore with a server-generated `choreId`, the given `Title`, `RoomId`, `Cadence` (`Daily` or `Weekly`), `Effort`, and `MinAge` (nullable). `Active` defaults to `true`. Returns `201` with the created chore (including `ETag`) and a `Location` pointing at `GET .../chores/{choreId}`, `400` for an unknown `RoomId` or non-positive `Effort`, or `404` `Household not found.` when the household does not exist (#295). |
| `GET /households/{householdId}/chores` | Lists the household's chores, optionally filtered with `?active=true`/`?active=false` (open read). |
| `GET /households/{householdId}/chores/{choreId}` | Returns the chore (with its current `ETag`) for a known id, or `404` for an unknown one. |
| `PUT /households/{householdId}/chores/{choreId}` | Updates `Title`/`RoomId`/`Cadence`/`Effort`/`MinAge`/`Active` under the `If-Match` precondition. Returns `200` with the updated chore, `404` for an unknown chore (or `Household not found.` for a missing household, #295), `400` for an unknown `RoomId` or non-positive `Effort`, `428` when `If-Match` is missing, or `412` when it is stale. |
| `POST /households/{householdId}/chores/{choreId}/deactivate` | Sets `Active = false` and retains the row. Returns `200` with the updated chore, or `404` for an unknown chore (or `Household not found.` for a missing household, #295). |

### Assignments (weekly fair-assignment generation)

`Assignments`/`ChoreCompletions` (`Domain/Scheduling/`, `Application/Assignments/`,
`Infrastructure/Assignments/`, `Infrastructure/ChoreCompletions/`, `Controllers/AssignmentsController`)
is the Epic 40 chore-assignment pipeline. C1 shipped the tables, repositories, and clock; C2 added the
pure, deterministic `FairAssignmentEngine` (`IFairAssignmentEngine`) that turns a week's active chores,
eligible people, and each person's trailing load into an assignment set per Engineering Contract 7.6; C3
(below) adds the endpoint that composes fetch -> compute -> persist around that engine.

- `AssignmentEntity` (`Assignments` table) is one chore assigned to one person for one ISO week -
  `PartitionKey = householdId`, `RowKey = {weekIso}_{choreId}`, with `AssignedPersonId`, `WeekIso`,
  `DueDateUtc`, and a `Status` of `Open` or `Done` (`AssignmentStatus`). C4 flips `Status` to `Done`
  under the same `If-Match` optimistic-concurrency rules used above (missing -> `428`, stale -> `412`).
- `ChoreCompletionEntity` (`ChoreCompletions` table) is an **append-only** ledger entry (BRD R-2: never
  updated or deleted) recording that a person completed a chore - `PartitionKey = householdId`,
  `RowKey = {completedUtcTicks}_{choreId}`, with `ChoreId`, `PersonId`, `CompletedUtc`, `Effort`, and
  `WeekIso` for the fairness math to read.
- Both are exposed behind repository interfaces (`IAssignmentRepository`, `IChoreCompletionRepository`)
  with Table-backed implementations (`TableAssignmentRepository`, `TableChoreCompletionRepository`) on
  the shared F3 storage seam above; every read/write is scoped to `PartitionKey = householdId`.
- `WeekIso.For(DateTimeOffset)` (`Domain/Scheduling/`) is the deterministic ISO-8601 year-week helper
  (for example `2026-07-14` -> `2026-W29`) every assignment, completion, and future grocery-cart bucket
  shares. It always takes a caller-supplied instant - never `DateTime.Now`/`DateTime.UtcNow` - so a
  `TimeProvider` (registered here as `TimeProvider.System`) keeps the week math deterministic in tests,
  including across the ISO week-numbering-year boundary. `WeekIso.StartOfWeekUtc(string)` is its
  inverse: it parses a `{year}-W{week}` string back into that week's Monday 00:00:00 UTC, which the C3
  generator uses to bucket completions into the trailing window and to derive a week's due date.
- `IFairAssignmentEngine.Assign(...)` (C2) is a pure function - no storage, no clock, no randomness -
  that applies 7.6's rules exactly: a child is eligible only for chores with `MinAge == null`; chores
  are processed by descending `Effort` then ascending `choreId`; each chore goes to the eligible person
  with the lowest current load (tie-break: fewest chores assigned this week, then lowest `personId`); a
  chore with no eligible person comes back unassigned with a reason code rather than being dropped or
  throwing.
- `IAssignmentGenerationService.GenerateAsync(...)` (C3) is the only place that composes fetch ->
  compute -> persist: it loads the household's active chores (H3) and people (H4), computes each
  person's trailing-4-ISO-week completed `Effort` from `ChoreCompletions` net of undo
  (`ChoreCompletionLedger.NetOfUndo`), resolves `weekIso` from the
  request or the injected clock, runs the C2 engine, and persists the result via the C1 repositories.
- `IAssignmentGenerationService.GetOrGenerateAsync(...)` (#110) is the hub board's lazy read. Only the
  current week per the injected clock is ever generated, and only while it has no stored rows; a week
  that already has rows, and any past or future week, is returned as stored with no lock and no writes.
  Generation runs the same C2/C3 body as `GenerateAsync` under a per-household in-process lock
  (`AssignmentGenerationGate`, a singleton `SemaphoreSlim` per household) that `GenerateAsync` also
  takes, and the week is re-read inside the lock, so concurrent first reads persist one set. The lock
  guards one process only (the demo runs one API instance). The stored projection returns every `Done`
  row and the `Open` rows of chores that are still active (effort from the chore, `0` if it is gone);
  `unassigned` is always empty because unplaced chores are never persisted. A household with no active
  chores or no eligible members reads as an empty week and nothing is persisted.
- The feature registers via `AddAssignmentsFeature()` in `Program.cs`, which wires both tables, both
  repositories, the clock, the engine, the generation service, and (C4) `IChoreCompletionService`.
- `IChoreCompletionService.CompleteAsync(...)` (C4) is the only place that composes the tap-to-complete
  write: it appends an append-only `ChoreCompletion` crediting the acting `personId` with the chore's
  `Effort` at the injected clock's instant, bucketed into the assignment's ISO week, then flips the
  matching `Assignment.Status` to `Done` using the row's read `ETag` as the `If-Match` precondition
  (BRD R-2, last-writer-wins per `(householdId, weekIso, choreId)`). Completing an assignment already
  `Done` is a success no-op - no second completion is appended, so trailing-load fairness never
  double-counts and the ledger is never mutated.
- `IChoreCompletionService.UndoAsync(...)` (C7) is the inverse: it flips the matching `Assignment.Status`
  back to `Open` under the same `If-Match` precondition, and backs out the credited effort by appending
  a **compensating** `ChoreCompletion` of `-effort` (row key `{ticks}_{choreId}_void`) stamped with the
  `personId` who pressed undo, as an audit of who undid it - the ledger stays append-only (BRD R-2: the
  original entry is never touched or deleted). The undoer need not be the completer, so the read models
  never sum the reversal by its own `personId`: `ChoreCompletionLedger.NetOfUndo`
  (`Infrastructure/ChoreCompletions/`, #220) replays the ledger in `CompletedUtc` order (a completion before a reversal at the
  same instant), pairs each `_void` reversal with the latest un-reversed completion of the same chore in
  the same week, and drops both, so the effort is effectively charged back to that completion's person.
  A reversal with nothing open to cancel is dropped as an orphan, so no person's net effort or count can
  go negative. Fairness, Insights and the C3 trailing-load read
  (`AssignmentGenerationService.ComputeTrailingLoadsAsync`, #291) all read through it.
  Undoing an assignment that is already `Open` (or was never completed) is a success no-op - no
  compensating entry is appended, so effort is never double-subtracted.
- Both `CompleteAsync` and `UndoAsync` first apply the completion week window (issue #86,
  `Domain/Scheduling/CompletionWeekWindow`): the requested `weekIso` must be the current ISO week, or the
  immediately previous ISO week while the injected clock is less than 24 hours after the Monday 00:00 UTC
  rollover (so the previous week stays open until Tuesday 00:00 UTC). Both weeks come from
  `WeekIso.For` on the injected `TimeProvider`; the requested value is compared, never parsed. Any other
  week - two or more back, the previous week after the grace window, or a future week - throws
  `WeekNotCurrentException` before any repository access, so nothing is read or written. The window is
  checked before the assignment lookup, so an out-of-window week is a `409` even when no assignment
  matches; the `404` applies inside the window only.

| Endpoint | Behavior |
| --- | --- |
| `GET /households/{householdId}/assignments/{weekIso}` | Reads a household week (#110), generating it first when it is the current week per the injected clock and has no assignments yet; any other week is returned as stored and never generated (see `GetOrGenerateAsync` above). Returns `200` with an `AssignmentSetResponse` whose `currentWeekIso` is the server's own week, so the hub can detect clock skew; `400` for a malformed `weekIso`; `404` RFC 7807 problem details for an unknown `householdId`. Same `OrganizerOrHubDevice` policy as `generate` (a participant session is `403`). This is what the hub chore board loads. |
| `POST /households/{householdId}/assignments/generate` | Generates or regenerates the household's assignments for a week. Accepts an optional JSON body `{ "weekIso": "2026-W29" }`; an empty body (or an omitted `weekIso`) computes the current week from the injected clock. **Regenerate is idempotent:** re-running it for a week that already has assignments replaces only `Open` rows - `Done` assignments and their `ChoreCompletions` are preserved untouched, and their effort is folded into the recomputed trailing loads so a completed chore is never reassigned. Returns `200` with an `AssignmentSetResponse` (`weekIso`, the placed `assignments` - `choreId`, `assignedPersonId`, `effort`, `status`, ordered by `choreId` - any `unassigned` chores with their reason code, also ordered by `choreId`, and `currentWeekIso`, the server's own week), or `404` RFC 7807 problem details for an unknown `householdId`. Requires the `OrganizerOrHubDevice` authorization policy - an `Organizer` JWT (or the dev bypass) or a paired hub device token may call it; a plain participant session cannot (`403`). |
| `POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete` | Completes an assignment from a tap (C4, journey 6.2): appends a `ChoreCompletion` and sets the matching `Assignment.Status` to `Done` under optimistic concurrency. Completion is **not** a sensitive action (Decision D-3), so any authenticated caller may drive it - a tap-to-claim participant session (T1) or a paired hub device (T5) - with no `Organizer` policy required. Accepts an optional JSON body `{ "personId": "..." }`: a participant session attributes the completion to its own `personId` and may omit the body entirely; a hub device or organizer must supply the acting `personId` (the UI's active participant, T3) or the call is `400`. A second complete of an already-`Done` assignment is an idempotent success, not an error. Only the current ISO week, or the previous week within 24 hours of the Monday 00:00 UTC rollover, is open; any other `weekIso` is `409` RFC 7807 problem details (`type` `https://httpstatuses.io/409`) with extensions `reason` = `weekNotCurrent`, `requestedWeekIso`, and `currentWeekIso`, and nothing is written. Returns `200` with the completed assignment's `weekIso`, `choreId`, `assignedPersonId`, and `status`, or `404` RFC 7807 problem details when no assignment matches `(householdId, weekIso, choreId)` inside the window. |
| `POST /households/{householdId}/assignments/{weekIso}/{choreId}/undo` | Reverses a completion from a tap (C7, follows up C5): flips the matching `Assignment.Status` back to `Open` under optimistic concurrency and backs out the credited effort with a compensating append-only `ChoreCompletion` (the ledger is never deleted from). Authorization and actor resolution mirror `complete` exactly - any authenticated caller, same optional `{ "personId": "..." }` body rule, `400` with no resolvable actor. Undoing an already-`Open` (or never-completed) assignment is an idempotent success, not an error. The same week window as `complete` applies: an out-of-window `weekIso` is the same `409` `weekNotCurrent` problem and the assignment is not un-completed. Returns `200` with the reopened assignment's `weekIso`, `choreId`, `assignedPersonId`, and `status` (always `Open`), or `404` RFC 7807 problem details when no assignment matches `(householdId, weekIso, choreId)` inside the window. |

### Fairness (contribution balance)

`Fairness` (`Application/Fairness/`, `Controllers/FairnessController`) is the Epic 40 C6 read model
behind journey 6.3's fairness view and the Section 10 fairness guardrail (the top contributor's share
of completed chores trending down over time). It is a pure aggregate over data C4 already writes and
introduces no new table, repository, or write path: `IFairnessService.GetAsync(...)` scans only the
household's `ChoreCompletions` partition (`PartitionKey = householdId`, 7.3 - no cross-household query),
buckets each completion into a trailing ISO-week window anchored to the injected clock's current week
(same `WeekIso` helper the assignment pipeline shares, 7.5), nets undo first with
`ChoreCompletionLedger.NetOfUndo` (each `_void` reversal cancels the completion it reversed, whoever
pressed undo, and before organizers are skipped, so an organizer's undo still cancels a participant's
completion; #220), sums the surviving completions' `Effort` per person, and joins display
names from the People roster (H3) - falling back to the raw id for a person no longer on the roster,
since the ledger is the source of truth. The share math is total-safe: a window with zero completions
returns a well-formed zero result (every share `0`, `topContributorPersonId` `null`) rather than
dividing by zero, and shares are ordered by effort descending (ties by `personId`) so the payload is
deterministic. The feature registers via `AddFairnessFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `GET /households/{householdId}/fairness` | Reads the household's contribution balance over the trailing `windowWeeks` ISO weeks (query string, default `4`). Open to the hub device and participants, like the other glanceable reads (7.4) - no `Organizer` policy required. Returns `200` with a `FairnessResponse` (`windowStartWeekIso`, `windowEndWeekIso`, `windowWeeks`, `totalEffort`, `topContributorPersonId`, and `shares` - each person's `personId`, `displayName`, `totalEffort`, `share` (`0`..`1`), and `sharePercent` (`0`..`100`), ordered by effort descending). Returns `404` RFC 7807 problem details for an unknown `householdId`, or `400` for a `windowWeeks` less than `1`. |

### Grocery (store-connector seam)

`Grocery` (`Application/Grocery/`) is the start of Epic 50's assisted-cart flow: the **store-connector
seam** (BRD decision D-4, Engineering Contract 7.2) every grocery consumer will talk to, so a connector
can be swapped without touching callers. `IStoreConnector` defines `SearchProductsAsync(query)`
(case-insensitive substring match against a product's display name and catalog synonyms, deterministic
ordering by display name then product id, empty list for no match/blank query - never an exception) and
`GetProductAsync(productId)` (the matching product or `null`). Both return `StoreProduct` - `ProductId`,
`DisplayName`, `Size`/`Unit`, an `IndicativePrice` (display text only, **never a charge**), and a
`SourceConnector` identifying which connector produced the result. `SimulatedHebConnector` is the v1 (and
only) implementation: it searches a checked-in fixture catalog (`SeedData/grocery/heb-catalog.json`,
embedded in the assembly) fully offline, with no file-system or network dependency at runtime, and
stamps every result `SourceConnector = "simulated-heb"`. The fixture holds about 200 items in six
lowercase categories (`produce`, `dairy`, `pantry`, `frozen`, `household`, `kids`; meats are frozen
products), and each item carries a `category` and an `iconId` (equal to the category) on
`HebCatalogProduct`. The six per-category SVG icons live in `SeedData/grocery/icons/`, are embedded as
`Butler.Api.SeedData.grocery.icons.<iconId>.svg` (`HebCatalog.IconResourcePrefix`), and are original
CC0 artwork (source and license in that folder's README). Category and icon are not yet on
`StoreProduct` or any HTTP response; surfacing them on the hub is a UI follow-up. The feature registers via
`AddStoreConnectorFeature()` in `Program.cs`, binding `IStoreConnector` to a singleton
`SimulatedHebConnector`. Its HTTP surface starts with the cart (G2, below) and the capture seam (G3,
below); confirm (G4) builds on top of them.

### Carts (weekly grocery cart)

`Carts` (`Domain`/`Infrastructure`/`Application` under `Carts/`, `Controllers/CartsController`) is Epic
50's G2: the weekly grocery cart every capture (G3) and confirm (G4) write into. A household has exactly
one cart per ISO week - `CartEntity` (`Carts` table, `PartitionKey = householdId`, `RowKey = {weekIso}`)
carries `Status` (`Building`/`Confirmed`, `CartStatus`), `ConfirmedByPersonId`, and `ConfirmedUtc` behind
`ICartRepository`; `CartItemEntity` (`CartItems` table, `RowKey = {cartWeekIso}_{itemId}`) is one line
item - `ProductId`, `DisplayName`, `Quantity`, `AddedByPersonId`, `SourceConnector` (from the G1
connector), `IndicativePrice` (the connector's price as captured when the line was added), and
`IsCustom` - behind `ICartItemRepository`. Both share the F3 storage seam, so every read/write stays
inside the household's partition (7.3).

**Custom items and totals (#113).** A term the catalog cannot match can still go on the list as a
custom line: `ICartService.AddCustomItemAsync` writes a `CartItems` row with `IsCustom = true`, an
empty `ProductId`, `SourceConnector = custom` (`CartItemSources.Custom`), and no price. It validates the
display name **before** any storage access (a blank name writes nothing, not even the week's cart row),
then reuses the get-or-create rules (unknown household, malformed week, confirmed week) and the same
two-step write as a capture: the cart row's version advances under its `ETag` before the line is added,
so a confirm holding the older version is a `412`. On read, a custom line has `productId` and
`indicativePrice` `null` and `isCustom: true`. `CartResponse` carries two computed members:
`estimatedTotal` (quantity times the parsed indicative price, summed over catalog lines; see
`CartPricing`, which strips a leading `$` and parses culture-invariant) and `customItemCount`. Prices
are read from the persisted line, never looked up from the connector, so the cart path stays inside the
IL guard below; a line written before prices were persisted totals as `0`. Custom lines ride through
the G4 confirm unchanged, so the confirmed cart (the D-8 order intent) keeps them.

`ICartService` is the read/compose surface: `GetOrCreateBuildingCartAsync` get-or-creates the current
week's `Building` cart (the week comes from a supplied `weekIso` or the injected `TimeProvider`, never
`DateTime.Now`, 7.5) and never mints a second row for a week that already has one; `GetCartAsync` reads
any week's cart exactly as it stands, creating nothing. Both compose the cart with its items into one
`CartResponse` in a single read. Asking for the building cart on a week whose cart is already
`Confirmed` throws `CartAlreadyConfirmedException`, mapped by `Mediation/ApiExceptionHandler` to `409
Conflict` - a confirmed cart is never handed back as the building cart, though it stays readable through
the by-week `GET`. The feature registers via `AddCartsFeature()` in `Program.cs`.

`ICartConfirmationService` is G4 - **the human on the final tap** (journey 6.4). `ConfirmAsync` reads the
week's cart through `ICartService`, then flips the single row to `Confirmed` with `ConfirmedByPersonId`
(the organizer's `People` row, resolved from the caller's `OrganizerObjectId` per 7.4) and `ConfirmedUtc`
(from the injected clock) under the cart's `If-Match` precondition (7.3). Step order carries the
behaviour: an already-`Confirmed` cart returns **before** any write, which is what makes a replayed
confirm an idempotent no-op success - who/when and even the version stamp stand - rather than a `412`,
while a confirm racing a cart that grew a line still fails the precondition and must re-read.

Confirming **records intent only**: per BRD decision D-8 no real order is placed and no money moves, so
the confirm path holds no store connector, no HTTP client, and no payment seam - its only side effect is
the cart row's own status. That absence is the safety boundary that keeps tap-to-claim safe (risk R-1),
so it is asserted twice rather than left as a convention: `ConfirmCartTests` substitutes `IStoreConnector`
and proves it receives no calls during a confirm, and `ConfirmCartNoExternalCallGuardTests` scans the
shipped IL of every cart type for any call into the connector namespace or `System.Net.*` (with a
non-compliant canary proving the scan is red on a real violation).

| Endpoint | Behavior |
| --- | --- |
| `GET /households/{householdId}/carts/current` | Returns the household's current `Building` cart with its items, creating the week's cart on first use (get-or-create); calling it twice returns the same cart. The week defaults to the injected clock's current week or takes an optional `weekIso` query string. Returns `200` with a `CartResponse`, `404` RFC 7807 problem details for an unknown `householdId`, `400` for a malformed `weekIso`, or `409` when that week's cart is already `Confirmed`. Open to the hub and participants - no `Organizer` policy required: this is the review a human does before the final tap, and confirm is the sensitive action. |
| `GET /households/{householdId}/carts/{weekIso}` | Reads one week's cart with its items exactly as it stands - this route creates nothing. Returns `200` with a `CartResponse`, or `404` RFC 7807 problem details with distinct titles for an unknown `householdId` versus a week with no cart yet. |
| `POST /households/{householdId}/carts/{weekIso}/items` | Adds a custom item (a name the catalog could not match) to the week's `Building` cart, creating the cart on first use (`{ "displayName": "unicorn steaks", "personId": "...", "quantity": 1 }`; `quantity` defaults to `1`). Returns `201` with the created `CartItemView` (`isCustom: true`, no `productId`, no `indicativePrice`) and a `Location` of the by-week read. A blank `displayName` is `400` RFC 7807 and adds nothing; a missing actor is `400`; an unknown `householdId` is `404`; a malformed `weekIso` is `400`; a week already `Confirmed` is `409`. Requires only authentication, like capture (D-3) - an unauthenticated caller is `401`; the acting person comes from a participant session when one is presented, otherwise from `personId` in the body. |
| `POST /households/{householdId}/carts/{weekIso}/confirm` | Confirms the reviewed cart (G4): `Status` becomes `Confirmed` with the confirming organizer's person and the injected clock's time, returned as `200` with the full `CartResponse`. Carries `[Authorize(Policy = "Organizer")]` - a participant session or paired hub device is `403`, an unauthenticated caller `401`. Idempotent: confirming an already-`Confirmed` cart is a no-op success that leaves `ConfirmedByPersonId`/`ConfirmedUtc` untouched. Send the reviewed cart's `ETag` as `If-Match` (`428` when missing, `412` when stale). An unknown `householdId` and a week with no cart are distinct `404` RFC 7807 documents; a malformed `weekIso` is `400`. **No order is placed and no money moves** (D-8). |

### Capture (utterance -> cart item)

`Capture` (`Application/Capture/`, `Controllers/CaptureController`) is Epic 50's G3: the seam that turns
"add oat milk" - typed at the hub or spoken - into a cart line. `ICaptureSource` is that seam. Its two v1
implementations are deliberately **thin normalizers over one shared handler**, not two code paths:
`HubTextCaptureSource` (`hub-text`) trims typed input, `SimulatedVoiceCaptureSource`
(`simulated-voice`) strips a leading wake word (`"Butler, add eggs."`) from a simulated transcript, and
both then call the same `ICaptureHandler`. **Live Alexa capture is out of scope** (BRD Section 9
fast-follow) - it is a third source behind this seam, not a change to the behaviour below it.

`CaptureHandler` is that shared behaviour and owns no storage of its own. `UtteranceNormalizer` extracts
the product term with one documented pass - trim sentence punctuation per word (so `H-E-B` and `2%`
survive), drop leading fillers (`please`, `add`, `a`, `an`, `some`), drop a trailing `to the cart` /
`to the list` - and no NLP; a quantity is never read out of the sentence. The term then resolves through
`IStoreConnector.SearchProductsAsync` (G1) and the resolved product is added to the household's
`Building` cart from `ICartService.GetOrCreateBuildingCartAsync` (G2), with `Quantity` defaulting to `1`,
`AddedByPersonId` from the active participant/hub session, and `SourceConnector` and `IndicativePrice`
carried straight off the G1 result (the price is persisted so the cart read can total it without a
connector call). Adding a line also advances the **cart row's** version stamp under the `ETag` the
get-or-create read returned (7.3), so a G4 confirm holding an older version is a `412` and must re-read
rather than confirm a cart that grew underneath it.

Resolution is deliberately cautious: an exact display-name hit wins, a single match is the top match,
and several equally plausible matches resolve to **suggestions** instead of a silent guess. Every
non-added outcome is a structured value (`CaptureResult` / `CaptureOutcome`), so bad input is an RFC 7807
document and never an unhandled exception. The feature registers via `AddCaptureFeature()` in
`Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/capture/text` | Captures text typed at the hub (`{ "utterance": "add oat milk", "personId": "...", "weekIso": "...", "quantity": 2 }`; every member optional) and adds the resolved product to the household's current building cart. Returns `200` with a `CaptureResponse` (`outcome`, capture source, resolved term, week, `item`, and `suggestions`): `outcome` is `Added` with the created line, or `NoMatch` with `item` `null` and an empty `suggestions` list when the store matched nothing (#113 - the hub then offers the term as a custom item). Ambiguous input is `400` RFC 7807 carrying `suggestions` (the candidate products) plus `resolvedTerm`; an utterance with no product term is `400`; an unknown `householdId` is `404`; a week already `Confirmed` is `409`. Requires only authentication, not the `Organizer` policy - anyone at the hub may add (D-3); the acting person comes from a participant session when one is presented, otherwise from `personId` in the body (a missing actor is `400`). |
| `POST /households/{householdId}/capture/voice` | The same operation for a simulated voice transcript (`"Hey Butler, add eggs."`), through the same shared handler with the wake word stripped first. Identical request body, responses, and authorization. |

Per the vision's modularity tenet, the API will eventually organize around the **household model** as
the shared spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on
top. `Households`, `Rooms`, `People`, and `Chores` are the first of these feature modules, and
tap-to-claim (Epic 30, T1 - see "Participant sessions (tap-to-claim)" above) is the first piece of the
participant identity model; the Epic 40 fair-assignment engine now has its generate/regenerate endpoint
(C1-C3), its chore-completion endpoint (C4), its tap-to-undo endpoint (C7), and its read-only fairness
view (C6, above); Epic 50 groceries has its store-connector seam (G1), its weekly cart (G2), its capture
seam (G3), and its organizer-gated confirm (G4, above) - so the API side of "add oat milk -> review ->
confirm" is complete end to end against the simulated connector, with the hub screen for it (G5) still to
come - and calendar has not been built yet.

### Events (usage events, #122)

`Events` (`Application/Events/`, `Infrastructure/Events/`, `Controllers/EventsController`) is an
append-only log of how the household uses Butler, for the insights read (#123) to count. Each row is an
`EventEntity` in the `Events` table, `PartitionKey = householdId`, `RowKey =
{OccurredUtc.UtcTicks:D19}_{guid N}` (so a partition lists in time order and two events in one tick never
collide). The row carries only the event `Type`, `OccurredUtc` (from the injected `TimeProvider`), and the
ids that already exist in the household model: `PersonId`, `ChoreId`, `WeekIso`, `ItemId`. It never
carries a name, an utterance, or any other free text; `EventEntityPrivacyTests` pins the exact property
set. `IEventRepository` is append-only (`AddAsync` and `ListAsync`).

Five event types are recorded server-side, each by the **MediatR handler** after its primary call
succeeds:

| Type | Recorded by | When |
| --- | --- | --- |
| `chore-completed` | `CompleteChoreCommandHandler` | the completion flipped the assignment to `Done` (an already-`Done` replay records nothing) |
| `chore-undone` | `UndoChoreCommandHandler` | the undo flipped the assignment back to `Open` (an already-`Open` or never-completed undo records nothing) |
| `cart-item-added` | `CaptureUtteranceCommandHandler` | the capture outcome is `Added` (`ItemId` is the new line) |
| `cart-confirmed` | `ConfirmCartCommandHandler` | the confirm flipped the cart to `Confirmed` (`PersonId` is the confirming organizer; an already-`Confirmed` replay records nothing) |
| `participant-claimed` | `ClaimPersonCommandHandler` | the claimed person is on the roster |

They live in the handlers, not in `ChoreCompletionService`, `CaptureHandler` or
`CartConfirmationService`, because the demo seeder calls those services directly and must not write fake
usage on every seed. For complete, undo and confirm the service returns a result record
(`CompleteChoreResult`, `UndoChoreResult`, `ConfirmCartResult`) that wraps the response with a
`Changed` flag, and the handler records only when `Changed` is true, so an idempotent replay counts
once (#218). The confirm handler also records nothing when the re-read finds the cart gone (for
example after a re-seed), and the endpoint returns that read's `404` (#289). The flag never reaches the
HTTP body. The handlers use `IEventRecorder.TryRecordAsync`, which is best effort: a storage failure is
logged as a warning and swallowed (cancellation is not), so a usage event can never fail the action it
describes.

The one client-posted type is `hub-glanced`. `EventTypes.IsClientAllowed` accepts only that exact
string (ordinal, case-sensitive); any other type, including `participant-claimed`, is a `400` before any
I/O, so a client cannot forge a server-side event. The UI debounces glances to one per hub device per 10
minutes; the API does not dedupe them.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/events` | Records a client usage event (`{ "type": "hub-glanced" }`). Returns `204`. Any other type, or an empty body, is a `400` RFC 7807 document and records nothing; an unknown `householdId` is `404`. Requires only authentication (a paired hub device, participant session or organizer), not the `Organizer` policy. |

Known limits, accepted by design: a glance replayed after an outage is stamped with the server time of
the replay; and `Events` is not purged by the demo re-seed or by household teardown (#124). The feature
registers via `AddEventsFeature()` in `Program.cs`, last, so `Events` is the last table provisioned.

### Insights (organizer read model, #123)

`Insights` (`Application/Insights/`, `Controllers/InsightsController`) is the organizer's view of how
the household is doing. Like Fairness it is a pure read model with no table of its own:
`IInsightsService.GetAsync(...)` reads only the household's partitions (7.3) of `ChoreCompletions`,
`People`, `Events` (#122) and `Carts` (through `ICartRepository.ListAsync`, added for this read). The
window is the current ISO week from the injected `TimeProvider` (7.5) and the `weeks - 1` weeks before
it; the window starts on the Monday of the oldest week. Every bucket is UTC, like `WeekIso`, and every
series is oldest first and zero-filled.

- **Members** are the non-organizer roster plus any ledger person no longer on it (name falls back to the
  id), ordered by display name then id (ordinal). Organizers are excluded, as in Fairness.
- **Undo netting**: the window's rows are netted with `ChoreCompletionLedger.NetOfUndo` before
  organizers are dropped (#220). Each `_void` reversal cancels the latest un-reversed completion of the
  same chore in the same week and is charged to that completion's person, not to whoever pressed undo;
  an organizer's undo still cancels a participant's completion, and an orphan reversal is ignored. Only
  surviving completions (all with positive effort) reach the series below, so counts and effort are
  never negative and the share stays within `0..1`.
- **Top contributor's share per week**: completions are bucketed by their stored `WeekIso` (not
  `CompletedUtc`); effort is summed per member over the surviving completions. When the week's total is
  zero there is no top contributor and the share is `0`; otherwise the top is the greatest effort (ties
  by `personId`) and the share is top / total.
- **Completions per member per week**: `+1` per surviving completion.
- **Glances per day**: `hub-glanced` events per UTC date from the window start through today; events
  before the window or after now are ignored.
- **Carts confirmed per month**: carts with `Status = Confirmed` and a `ConfirmedUtc` in
  `[windowStart, now]`, per UTC month from the window-start month through the current month. Carts are
  counted from the `Carts` table, not from `cart-confirmed` events, because events are not purged on the
  demo re-seed.

`weeks` is required and capped at 52: without a cap the date math can overflow and the payload is
unbounded. The feature registers via `AddInsightsFeature()` in `Program.cs`, after Fairness.

| Endpoint | Behavior |
| --- | --- |
| `GET /households/{householdId}/insights?weeks=N` | Organizer only (`Organizer` policy): a participant session or a paired hub device is `403`. Returns `200` with an `InsightsResponse` (`windowStartWeekIso`, `windowEndWeekIso`, `windowWeeks`, `members` (`personId`, `displayName`, `claimColor`), `weeks` (`weekIso`, `totalEffort`, `topContributorPersonId`, `topContributorShare` `0`..`1`, `completions` per member), `glancesPerDay` (`date` `yyyy-MM-dd`, `count`), `cartsConfirmedPerMonth` (`month` `yyyy-MM`, `count`)). A missing, non-numeric, or out-of-range `weeks` (below `1` or above `52`) is a `400` RFC 7807 document; an unknown `householdId` is `404`. |

### System (health + dataset id + build version)

`System` (`Application/System/`, `Infrastructure/System/`, `Controllers/SystemController`) is the
reference slice (`GET /api/system/ping`) and, since #100 (D7), the owner of the deployment's
**dataset id**: an opaque id for the data the API currently serves, which changes whenever that data
is replaced. The hub compares it with the id it last saw and drops its offline cache and write queue
when it changed, so a demo reseed never leaves stale taps to replay into the new data.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/system/dataset` | Returns `200` with `{ "datasetId": "..." }`. Anonymous, like ping, and sent with `Cache-Control: no-store, no-cache` so no proxy or browser cache can serve an old id. When no id is stored (first boot, or storage was wiped) one is minted, stored, and returned. Through the single-origin proxy, which strips one `/api`, it is `/api/api/system/dataset`. |
| `GET /api/system/version` | Returns `200` with `{ "sha": "...", "buildTime": "..." }` (#126): the git short SHA the API was built from and its UTC build time (`yyyy-MM-ddTHH:mm:ssZ`). Anonymous and `no-store`, like dataset. The build stamps them when it is given `/p:ButlerBuildSha` and `/p:ButlerBuildTime` (`Butler.Api.csproj` turns each into an `AssemblyMetadata` item only when set; the Dockerfile passes both from its `BUILD_SHA` build arg). An unstamped build answers `"sha": "dev"` and `"buildTime": null` instead of failing. `AssemblyBuildVersionProvider` (behind `IBuildVersionProvider`, a singleton) parses the metadata once: the SHA is trimmed, and the time is normalized to UTC or `null` when missing or unparseable. The hub's `VersionInfo` shows it next to its own build SHA. `BuildStampTests` (#226) builds the API with both properties into a temp folder and reads them back through `FromAssembly`, so dropping the csproj items fails the unit suite. |

- **Storage.** One row in the `Datasets` table (`DatasetEntity`): `PartitionKey = _system`,
  `RowKey = dataset`, with `DatasetId` (a `Guid` in `"N"` format) and `CreatedUtc` from the
  injected clock. This is a **documented exception to Engineering Contract 7.3**
  (`PartitionKey = householdId`): the id covers the whole deployment, not one household. The table
  is registered with `AddTableRepository` in `AddSystemFeature`, so it is provisioned at startup
  like every other table.
- **Service.** `IDatasetService` (`DatasetService`, a singleton) has `GetOrCreateAsync` (read, or
  add a new id when the row is missing) and `RegenerateAsync` (upsert a new id). One `SemaphoreSlim`
  serializes both, so concurrent first reads in one process agree on one id. A multi-instance race
  on the very first id is out of scope (the demo runs one API).
- **Reseed.** `DemoSeeder` calls `RegenerateAsync` on every seed, before it purges anything (see
  below). That covers both `POST /demo/seed` and `--seed-demo`.
- **The hub's contract.** The hub reads the id on startup, on every reconnect, and before every
  write-queue replay. A different id clears that household's glance cache and write queue and
  reloads the hub; an id it cannot read (unreachable API, a proxy `502`, a malformed body) changes
  nothing. See `Butler.UI/ARCHITECTURE.md`, "The dataset guard (D7)".

### Demo seeder (sample household)

`Demo` (`Application/Demo/`, `Infrastructure/Demo/`, `Controllers/DemoController`) seeds one demo
household for a live demo (#97). The script is static data in `DemoHousehold`; `DemoSeeder` turns it
into rows. The household always lives at the fixed id `demo-household`
(`IHouseholdService.CreateWithIdAsync`, which `CreateAsync` now delegates to with a generated id).

The seed runs in this order:

1. Refuse with `DemoSeedingNotAllowedException` unless the host is Development or Demo, before any
   I/O. `ApiExceptionHandler` maps it to `404`, so the endpoint looks absent rather than forbidden.
   Since #106 both triggers are already blocked outside those environments (see Triggers), so this
   check is defense in depth.
2. Read the injected clock once. Its ISO week is the current week; the three weeks before it hold
   the history.
3. Regenerate the dataset id (`IDatasetService.RegenerateAsync`, #100). It runs before the purge, so
   from the first deleted row onward any hub that reads the id sees a change and drops its cache
   and queued writes; regenerating after the seed would serve the old id over half-replaced data.
4. Purge the old household (`IDemoHouseholdPurger`), then create the household, rooms, people and
   chores through `IHouseholdService`, `IRoomService`, `IPersonService` and `IChoreService`. All four
   family members are participants; the organizer is the hidden roster row the household creates,
   because organizers never get chores and never count in fairness. That row carries the caller's
   object id so the caller can confirm the demo cart.
5. Write the history straight to `IChoreCompletionRepository`, because `ChoreCompletionService`
   stamps "now" and history must be back-dated. Each row is `StartOfWeekUtc(week)` plus a day per
   chore plus 18 hours, with the usual `{ticks}_{choreId}` row key. The history goes in before the
   current week is generated, so the engine's trailing loads include it.
6. Generate the current week through `IAssignmentGenerationService`, then complete three chores
   through `IChoreCompletionService` as whoever the engine assigned.
7. Add four exact catalog names to the cart through `ICaptureHandler`. Anything but `Added` throws.

**Replace, and the R-2 exception.** `DemoHouseholdPurger` lists and deletes the household's partition
(wildcard `If-Match`) in eight tables through the shared `IEntityRepository<T>` seam: Households,
People, Rooms, Chores, Assignments, ChoreCompletions, Carts and CartItems. Deleting completions breaks
the append-only ledger rule (BRD R-2) on purpose; it is a demo-only exception, and the services cannot
do this wipe anyway (the last organizer cannot be removed, chores only deactivate, and the ledger has
no delete). `HubDevices` is not purged, so a paired tablet survives a re-seed.

**Triggers.** `POST /demo/seed` (organizer-only) sends `SeedDemoHouseholdCommand`. For start-up,
`DemoCommandLine.Normalize` rewrites `--seed-demo` to `--Demo:SeedOnStartup=true` before
`WebApplication.CreateBuilder`, because the command-line provider would otherwise read the next
argument as the switch's value. `app.SeedDemoIfRequestedAsync()` runs just before `app.Run()` and
seeds as the dev organizer when `Demo:SeedOnStartup` is true. `DemoClockGuardTests` scans the
feature's IL for direct `DateTime.Now` / `UtcNow` reads.

**Guardrails outside Development and Demo (#106).** `DemoController` carries `[DemoOnly]`
(`Infrastructure/Hosting/DemoOnlyAttribute`). `AddDemoFeature(environment)` appends
`DemoOnlyControllerFeatureProvider` to the MVC application part manager, after the default
controller provider; in any other environment it removes every `[DemoOnly]` controller, so the
`/demo/*` routes are never mapped. With no endpoint, authorization never runs and every caller gets
`404`, with or without a token, and the routes drop out of Swagger. On start-up,
`SeedDemoIfRequestedAsync` checks the environment right after reading `Demo:SeedOnStartup` and
before provisioning any table; outside Development and Demo it throws
`DemoSeedingNotAllowedException.ForSeedOnStartup`, whose message names `Demo:SeedOnStartup`, and the
host fails to start (fail closed, like the `Authentication:DisableAuthentication` guard).
