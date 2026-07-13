# Butler.API

The backend service for Butler - the household concierge. A .NET 9 Web API hosted in Azure.

See the [product vision](../Butler.KnowledgeBase/docs/10-product-vision.md) for what Butler is and the
[v1 scope](../Butler.KnowledgeBase/docs/10-product-vision.md#what-we-are-not-building-in-v1).

## Layout

```
Butler.API/
├── Butler.API.sln
├── src/
│   └── Butler.Api/          .NET 9 Web API (entry point: Program.cs)
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

Per the vision's modularity tenet, the API is organized around the **household model** as the shared
spine (rooms, people, chores), with each capability (chores, groceries, ...) composing on top. The
grocery integration sits behind a generic **store-connector** abstraction (HEB first) so stores can be
added without re-architecting. These modules do not exist yet - this is the scaffold.
