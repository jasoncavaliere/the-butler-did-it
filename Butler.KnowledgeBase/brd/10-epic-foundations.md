# Epic 10 - Foundations & Delivery Rails

**Goal:** stand up the architecture skeleton, storage, auth seam, test harness, and CI so every later ticket is implementable and its gates are real. Butler today is bare scaffolds (`Butler.API/src/Butler.Api` is just `Program.cs`; `Butler.UI` is a bare Expo app; no test projects; no CI). This epic fixes that, mirroring the QControl house style documented in [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section).

**Serves:** FR-1, BO-6, and (as a dependency) all other objectives.
**Lands first.** Everything else is `Blocked by` this epic.

Each ticket below is a ready-to-file GitHub issue. File per [brd/README.md](README.md). Replace `#<Fn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](00-brd-master.md#7-engineering-contract-the-anti-halt-section) as binding and does not restate it.

---

## F1: Establish Butler.API layered skeleton (MediatR + feature-extension pattern)

**Labels:** `epic:foundations` `area:api` `type:chore` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** none
**Serves:** FR-1

## Summary
Convert the bare `Butler.Api` scaffold into the layered, MediatR-based skeleton every feature will plug into, matching the QControl pattern in [Engineering Contract 7.2](00-brd-master.md#72-butlerapi-architecture-layered-mediatr-adopted-from-qcontrol).

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

---

## F2: Butler.API test harness (xUnit + NSubstitute)

**Labels:** `epic:foundations` `area:api` `type:test` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`)
**Serves:** FR-1 (makes `dotnet test` a real gate)

## Summary
Create the `Butler.Api.Tests` project (xUnit + NSubstitute, centrally versioned) so `dotnet test` is a real gate for every later ticket, and back-test the F1 `PingQuery` handler.

## Context
`/implement-issue` Phase 2 detects gates and Phase 4 runs them. Without a test project, "unit tests pass" is a silent skip. This ticket makes the gate real and sets the test conventions (Arrange/Act/Assert, NSubstitute for fakes) later tickets follow.

## Acceptance Criteria
- [ ] `src/Butler.Api.Tests/Butler.Api.Tests.csproj` exists (net10.0), references the API project, and is added to `Butler.API.sln`.
- [ ] `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk`, and `NSubstitute` are referenced via `Directory.Packages.props`.
- [ ] At least one passing test exercises the F1 `PingQuery` handler (real handler, no HTTP).
- [ ] `dotnet test` from `Butler.API/` discovers and runs the suite green.
- [ ] Test build honors `TreatWarningsAsErrors` (matches CI in F5).
- [ ] Coverage tooling is wired: `coverlet.collector` (and/or `coverlet.msbuild`, centrally versioned) collects line, branch, and method coverage on `dotnet test` and emits a report (for example Cobertura).
- [ ] The 98 percent coverage gate from [Engineering Contract 7.7](00-brd-master.md#77-testing-and-definition-of-done-what-makes-a-tickets-ac-verifiable) is enforced locally: `dotnet test` fails when line, branch, or method coverage is below 98 percent (for example `/p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`). Any exclusion is explicit, minimal, and justified in the coverage config - never a blanket ignore.

## Testing
- Gates: `cd Butler.API && dotnet test /p:CollectCoverage=true /p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`.
- Add tests: `PingQueryHandlerTests` (green). Because coverage is enforced from here on, the F1 `System` slice must be fully covered by this ticket.

## Risks & Rollback
- Low; test-only project. Rollback = revert the PR.

---

## F3: Azure Table Storage access layer + Azurite local development

**Labels:** `epic:foundations` `area:api` `area:infra` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-1, BO-6

## Summary
Provide the shared Table Storage access seam (a table-client factory + a generic repository base with optimistic-concurrency helpers) and a local dev path against Azurite, so every data feature (H1+, C1+, G1+) has a consistent, tested persistence base.

## Context
Implements [Engineering Contract 7.3](00-brd-master.md#73-data-model-azure-table-storage---partition-key-is-always-householdid). `householdId` is the partition key everywhere. Mirrors QControl's `Azure.Data.Tables` repositories + Azurite + seed-fallback so the API runs with no cloud storage.

## Acceptance Criteria
- [ ] `Azure.Data.Tables` and `Azure.Identity` are referenced (central versions).
- [ ] A `TableClientFactory` (or equivalent seam) resolves a `TableClient` per table name from configuration; connection is configurable (connection string locally, managed identity in deployed envs).
- [ ] A shared repository base or helper provides: entity CRUD scoped by `PartitionKey = householdId`, and optimistic concurrency (`ETag` on read; `If-Match` on update -> `428` when missing, `412` when stale) via a reusable helper under `Application/Concurrency/`.
- [ ] A `Start-LocalSession.ps1` (or documented equivalent) starts repo-local Azurite and runs the API in Development; README documents it.
- [ ] A configuration flag lets the API fall back to an in-memory/seed store when no storage is configured (so local runs and tests need no Azurite).
- [ ] Unit tests cover the concurrency helper (missing `If-Match` -> `428`, stale -> `412`, match -> success) using an in-memory/faked table client.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `OptimisticConcurrencyTests`, `TableClientFactoryTests` (config resolution).

## Risks & Rollback
- R: an over-abstracted base slows later tickets. Mitigation: keep the base minimal (CRUD + concurrency only). Rollback = revert; later data tickets would then each wire their own client (undesirable) so land this before H1.

---

## F4: Butler.UI app structure + component test harness

**Labels:** `epic:foundations` `area:ui` `type:chore` `priority:p0`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** none
**Serves:** FR-1

## Summary
Give the bare Expo app a real structure (`src/` with screens/components/state/api layers), navigation, a typed config, and a React Native test runner (jest-expo) with one passing component test, plus `lint`/`typecheck`/`test` npm scripts and a `ci:verify` aggregate.

## Context
The UI is web-first (Expo web export -> Azure Static Web App). Read the exact versioned Expo 57 docs before writing code (`Butler.UI/AGENTS.md`). This ticket sets the conventions later UI tickets (H5, T2, T3, C5, G5, O*) follow and makes `npm test`/`npm run typecheck`/`npm run lint` real gates.

## Acceptance Criteria
- [ ] A `src/` structure exists with clear folders (for example `src/screens`, `src/components`, `src/api`, `src/state`) and `App.tsx` renders a placeholder Home screen from `src/`.
- [ ] Navigation is wired (Expo Router or React Navigation - author's choice, documented) with at least a Home route.
- [ ] `jest-expo` (or the Expo-recommended RN test runner) is configured; one component test renders the Home screen and asserts visible text; `npm test` passes.
- [ ] `npm run lint`, `npm run typecheck` (or `tsc --noEmit`), and `npm test` scripts exist and pass; `npm run ci:verify` runs all three.
- [ ] A `npm run test:coverage` script collects coverage, and the jest config sets `coverageThreshold.global` to 98 for `statements`, `branches`, `functions`, and `lines`; the command fails below 98 percent. `npm run ci:verify` runs the coverage-gated test (so the 98 percent bar from [Engineering Contract 7.7](00-brd-master.md#77-testing-and-definition-of-done-what-makes-a-tickets-ac-verifiable) is enforced). Any exclusion (`coveragePathIgnorePatterns`) is explicit, minimal, and justified.
- [ ] `npx expo export --platform web` produces a `dist/` build with no errors.
- [ ] A typed API base config (base URL from env, dev default `http://localhost:5108`) exists for later tickets to build on.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web` (ci:verify includes `test:coverage` at the 98 percent global threshold).
- Add tests: `HomeScreen.test.tsx`. The Home screen and any code added here must be fully covered so the 98 percent global threshold holds from the first UI ticket.

## Risks & Rollback
- R: Expo 57 API drift. Mitigation: follow the versioned docs per `AGENTS.md`. Rollback = revert; scaffold returns to bare `App.tsx`.

---

## F5: CI workflows for API and UI (GitHub Actions)

**Labels:** `epic:foundations` `area:infra` `type:chore` `priority:p0`
**Sub-service(s):** `Butler.API/`, `Butler.UI/` (workflow files only)
**Blocked by:** F2 (`#<F2>`), F4 (`#<F4>`)
**Serves:** FR-1

## Summary
Add GitHub Actions so the gates the tickets name actually run on every PR: the API builds+tests with warnings-as-errors, and the UI lints, typechecks, tests, and web-exports.

## Context
`/merge-issue` waits on pre-merge CI checks to go green. Those checks must exist. Two independent jobs (paths-filtered) because the two sub-services have separate toolchains and no root build.

## Acceptance Criteria
- [ ] `.github/workflows/api-ci.yml` runs on PRs touching `Butler.API/**`: `dotnet restore`, `dotnet build --configuration Release /p:TreatWarningsAsErrors=true`, and a coverage-gated `dotnet test` (`/p:CollectCoverage=true /p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`).
- [ ] `.github/workflows/ui-ci.yml` runs on PRs touching `Butler.UI/**`: `npm ci`, `npm run ci:verify` (which runs the coverage-gated test at the 98 percent global threshold), `npx expo export --platform web`.
- [ ] The 98 percent coverage gate from [Engineering Contract 7.7](00-brd-master.md#77-testing-and-definition-of-done-what-makes-a-tickets-ac-verifiable) fails the CI check in both sub-services when coverage on lines, methods, or branches drops below 98 percent (verified by a deliberately-undercovered change failing the check, then reverted).
- [ ] Both workflows pin the toolchain versions (.NET 10 via `global.json`; Node LTS).
- [ ] Both are required-check-eligible (named, appear on PRs) and pass on the current `main` after F1-F4 land.
- [ ] A short `CONTRIBUTING`/README note documents the local commands that mirror CI.

## Testing
- Gates: the workflows themselves are the gate; validate by opening the PR and confirming both checks run and pass.
- Add tests: none (CI config).

## Risks & Rollback
- R: flaky first run. Mitigation: keep jobs minimal and deterministic. Rollback = revert workflow files.

---

## F6: Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass)

**Labels:** `epic:foundations` `area:api` `type:feature` `priority:p0`
**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-1, FR-3

## Summary
Wire JWT bearer authentication (Entra External ID as the issuer) and an `Organizer` authorization policy, with a `DisableAuthentication` dev mode so local + CI need no live tenant. Add a `GET /me` endpoint resolving the caller.

## Context
Implements [Engineering Contract 7.4](00-brd-master.md#74-authentication-and-authorization). Only the organizer authenticates; participants never do (that is Epic 30). Non-Development environments must fail closed when auth is misconfigured.

## Acceptance Criteria
- [ ] `Microsoft.AspNetCore.Authentication.JwtBearer` is referenced and configured for an Entra External ID authority (values from config; no secrets committed).
- [ ] An `Organizer` authorization policy is registered; a sample protected endpoint requires it.
- [ ] `Authentication:DisableAuthentication=true` (default in Development + CI) makes the policy permissive and injects a deterministic dev organizer principal; any non-Development environment with auth disabled or misconfigured fails closed (startup error or `401`/`403`).
- [ ] `GET /me` returns the resolved caller (dev organizer in dev mode; token subject otherwise).
- [ ] Tests cover: protected endpoint returns success in dev mode, and the policy denies an unauthenticated caller when auth is enabled (using test config).
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `OrganizerPolicyTests`, `DevModeAuthTests`.

## Risks & Rollback
- R-1 (BRD): a misconfigured bypass leaks to prod. Mitigation: fail-closed test above is an AC. Rollback = revert; endpoints revert to open (acceptable only pre-launch).

---

## F7: UI API client + household context provider

**Labels:** `epic:foundations` `area:ui` `type:feature` `priority:p1`
**Sub-service(s):** `Butler.UI/`
**Blocked by:** F3 (`#<F3>`), F4 (`#<F4>`)
**Serves:** FR-1, FR-2

## Summary
Provide a typed fetch client (base URL, error handling to a common shape, `If-Match`/`ETag` passthrough) and a `HouseholdContext` React provider that holds the current `householdId` and exposes it to screens, so later UI tickets do not each reinvent data access.

## Context
Sets the UI data-access convention. Offline behavior is layered on in Epic 60 (this client exposes the seam an offline queue will wrap). No network calls to real endpoints are required yet - the client is validated against the F1 `System`/`/me` endpoints or mocked.

## Acceptance Criteria
- [ ] A typed API client wraps fetch: injects base URL, sets JSON headers, surfaces `ETag` on reads and sends `If-Match` on updates, and normalizes errors (including RFC 7807 problem details) to a common result type.
- [ ] A `HouseholdContext` provider exposes the current `householdId` and a setter; a hook (`useHousehold`) reads it.
- [ ] The Home screen consumes the client to show a health/`/me` value (proves the wiring), with a graceful state when the API is unreachable.
- [ ] Unit tests cover the client (header injection, error normalization) with a mocked fetch, and the context hook.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests: `apiClient.test.ts`, `useHousehold.test.tsx`.

## Risks & Rollback
- Low. Rollback = revert; later UI tickets would then wire their own fetch (undesirable), so land before H5.
