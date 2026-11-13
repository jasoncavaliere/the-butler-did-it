---
type: Contract Clause
title: Engineering Contract 7.2 - Butler.API architecture (layered, MediatR, adopted from QControl)
description: The Butler.API request path (thin controller, MediatR handler, service, repository) and the feature-extension registration pattern.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.2 Butler.API architecture (layered, MediatR, adopted from QControl)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

Every request follows one path:

```
HTTP -> Controller (thin) -> MediatR command/query -> Handler -> Application Service -> Repository -> Azure Table/Blob/Queue
```

- `src/Butler.Api/Application/<Feature>/` - MediatR commands/queries + handlers, the feature's application service (orchestrator), and a `<Feature>ServiceCollectionExtensions.cs` exposing `Add<Feature>Feature()`.
- `src/Butler.Api/Infrastructure/<Feature>/` - Azure-backed repositories behind interfaces (`IChoreRepository` -> `TableChoreRepository`).
- `src/Butler.Api/Domain/<Feature>/` - domain/storage shapes (entities implement `ITableEntity` or map to one).
- `src/Butler.Api/Controllers/` - thin; endpoints mostly `_sender.Send(...)`.
- `src/Butler.Api/Mediation/` - pipeline behaviors (logging, validation, exception) and the RFC 7807 `ApiExceptionHandler`.
- `Program.cs` is the composition root: it wires each feature via its `Add<Feature>Feature()` extension. **To add a feature: create `Application/<Feature>/` + `Infrastructure/<Feature>/`, expose `Add<Feature>Feature()`, register it in `Program.cs`.**
- Central package management: versions live in `Directory.Packages.props`, not in `.csproj`. `Directory.Build.props` sets `net10.0`, `Nullable=enable`, `ImplicitUsings=enable`, analyzers on. SDK pinned by `global.json`.
