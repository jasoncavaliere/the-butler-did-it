# Butler.API

The backend service for Butler - the household concierge. A .NET 10 Web API hosted in Azure.

See the [product vision](../Butler.KnowledgeBase/docs/10-product-vision.md) for what Butler is and the
[v1 scope](../Butler.KnowledgeBase/docs/10-product-vision.md#what-we-are-not-building-in-v1).

## Layout

```
Butler.API/
├── Butler.API.sln
├── Directory.Build.props    solution-wide TFM/Nullable/ImplicitUsings/analyzer settings
├── Directory.Packages.props central package management - versions live here, not in .csproj
├── global.json               pins the .NET 10 SDK
├── src/
│   └── Butler.Api/          .NET 10 Web API (entry point: Program.cs)
│       ├── Controllers/      thin controllers - hand requests to MediatR via `_sender.Send(...)`
│       ├── Application/      one folder per feature (commands/queries + handlers + Add<Feature>Feature())
│       ├── Infrastructure/   one folder per feature (external I/O, storage, providers)
│       ├── Domain/           one folder per feature (entities/value types with no framework dependency)
│       └── Mediation/         cross-cutting MediatR wiring, incl. ApiExceptionHandler (RFC 7807)
│   └── Butler.Api.Tests/    xUnit + NSubstitute unit tests; coverlet enforces the 98% coverage gate
├── infra/
│   ├── main.bicep           Azure App Service (Linux) - parameter-driven, policy-agnostic
│   └── main.bicepparam      per-environment values (fill in before deploy)
└── .gitignore
```

## Develop

```bash
# from Butler.API/
dotnet restore
dotnet run --project src/Butler.Api      # serves on the URL in launchSettings.json
dotnet build                              # build the whole solution
dotnet build --configuration Release /p:TreatWarningsAsErrors=true  # CI gate - zero warnings
dotnet test                               # run xUnit suite (src/Butler.Api.Tests)
dotnet test /p:CollectCoverage=true       # + enforce the 98% coverage gate (Contract 7.7)
```

## Local session with Table Storage (Azurite)

Butler persists to Azure Table Storage, partitioned by `householdId` (Engineering
Contract 7.3). For a full local session against the real Table-backed
repositories, use the emulator (Azurite) instead of cloud storage:

```bash
# from Butler.API/ (needs PowerShell 7+ and Node.js for Azurite)
./Start-LocalSession.ps1        # starts repo-local Azurite + runs the API (Development)
./Start-LocalSession.ps1 -SkipAzurite   # Development run against the in-memory store only
```

`Start-LocalSession.ps1` starts Azurite with its data under a git-ignored
`.azurite/` folder, points the API at it via
`Storage__ConnectionString=UseDevelopmentStorage=true`, and runs the API in
Development (Swagger at `/swagger`). Install Azurite once with
`npm install -g azurite`; the script falls back to `npx azurite` if it is not on
`PATH`.

You do **not** need Azurite for a quick run or for tests. With no storage
configured, the API falls back to an in-memory seed store automatically, so
`dotnet run --project src/Butler.Api` and `dotnet test` work with nothing extra.
Storage is configured under the `Storage` section (or `Storage__*` environment
variables):

| Setting | Purpose |
| --- | --- |
| `Storage:ConnectionString` | Table Storage connection string (locally, Azurite's `UseDevelopmentStorage=true`). |
| `Storage:AccountName` | Storage account for the managed-identity path in deployed envs (endpoint derived as `https://<account>.table.core.windows.net`). |
| `Storage:TableServiceUri` | Explicit table service endpoint (overrides the derived one; e.g. sovereign clouds). |
| `Storage:UseInMemoryStore` | Explicit override: `true` forces the in-memory store, `false` forces real storage. Unset = in-memory only when no connection is configured. |

## Organizer authentication

Only the organizer authenticates with a real credential (Engineering Contract 7.4); the shared hub
device and participants never do (Epic 30) - see "Participant sessions (tap-to-claim)" below for how
they identify themselves instead. Endpoints that require an organizer carry
`[Authorize(Policy = OrganizerAuthorization.PolicyName)]` - `GET /me` (resolves the caller's subject and
display name) is the sample organizer-only endpoint that proves the seam end to end.

In deployed environments the API validates JWT bearer tokens issued by Entra External ID. Locally and in
CI (the Development environment), authentication is bypassed by default: every request is authenticated
as a deterministic dev organizer, so `dotnet run` and `dotnet test` need no live tenant. This bypass
fails closed everywhere else - a non-Development host refuses to start if authentication is disabled, or
if it is enabled but no authority is configured. Configure it under the `Authentication` section (or
`Authentication__*` environment variables):

| Setting | Purpose |
| --- | --- |
| `Authentication:Authority` | Entra External ID authority (issuer) that mints organizer tokens, e.g. `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0`. Required whenever authentication is enabled. |
| `Authentication:Audience` | Expected audience (the API's application/client id). Optional; when unset the audience is not validated. |
| `Authentication:DisableAuthentication` | Explicit override. Defaults to `true` in Development, refused (fail closed) in every other environment. Never set this outside Development. |

## Participant sessions (tap-to-claim)

Claiming a person at the hub (T1, Epic 30) mints a lightweight **participant session** - not an
organizer credential - scoped to exactly `(householdId, personId)`. It requires no password and no
organizer JWT, and it can never satisfy the `Organizer` policy: the default authentication scheme is a
forwarding scheme that routes a request carrying the `X-Participant-Session` header to the participant
scheme (so it authenticates as that person, but is `403 Forbidden` at any organizer-only endpoint) and
every other request to the organizer scheme.

- `POST /households/{householdId}/people/{personId}/claim` - see the People section below. The response
  includes an opaque `token`.
- Present that token on later requests via the `X-Participant-Session: <token>` header to identify the
  active participant (for example, the Epic 40 C4 chore-completion endpoint attributes a
  `ChoreCompletion` to the resulting `personId`).
- The token is intentionally opaque and unsigned - claiming itself is unauthenticated by design (Decision
  D-3), and no money moves in v1 (Decision D-8), so a forged token buys nothing beyond identifying a
  `personId` that already has no organizer authority.

## Hub device pairing

Pairing (T5, Engineering Contract 7.4) makes the shared tablet itself a long-lived actor - the "The
Hub" persona - rather than an anonymous caller. `POST /households/{householdId}/hub-devices/pair` is
organizer-only (the whole `HubDevicesController` carries the `Organizer` policy, since pairing is a
sensitive action): it writes a `HubDevices` row (`PartitionKey = householdId`, `RowKey = deviceId`)
stamped with `DeviceName`, `PairedUtc`, and `LastSeenUtc` from the injected clock, then returns a
long-lived, opaque device token scoped to exactly that `(householdId, deviceId)` pair.

Present the returned token on later requests via the `X-Device-Token` header to authenticate as the
paired device. Like a participant session, a device token can never satisfy the `Organizer` policy -
the default forwarding scheme routes a request carrying `X-Device-Token` to the device scheme (so it
authenticates as that device, but is `403 Forbidden` at any organizer-only endpoint), ahead of the
participant-session and organizer fallbacks. A successful authenticate refreshes the device's
`LastSeenUtc` from the clock seam; a token whose device row no longer exists (unpaired) authenticates
nobody. The token is intentionally opaque and unsigned, mirroring the participant session - its blast
radius is reads and completion writes for the single household it is scoped to, and no money moves in
v1 (Decision D-8).

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/hub-devices/pair` | Organizer-only. Pairs the current tablet, writing a `HubDevices` row with a server-generated `deviceId`. Returns `200` with `{ householdId, deviceId, deviceName, pairedUtc, token }`; `403` for a participant session or anonymous caller. |

## Deploy (Azure)

Infra is Bicep. Names and tags are fully parameterized so the template carries no naming policy of its
own - fill `infra/main.bicepparam` with values valid for the target subscription's Azure Policy before
deploying.

```bash
az deployment group create \
  --resource-group <rg> \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

## Architecture notes

The API is a layered, MediatR-based skeleton (Engineering Contract 7.2 in the BRD): `Program.cs` is the
composition root, and each feature plugs in by creating `Application/<Feature>/` (+
`Infrastructure/<Feature>/` and `Domain/<Feature>/` as needed), exposing an `Add<Feature>Feature()`
extension, and registering it in `Program.cs`. Controllers stay thin - they only call
`_sender.Send(...)` and return the result. Every unhandled exception or validation failure becomes an
RFC 7807 problem-details response via `Mediation/ApiExceptionHandler`.

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
`services.AddTableRepository<TEntity>("<TableName>")`; the flag picks in-memory vs Table automatically.

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
| `GET /households/{householdId}` | Returns the household (with its current `ETag`) for a known id, or `404` RFC 7807 problem details for an unknown one. |

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
| `POST /households/{householdId}/rooms` | Creates a room with a server-generated `roomId`, the given `Name` and `SortOrder`. Returns `201` with the created room (including `ETag`) and a `Location` pointing at `GET .../rooms/{roomId}`. |
| `GET /households/{householdId}/rooms` | Lists the household's rooms ordered ascending by `SortOrder` (ties broken by `roomId` for stable ordering). |
| `GET /households/{householdId}/rooms/{roomId}` | Returns the room (with its current `ETag`) for a known id, or `404` for an unknown one. |
| `PUT /households/{householdId}/rooms/{roomId}` | Updates `Name`/`SortOrder` under the `If-Match` precondition. Returns `200` with the updated room, `404` for an unknown room, `428` when `If-Match` is missing, or `412` when it is stale. |
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
| `POST /households/{householdId}/people` | Creates a person with a server-generated `personId`, the given `DisplayName`, `Role` (`Organizer` or `Participant`), `IsChild`, and `ClaimColor`. Returns `201` with the created person (including `ETag`) and a `Location` pointing at `GET .../people/{personId}`. |
| `GET /households/{householdId}/people` | Returns the claimable tap-to-claim roster: `{ personId, displayName, claimColor, isChild }` for every person in the household (open, unauthenticated read - no bearer token needed even when authentication is enabled). It never carries organizer-only fields such as `OrganizerObjectId`, nor `role`/`ETag`. |
| `GET /households/{householdId}/people/{personId}` | Returns the full person detail (with its current `ETag`) for a known id, or `404` for an unknown one (the organizer CRUD contract; open read). |
| `POST /households/{householdId}/people/{personId}/claim` | Tap-to-claim (T1): requires no password and no organizer JWT. Issues a participant session scoped to exactly `(householdId, personId)` - see "Participant sessions (tap-to-claim)" above. Returns `200` with `{ householdId, personId, displayName, claimColor, isChild, token }`, or `404` RFC 7807 problem details for an unknown `personId` or `householdId`. |
| `PUT /households/{householdId}/people/{personId}` | Updates `DisplayName`/`Role`/`IsChild`/`ClaimColor` under the `If-Match` precondition. Returns `200` with the updated person, `404` for an unknown person, `428` when `If-Match` is missing, `412` when it is stale, or `400` when the change would demote the household's last organizer. |
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
| `POST /households/{householdId}/chores` | Creates a chore with a server-generated `choreId`, the given `Title`, `RoomId`, `Cadence` (`Daily` or `Weekly`), `Effort`, and `MinAge` (nullable). `Active` defaults to `true`. Returns `201` with the created chore (including `ETag`) and a `Location` pointing at `GET .../chores/{choreId}`, `400` for an unknown `RoomId` or non-positive `Effort`. |
| `GET /households/{householdId}/chores` | Lists the household's chores, optionally filtered with `?active=true`/`?active=false` (open read). |
| `GET /households/{householdId}/chores/{choreId}` | Returns the chore (with its current `ETag`) for a known id, or `404` for an unknown one. |
| `PUT /households/{householdId}/chores/{choreId}` | Updates `Title`/`RoomId`/`Cadence`/`Effort`/`MinAge`/`Active` under the `If-Match` precondition. Returns `200` with the updated chore, `404` for an unknown chore, `400` for an unknown `RoomId` or non-positive `Effort`, `428` when `If-Match` is missing, or `412` when it is stale. |
| `POST /households/{householdId}/chores/{choreId}/deactivate` | Sets `Active = false` and retains the row. Returns `200` with the updated chore, or `404` for an unknown chore. |

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
  person's trailing-4-ISO-week completed `Effort` from `ChoreCompletions`, resolves `weekIso` from the
  request or the injected clock, runs the C2 engine, and persists the result via the C1 repositories.
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
  a **compensating** `ChoreCompletion` of `-effort` for the acting `personId` - the ledger stays
  append-only (BRD R-2: the original entry is never touched or deleted), and net effort nets back to the
  pre-completion value for the C3 trailing-load read. Undoing an assignment that is already `Open` (or
  was never completed) is a success no-op - no compensating entry is appended, so effort is never
  double-subtracted.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/assignments/generate` | Generates or regenerates the household's assignments for a week. Accepts an optional JSON body `{ "weekIso": "2026-W29" }`; an empty body (or an omitted `weekIso`) computes the current week from the injected clock. **Regenerate is idempotent:** re-running it for a week that already has assignments replaces only `Open` rows - `Done` assignments and their `ChoreCompletions` are preserved untouched, and their effort is folded into the recomputed trailing loads so a completed chore is never reassigned. Returns `200` with an `AssignmentSetResponse` (`weekIso`, the placed `assignments` - `choreId`, `assignedPersonId`, `effort`, `status`, ordered by `choreId` - and any `unassigned` chores with their reason code, also ordered by `choreId`), or `404` RFC 7807 problem details for an unknown `householdId`. Requires the `OrganizerOrHubDevice` authorization policy - an `Organizer` JWT (or the dev bypass) or a paired hub device token may call it; a plain participant session cannot (`403`). |
| `POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete` | Completes an assignment from a tap (C4, journey 6.2): appends a `ChoreCompletion` and sets the matching `Assignment.Status` to `Done` under optimistic concurrency. Completion is **not** a sensitive action (Decision D-3), so any authenticated caller may drive it - a tap-to-claim participant session (T1) or a paired hub device (T5) - with no `Organizer` policy required. Accepts an optional JSON body `{ "personId": "..." }`: a participant session attributes the completion to its own `personId` and may omit the body entirely; a hub device or organizer must supply the acting `personId` (the UI's active participant, T3) or the call is `400`. A second complete of an already-`Done` assignment is an idempotent success, not an error. Returns `200` with the completed assignment's `weekIso`, `choreId`, `assignedPersonId`, and `status`, or `404` RFC 7807 problem details when no assignment matches `(householdId, weekIso, choreId)`. |
| `POST /households/{householdId}/assignments/{weekIso}/{choreId}/undo` | Reverses a completion from a tap (C7, follows up C5): flips the matching `Assignment.Status` back to `Open` under optimistic concurrency and backs out the credited effort with a compensating append-only `ChoreCompletion` (the ledger is never deleted from). Authorization and actor resolution mirror `complete` exactly - any authenticated caller, same optional `{ "personId": "..." }` body rule, `400` with no resolvable actor. Undoing an already-`Open` (or never-completed) assignment is an idempotent success, not an error. Returns `200` with the reopened assignment's `weekIso`, `choreId`, `assignedPersonId`, and `status` (always `Open`), or `404` RFC 7807 problem details when no assignment matches `(householdId, weekIso, choreId)`. |

### Fairness (contribution balance)

`Fairness` (`Application/Fairness/`, `Controllers/FairnessController`) is the Epic 40 C6 read model
behind journey 6.3's fairness view and the Section 10 fairness guardrail (the top contributor's share
of completed chores trending down over time). It is a pure aggregate over data C4 already writes and
introduces no new table, repository, or write path: `IFairnessService.GetAsync(...)` scans only the
household's `ChoreCompletions` partition (`PartitionKey = householdId`, 7.3 - no cross-household query),
buckets each completion into a trailing ISO-week window anchored to the injected clock's current week
(same `WeekIso` helper the assignment pipeline shares, 7.5), sums `Effort` per person, and joins display
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
stamps every result `SourceConnector = "simulated-heb"`. The feature registers via
`AddStoreConnectorFeature()` in `Program.cs`, binding `IStoreConnector` to a singleton
`SimulatedHebConnector`. There is no controller yet - the seam has no HTTP surface until the cart (G2),
capture (G3), and confirm (G4) tickets build on it.

Per the vision's modularity tenet, the API will eventually organize around the **household model** as
the shared spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on
top. `Households`, `Rooms`, `People`, and `Chores` are the first of these feature modules, and
tap-to-claim (Epic 30, T1 - see "Participant sessions (tap-to-claim)" above) is the first piece of the
participant identity model; the Epic 40 fair-assignment engine now has its generate/regenerate endpoint
(C1-C3), its chore-completion endpoint (C4), its tap-to-undo endpoint (C7), and its read-only fairness
view (C6, above); Epic 50 groceries has its store-connector seam (G1, above) but no cart, capture, or
confirm endpoints yet, and calendar has not been built yet.
