---
name:          brd-00-master
title:         Butler v1 Business Requirements Document (Master)
category:      Product & Strategy
lifecycle:     Living
owner:         product
last-reviewed: 2026-07-14
audience:      Product, engineering, reviewers, and the agents that implement these tickets
source:        Butler.KnowledgeBase/docs/10-product-vision.md
keywords:      [brd, v1, requirements, household model, chores, fair assignment, grocery, store connector, hub, tap-to-claim, offline, pwa, table storage, mediatr, entra external id, acceptance criteria]
---

# Butler v1 - Business Requirements Document (Master)

> **In one line:** Turn the [Product Vision](../docs/10-product-vision.md) into a build - a shared kitchen-tablet hub that fairly divides the household's work, models the home, and does one real grocery run, shipped as tickets an autonomous engineer can implement without guessing.

This is the master BRD. It defines the business problem, the v1 scope, the requirements, the data model, and - critically - the **engineering contract** that every epic ticket depends on. Read this once, then each epic file (`10-` through `60-`) turns these requirements into ready-to-file GitHub issue specs.

This document is downstream of the [Product Vision](../docs/10-product-vision.md). Where the vision argues *why*, this BRD specifies *what* and *how it is verified*. If the two ever disagree, the vision wins and this file is wrong - fix it here.

## How to read this BRD

| You are... | Read |
| --- | --- |
| **Product / leadership** | Sections 1-6 (problem, objectives, scope, personas, journeys, metrics). |
| **Engineer / implementing agent** | Section 7 (Engineering Contract) then your epic file. Section 7 is what keeps a ticket from halting. |
| **Reviewer** | Section 7 (the conventions you are reviewing against) and Section 8 (traceability - does this ticket serve a real requirement). |
| **Filing tickets into GitHub** | `brd/README.md` - the label taxonomy, the dependency order, and the `gh issue create` recipe. |

---

## 1. Problem statement

Running a home is real labor that mostly no one counts, and the counting falls hardest on one person. The [Product Vision](../docs/10-product-vision.md#the-problem-invisible-unfair-unautomated) quantifies it; the short version is three compounding failures:

1. **The mental load sits on one person.** Mothers manage about 71 percent of household cognitive tasks, fathers about 45 percent (Weeks and Ruppanner, 2024).
2. **The work is invisible, so it feels unfair.** No one agrees on who does how much because no one is counting. Resentment grows in the gap.
3. **Home logistics are fragmented.** Chores live in someone's head, the list on the fridge, reminders in texts, the calendar somewhere else. Nothing connects, so nothing can be automated.

Existing family apps fail to fix this because they require every family member to download, log in, and open an app they do not care about. Teens and reluctant partners never do, so the app dies.

## 2. Product opportunity and vision (v1)

**Butler v1 is a shared, always-on kitchen-tablet hub that makes the household's work visible, fair, and partly automated - with no login for participants.** It ships as a web app and installable PWA on a tablet the family already owns.

v1 proves one loop end to end:

- **Glance** at what is happening today on the shared hub (the daily pull habit).
- **Claim and complete** what is yours by tapping your name - no password.
- **See it is fair** - the distribution of completed chores trends toward balance.
- **Get one real thing done** - a grocery item captured by voice or tap flows into a cart that a human confirms.

Everything in v1 exists to prove that loop is real, cheap to run, and sticky. The durable retention curve is a v1.1 story (calendar joins the glance); v1's job is to prove the loop and the economics.

## 3. Business objectives and how v1 serves them

| # | Business objective (from the vision) | How v1 serves it | Guardrail metric |
| --- | --- | --- | --- |
| BO-1 | Win the family with a fair, visible chore habit (the wedge). | Chore mapping + a deterministic fair-assignment engine + a tap-to-complete hub board. | Top contributor's share of completed chores falls over time. |
| BO-2 | Become the system of record for the home (the durable moat). | The household model (rooms -> people -> chores -> assignments -> completions) is the spine every capability reads and writes. | Household model populated (rooms + people + chores) for an onboarded household. |
| BO-3 | Prove Butler does work, not just tracks it (the demonstrable moat). | One demoable assisted-cart grocery flow behind a real store-connector seam. | At least one cart confirmed per active household per month. |
| BO-4 | Make whole-family participation ambient (multiplayer is the game). | Shared hub + no-password tap-to-claim; organizer holds the only real credentials. | Distinct participants active on the hub per household per week > 1. |
| BO-5 | Keep the daily habit a pull, and survive with no network. | Offline-tolerant PWA: last-known week stays glanceable; writes queue and sync. | Hub renders today's board with the network disabled. |
| BO-6 | Keep unit economics honest for a consumer home app. | Azure Table Storage + serverless-friendly stack; near-zero idle cost. | Per-household infra cost stays in single-digit dollars/month at low scale. |

## 4. Personas (v1)

These map directly to roles in the system and to authorization boundaries in Section 7.

- **Household Organizer (Pat).** Holds the one real account (Entra External ID sign-in). Sets up the household, owns billing and teardown, confirms grocery orders. The first champion and the only authenticated user. System role: `Organizer`.
- **Adult Participant (Sam).** A partner who will tap the hub but will never install or log into anything. Claims a profile by tapping a name. System role: `Participant` (adult).
- **Child Participant (Maya).** A kid who gets age-appropriate chores. Same no-password tap-to-claim, flagged parent/child so the assignment engine can respect age-appropriateness. System role: `Participant` with `IsChild = true`.
- **The Hub (the device).** The shared tablet itself is a first-class actor: a paired, long-lived device identity scoped to one household, trusted to read the household and record completions, but not to take sensitive actions.

## 5. Scope

### 5.1 In scope (v1) - the hard line

v1 is the shared hub running exactly the three capabilities the vision locks, plus the two non-negotiable enablers.

1. **Household model** (the spine): rooms, people, chores, assignments, completions - all scoped to one household. (Epic 20)
2. **Chore mapping and fair assignment** (the wedge): a deterministic engine that divides chores fairly and a hub board to claim and complete them. (Epic 40)
3. **Exactly one demoable grocery flow** (real-world execution): capture -> cart -> human-confirmed order, behind a real `IStoreConnector` seam backed by a simulated HEB connector. (Epic 50)
4. **Multiplayer: the hub + tap-to-claim** (non-negotiable day one): no-password participant profiles, organizer-only sensitive actions. (Epic 30)
5. **Offline-tolerant PWA** (the pull habit must survive no network): last-known week glanceable offline, writes queue and sync on reconnect. (Epic 60)

Plus **Foundations** (Epic 10): the architecture skeleton, storage, auth seam, test harness, and CI that make everything above implementable and every ticket's gates real.

### 5.2 Out of scope (v1) - explicitly deferred

Straight from the vision's non-goals. Naming these is the point; a ticket that drifts into one of these is out of scope and must be split into a follow-up issue.

- Calendar integration (arrives v1.1 and completes the retention thesis).
- Meal planning and budgeting.
- A required mobile companion app (optional and organizer-first if it ships at all).
- Multiple grocery stores at once (v1 is one connector).
- Hands-off ordering (v1 always keeps a human on the final tap).
- Butler-made hardware.
- Full parental controls (v1 has only the parent/child flag).
- Real HEB ordering / a real store API (v1's connector is simulated behind the real seam).
- Live Alexa skill and off-hub SMS notifications (v1 has the capture seam; live channels are a fast-follow - see Section 9).

### 5.3 Scope decisions that resolve would-be "material assumptions"

`/implement-issue` halts the moment a ticket forces the engineer to guess about scope, behavior, data, or side-effects. These decisions are pre-made here so the tickets do not have to be:

- **D-1 Persistence:** Azure Table Storage (partition key `householdId`) + Blob + Queues, behind repository interfaces. No EF Core, no relational DB. Rationale in `brd/README.md` (cost + fit).
- **D-2 Organizer auth:** Microsoft Entra External ID (CIAM), validated as JWT bearer. A `DisableAuthentication` dev mode (mirroring QControl) lets local + CI run without a live tenant.
- **D-3 Participant identity:** tap-to-claim, no password. Never behind auth. Sensitive actions (billing, teardown, order confirmation over a configurable amount) require the organizer's JWT.
- **D-4 Grocery connector:** real `IStoreConnector` interface; v1 implementation is a deterministic `SimulatedHebConnector` backed by a checked-in fixture catalog. No network dependency in tests.
- **D-5 Voice/capture:** an `ICaptureSource` seam; v1 ships hub text/tap capture and a simulated voice capture. Live Alexa is deferred behind the seam.
- **D-6 Fair assignment (v1 algorithm):** deterministic, load-balancing round-robin defined in Section 7.6. No ML, no learning.
- **D-7 Repo scope:** all v1 work lives in the single repo `the-butler-did-it`. A ticket may touch both `Butler.API/` and `Butler.UI/` - that is still one repo, one PR. There is no multi-repo signal in v1.
- **D-8 Money movement:** v1 never charges money and never places a real order. "Confirm" records intent only. This keeps tap-to-claim safe (the vision's security trade-off).

## 6. End-to-end user journeys (the v1 loop)

### 6.1 Onboarding (organizer, once)

1. Pat signs in on the hub with Entra External ID (the only login in the product).
2. Pat creates the household, adds rooms (Kitchen, Living Room, ...), adds people (Sam, Maya - Maya flagged child), and maps a starter set of chores to rooms.
3. Pat pairs this tablet as the household's hub device.

### 6.2 The daily glance (any participant, ambient)

1. The hub is already awake, showing today: the chores due, per person.
2. Maya walks past, taps her name; the two chores that are hers glow.
3. She taps one done on her way out. The completion is recorded (and queued if offline).

### 6.3 Fair assignment (weekly, automatic)

1. At the start of the week Butler generates assignments that balance cumulative completed-chore load across eligible members, respecting the child flag.
2. The fairness view shows the balance trending even; the organizer can regenerate.

### 6.4 Grocery (the monthly wow)

1. Sam says or types "add oat milk"; Butler resolves it against the simulated HEB catalog and adds it to this week's cart.
2. Pat reviews the cart on the hub and taps Confirm - the human on the final tap.
3. Butler records a confirmed order (no money moves in v1). The demo is complete.

### 6.5 Offline (any time)

1. The network drops. The hub still shows the last-known week and today's board.
2. Maya taps a chore done; the write queues locally and syncs when the network returns.

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

---

## 8. Requirements-to-epic traceability

Every epic exists to satisfy business objectives; every ticket in an epic cites the requirement it serves. This is the upward trace a reviewer uses to reject scope creep.

| Requirement (what v1 must do) | Serves | Epic | Tickets (see epic file) |
| --- | --- | --- | --- |
| FR-1 Architecture skeleton, storage, auth seam, tests, CI exist | BO-6, all | 10 Foundations | F1-F7 |
| FR-2 Model a household: rooms, people, chores | BO-2 | 20 Household Model | H1-H5 |
| FR-3 No-password tap-to-claim + shared hub shell + organizer sign-in | BO-4 | 30 Tap-to-Claim & Hub | T1-T5 |
| FR-4 Fairly assign chores and let anyone complete them by tap | BO-1 | 40 Chores & Fair Assignment | C1-C6 |
| FR-5 Capture -> cart -> human-confirmed order via a store-connector seam | BO-3 | 50 Grocery Assisted Cart | G1-G5 |
| FR-6 Stay glanceable offline; queue writes and sync | BO-5 | 60 Offline PWA | O1-O4 |

## 9. Fast-follow (v1.0.x / v1.1), captured not built

These are the honest edges. They are out of v1 scope (Section 5.2) but named so the deferral is deliberate and each becomes a follow-up issue when the work reveals it (implement-issue Phase 4.75):

- Live Alexa skill behind the existing `ICaptureSource` seam.
- Off-hub SMS notifications on channels people already have.
- Calendar integration (the v1.1 retention completer).
- A real/aggregator store connector behind the existing `IStoreConnector` seam.
- Hands-off ordering within organizer-set limits.

## 10. Success metrics (how we know v1 worked)

The north star is **weekly active households**. v1 target: 50 percent of onboarded households still weekly-active at month 3 (see the vision's [What winning looks like](../docs/10-product-vision.md#what-winning-looks-like)). v1 must emit the events that make these measurable:

- **Fairness:** top contributor's share of completed chores per household, trending down.
- **Execution:** confirmed carts per active household per month (target >= 1).
- **Retention:** month-3 weekly-active households; passive glances per day trending up.
- **Cost:** per-household infra cost stays single-digit dollars/month at low scale (BO-6).

## 11. Assumptions, risks, and dependencies

- **A-1** Families have a spare Android tablet or iPad (vision: 80 percent of households with children own a tablet). No Butler hardware in v1.
- **A-2** An Entra External ID tenant is available for deployed environments; local + CI use dev mode (D-2).
- **R-1** Tap-to-claim trusts whoever is at the hub. Mitigation: D-8 (no money moves) + organizer JWT on sensitive actions.
- **R-2** Offline sync conflicts (two devices, same chore). Mitigation: completions are append-only; assignment status is last-writer-wins per `(householdId, week, chore)` with optimistic concurrency.
- **R-3** Simulated grocery is not a real integration. Mitigation: it is honest by design (D-4) and swappable behind `IStoreConnector`; the demo is real even if the store is not.
- **Dep-1** Every epic depends on Foundations (Epic 10) landing first. The dependency order is in `brd/README.md`.

## Related

- [Product Vision](../docs/10-product-vision.md) - the why, quantified.
- [Glossary](../docs/90-glossary.md) - every term defined once.
- [brd/README.md](README.md) - epic index, label taxonomy, dependency order, and the `gh issue create` recipe.
- Epic files: [10 Foundations](10-epic-foundations.md), [20 Household Model](20-epic-household-model.md), [30 Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md), [40 Chores & Fair Assignment](40-epic-chores-fair-assignment.md), [50 Grocery Assisted Cart](50-epic-grocery-assisted-cart.md), [60 Offline PWA](60-epic-offline-pwa.md).
