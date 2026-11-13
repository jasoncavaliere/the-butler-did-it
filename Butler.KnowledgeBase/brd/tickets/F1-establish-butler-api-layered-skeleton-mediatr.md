---
type: Ticket
title: "F1: Establish Butler.API layered skeleton (MediatR + feature-extension pattern)"
description: Turn the bare Butler.Api scaffold into the layered MediatR skeleton every feature plugs into (Contract 7.2).
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/3
tags: [epic:foundations, area:api, type:chore, priority:p0]
epic: ../10-epic-foundations.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F1: Establish Butler.API layered skeleton (MediatR + feature-extension pattern)

**Sub-service(s):** `Butler.API/`
**Blocked by:** none
**Serves:** FR-1

## Summary
Convert the bare `Butler.Api` scaffold into the layered, MediatR-based skeleton every feature will plug into, matching the QControl pattern in [Engineering Contract 7.2](../engineering-contract/72-api-architecture.md).

## Context
The composition-root + `Add<Feature>Feature()` convention is what lets later tickets add a feature by creating two folders and registering one extension. This ticket creates the skeleton and one trivial vertical slice (a `System` health/ping feature) to prove the path end to end. Remove the placeholder `/api/hello` record types from `Program.cs`.

## Acceptance Criteria
- [ ] `Directory.Build.props` sets `net10.0`, `Nullable=enable`, `ImplicitUsings=enable`, analyzers on; `global.json` pins the .NET 10 SDK; `Directory.Packages.props` centrally manages package versions.
- [ ] `MediatR` is referenced (central version) and registered in `Program.cs`.
- [ ] Folders exist and are used: `Application/`, `Infrastructure/`, `Domain/`, `Controllers/`, `Mediation/`.
- [ ] `Mediation/` contains an `ApiExceptionHandler` that maps unhandled exceptions and validation failures to RFC 7807 problem details, wired in `Program.cs`.
- [ ] A `System` feature exists as the reference vertical slice: `Application/System/` (a `PingQuery` + handler and an `AddSystemFeature()` extension) and a thin `Controllers/SystemController` (or minimal API) whose endpoint returns via `_sender.Send(...)`.
- [ ] `GET /health` returns `200` with `{ "status": "ok" }` (liveness preserved).
- [ ] The placeholder `/api/hello` and its `record` types are removed from `Program.cs`.
- [ ] Solution builds with `dotnet build --configuration Release /p:TreatWarningsAsErrors=true` (zero warnings).

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true` (no test project lands until F2, so state that unit tests arrive in F2).
- Add tests: none required here (F2 introduces the test project and back-tests the `PingQuery` handler).

## Risks & Rollback
- Low risk; scaffolding only. Rollback = revert the PR; the scaffold returns to the `/api/hello` placeholder.
