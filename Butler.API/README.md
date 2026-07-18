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
dotnet test                               # (no test project yet - add src/Butler.Api.Tests)
```

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

Per the vision's modularity tenet, the API will eventually organize around the **household model** as
the shared spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on
top. The grocery integration sits behind a generic **store-connector** abstraction (HEB first) so stores
can be added without re-architecting. These feature modules do not exist yet - only the scaffold and the
`System` reference slice do.
