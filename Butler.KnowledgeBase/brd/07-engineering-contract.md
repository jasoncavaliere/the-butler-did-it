---
name:          brd-07-engineering-contract
title:         Butler v1 Engineering Contract (BRD Section 7)
category:      Product & Strategy
lifecycle:     Living
owner:         engineering
last-reviewed: 2026-11-13
audience:      Engineers, reviewers, and the agents that implement these tickets
source:        Butler.KnowledgeBase/brd/00-brd-master.md
keywords:      [engineering contract, mediatr, table storage, householdId, entra external id, rfc 7807, optimistic concurrency, fair assignment, coverage gate, definition of done]
---

# Butler v1 - Engineering Contract (BRD Section 7)

> **Binding for every ticket.** Split out of the [master BRD](00-brd-master.md) so implementing agents can read the contract without the product sections. Section numbers (7.1-7.7) are unchanged.

## 7. Engineering Contract (the anti-halt section)

**This section is the reason the tickets can be implemented unattended.** Every epic ticket references it instead of restating it, and treats it as binding. It encodes the QControl house style (the org's proven .NET pattern) applied to Butler.

### 7.1 Repository and toolchains

- One git repo: `the-butler-did-it`. Two sub-services with independent toolchains and no root build:
  - `Butler.API/` - .NET 10 Web API (`Butler.API.sln` -> `src/Butler.Api`). Gates: `dotnet build` and `dotnet test`, both with `/p:TreatWarningsAsErrors=true`. The test gate includes the 98 percent coverage threshold (Section 7.7).
  - `Butler.UI/` - Expo 57 / React 19 / react-native-web (web-first). Gates: `npm run lint`, `npm run typecheck` (or `tsc --noEmit`), `npm test`, and `npx expo export --platform web` must succeed. The test gate includes the 98 percent coverage threshold (Section 7.7).
- A ticket names exactly which sub-service(s) it touches and which of the above gates apply. A gate that does not yet exist in a sub-service is a stated fact, never a silent skip (Foundations creates them; see Epic 10).

### 7.2 Butler.API architecture (layered, MediatR, adopted from QControl)

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

### 7.3 Data model (Azure Table Storage - partition key is always `householdId`)

Tables (PartitionKey / RowKey), all in one storage account:

| Table | PartitionKey | RowKey | Key fields |
| --- | --- | --- | --- |
| `Households` | `householdId` | `householdId` | Name, OrganizerObjectId, CreatedUtc |
| `Rooms` | `householdId` | `roomId` | Name, SortOrder |
| `People` | `householdId` | `personId` | DisplayName, Role (`Organizer`/`Participant`), IsChild, ClaimColor, OrganizerObjectId (organizer only) |
| `Chores` | `householdId` | `choreId` | Title, RoomId, Cadence (`Daily`/`Weekly`), Effort (int), MinAge (nullable), Active |
| `Assignments` | `householdId` | `{weekIso}_{choreId}` | AssignedPersonId, WeekIso, DueDateUtc, Status (`Open`/`Done`) |
| `ChoreCompletions` | `householdId` | `{completedUtcTicks}_{choreId}` | ChoreId, PersonId, CompletedUtc, Effort, WeekIso |
| `Carts` | `householdId` | `{weekIso}` | Status (`Building`/`Confirmed`), ConfirmedByPersonId, ConfirmedUtc |
| `CartItems` | `householdId` | `{cartWeekIso}_{itemId}` | ProductId, DisplayName, Quantity, AddedByPersonId, SourceConnector |
| `HubDevices` | `householdId` | `deviceId` | DeviceName, PairedUtc, LastSeenUtc |

Rules:
- `householdId` scopes every read and write. No cross-household query exists in the product hot path.
- Mutable content uses optimistic concurrency: reads return `ETag`, updates require `If-Match` (`428` if missing, `412` if stale). Shared helper lives in Foundations.
- A `SeedData/` fallback + Azurite let the API run locally with no cloud storage (mirrors QControl's strategy pattern).
- `weekIso` is the ISO-8601 year-week string (for example `2026-W29`), computed server-side from a supplied or current date. Deterministic; never `DateTime.Now` inside a handler without injection.

### 7.4 Authentication and authorization

- **Organizer:** Entra External ID -> JWT bearer (`Microsoft.AspNetCore.Authentication.JwtBearer`). The organizer's object id maps to a `People` row with role `Organizer`.
- **`Organizer` policy:** endpoints that mutate the household structure, pair devices, or confirm a cart carry `[Authorize(Policy = "Organizer")]`.
- **Dev mode:** `Authentication:DisableAuthentication=true` (Development + CI default) makes the policy permissive so local runs and tests need no live tenant. Non-Development environments fail closed.
- **Participants and the hub device** are never authenticated as users. The hub presents a paired device/household token to read the household and record completions; sensitive actions still require an organizer JWT.

### 7.5 Cross-cutting conventions (binding for every ticket)

- Errors are RFC 7807 problem details via the shared `ApiExceptionHandler`.
- Input validation returns `400` with problem details; missing `If-Match` returns `428`; stale returns `412`; unknown household/entity returns `404`.
- Time and randomness are injected (a `TimeProvider`/clock and any RNG), so handlers and the assignment engine are deterministically testable.
- No secrets in source or `appsettings.json` committed values; use user-secrets locally, Key Vault in deployed envs.
- ASCII-only in this knowledge base (no em dashes, curly quotes, or ellipsis characters) - the KB scorer hard-fails them.

### 7.6 The v1 fair-assignment algorithm (deterministic, specified so nobody guesses)

Given a household's active chores for a week and its eligible people:

1. **Eligibility:** a person is eligible for a chore if `IsChild == false`, or the chore's `MinAge` is null, or the person is a child but the chore is flagged child-safe (`MinAge` null or a child-eligible cadence). v1 rule: children are eligible only for chores with `MinAge == null`.
2. **Load:** each person's running load = sum of `Effort` of their `ChoreCompletions` over the trailing 4 weeks, plus effort already assigned this week.
3. **Assignment:** process chores in descending `Effort`, then by `choreId` for stability. Assign each chore to the eligible person with the lowest current load; break ties by fewest chores assigned this week, then by `personId`. Add the chore's effort to that person's load.
4. **Determinism:** same inputs always produce the same assignment set. This is a pure function, unit-tested with fixed inputs. No ML, no learning, no external calls.

### 7.7 Testing and Definition of Done (what makes a ticket's AC verifiable)

A ticket is done when, in each sub-service it touches:

- New or changed behavior has automated tests that exercise it (name them in the PR). API: xUnit + NSubstitute in `src/Butler.Api.Tests`. UI: the Foundations-chosen RN test runner (jest-expo) in `Butler.UI`.
- **Code coverage is a hard gate: at least 98 percent on lines (files), methods, and branches**, enforced by the build and CI in each sub-service - the build fails below 98 percent, so a PR that lowers coverage under the bar cannot merge. API: coverlet threshold (`/p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`). UI: jest `coverageThreshold.global` set to 98 for `statements`, `branches`, `functions`, and `lines`. The bar is met by writing tests, never by deleting them; any coverage exclusion must be explicit, minimal, and justified in the coverage config (for example generated code or the `Program.cs` bootstrap), not a blanket ignore.
- All applicable gates in 7.1 pass locally and in CI.
- No unrelated files changed; no new `TODO`/`FIXME` without a linked follow-up issue.
- The independent reviewer agent returns `VERDICT: 👍` (implement-issue Phase 4.5).

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD (problem, scope, journeys, traceability); this file is its Section 7.
- [brd/README.md](README.md) - epic index, label taxonomy, dependency order.
- [ticket-issue-map.md](ticket-issue-map.md) - ticket ID to GitHub issue crosswalk.
