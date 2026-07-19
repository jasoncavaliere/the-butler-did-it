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
outside the MediatR pipeline.

Persistence is a shared seam (Engineering Contract 7.3), not per-feature wiring. `Infrastructure/Storage/`
holds an `ITableClientFactory` that resolves an `Azure.Data.Tables` `TableClient` per table name from the
`Storage` config (connection string locally, managed identity via `DefaultAzureCredential` in deployed
envs), plus an `IEntityRepository<TEntity>` base with two implementations - a Table-backed one and an
in-memory seed/fallback one - both scoping every read and write to `PartitionKey = householdId` and
sharing the optimistic-concurrency rules in `Application/Concurrency/` (`If-Match` required -> `428` when
missing, `412` when stale). A feature registers its table with
`services.AddTableRepository<TEntity>("<TableName>")`; the flag picks in-memory vs Table automatically.

Per the vision's modularity tenet, the API will eventually organize around the **household model** as
the shared spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on
top. The grocery integration sits behind a generic **store-connector** abstraction (HEB first) so stores
can be added without re-architecting. These feature modules do not exist yet - only the scaffold and the
`System` reference slice do.
