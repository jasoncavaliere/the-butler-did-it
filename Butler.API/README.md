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

Layered + MediatR: `Program.cs` composition root -> `Controllers/` (thin) -> `Application/<Feature>/` (command/query + handler + service + `Add<Feature>Feature()`) -> `Infrastructure/<Feature>/` (Table Storage repository). Per-feature notes (Households, Rooms, People, Chores, Assignments, Fairness, Grocery, Carts, Capture) are in [ARCHITECTURE.md](ARCHITECTURE.md).
