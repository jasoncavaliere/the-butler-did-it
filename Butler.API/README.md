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

Only the organizer authenticates (Engineering Contract 7.4); participants and the shared hub device
never do (Epic 30). Endpoints that require an organizer carry
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
route is scoped under `/households/{householdId}/people`. Reads (`GET`, list and single) are open to the
hub device and participants so tap-to-claim (Epic 30) can render names; mutations (`POST`, `PUT`,
`DELETE`) require the `Organizer` authorization policy (Engineering Contract 7.4). Updates carry the
`If-Match` optimistic-concurrency precondition on the shared seam above (7.3) - missing it is `428`, a
stale value is `412`. An unknown `personId` is `404` RFC 7807 problem details on `GET`, `PUT`, and
`DELETE`. A household must always retain at least one organizer: a request that would demote or delete
the last remaining organizer is rejected with `400` RFC 7807 problem details and the row is left
unchanged. Persistence goes through `TablePersonRepository` (`IPersonRepository`), and the feature
registers via `AddPeopleFeature()` in `Program.cs`.

| Endpoint | Behavior |
| --- | --- |
| `POST /households/{householdId}/people` | Creates a person with a server-generated `personId`, the given `DisplayName`, `Role` (`Organizer` or `Participant`), `IsChild`, and `ClaimColor`. Returns `201` with the created person (including `ETag`) and a `Location` pointing at `GET .../people/{personId}`. |
| `GET /households/{householdId}/people` | Lists the household's people (open read - no organizer policy required, so the hub can render tap-to-claim tiles). |
| `GET /households/{householdId}/people/{personId}` | Returns the person (with its current `ETag`) for a known id, or `404` for an unknown one. |
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

Per the vision's modularity tenet, the API will eventually organize around the **household model** as
the shared spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on
top. The grocery integration sits behind a generic **store-connector** abstraction (HEB first) so stores
can be added without re-architecting. `Households`, `Rooms`, `People`, and `Chores` are the first of
these feature modules; the Epic 40 fair-assignment engine, groceries, and calendar have not been built
yet. The no-password tap-to-claim CLAIM action (Epic 30, T1) that lets participants pick their `People`
row on the hub is still out of scope here.
