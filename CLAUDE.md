# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Butler** is a household concierge - a shared-tablet family operating system. It is also an explicit
tech experiment and #buildinpublic series. The canonical description of the product, its v1 scope, and
the reasoning behind every major decision is the **[Product Vision](Butler.KnowledgeBase/docs/10-product-vision.md)** -
read it before making product or architecture choices. The v1 scope is a hard line (see the vision's
"What we are NOT building in v1"); when in doubt, do not expand it.

## Building v1: the BRD and its tickets

The v1 build is specified in `Butler.KnowledgeBase/brd/` - a master BRD (`00-brd-master.md`, whose
**Section 7 "Engineering Contract" is binding**: Azure Table Storage keyed by `householdId`, layered +
MediatR adopted from the QControl house style, Entra External ID organizer auth with no-password
tap-to-claim, a simulated store connector behind a real `IStoreConnector` seam, a hard 98% coverage
gate, .NET 10) plus one file per epic of ready-to-file GitHub issue specs. The work is tracked as
GitHub issues in this repo; **`Butler.KnowledgeBase/brd/ticket-issue-map.md` is the canonical crosswalk**
between ticket IDs (F1, H1, ...), the epic-file specs, and live issue numbers - consult it to translate
between the planning docs and the tracker (regenerate it with `brd/tools/generate_issue_map.py`).
Implement an issue with `/implement-issue <n>` and land it with `/merge-issue <n>`.

## Monorepo shape

Three independent sub-services, each with its own build, deploy, and `infra/`. There is no root build
that spans them - operate inside the relevant folder.

- `Butler.UI/` - Expo (React Native + react-native-web) app. Cross-platform (web/iOS/Android/desktop),
  **web-first**: the v1 hub is the Expo web export deployed as an Azure Static Web App (installable
  PWA). Has its own Expo-generated `CLAUDE.md`/`AGENTS.md` that apply within the folder.
- `Butler.API/` - .NET 10 Web API (`Butler.API.sln` -> `src/Butler.Api`), deployed to Azure App Service.
- `Butler.KnowledgeBase/` - an **agent-managed** wiki of canonical Markdown. `docs/` holds articles,
  `intake/` holds source material (not articles), `README.md` is the graph index. This is not product
  code; it is maintained with the `knowledge-base` skill.

## Commands

Butler.UI (from `Butler.UI/`):
```bash
npm install
npm run web                      # web-first dev loop (the hub in a browser)
npm run ios | npm run android    # native simulators
npx expo export --platform web   # static build -> dist/ (deploy target for Azure SWA)
```

Butler.API (from `Butler.API/`):
```bash
dotnet restore
dotnet run --project src/Butler.Api   # run the API locally
dotnet build                          # build the solution
dotnet test                           # run xUnit suite (src/Butler.Api.Tests)
dotnet test /p:CollectCoverage=true   # + enforce the 98% coverage gate (Contract 7.7)
```

Infra (both services) - Bicep, deployed per-service:
```bash
az deployment group create -g <rg> \
  --template-file <service>/infra/main.bicep \
  --parameters <service>/infra/main.bicepparam
```

## Architecture principles (from the vision - keep these true)

- **The household model is the shared spine.** Rooms, people, and chores are the core entities every
  capability reads from and writes to. Build it cleanly; everything else composes on top.
- **Each capability is a module** (chores, groceries, calendar, ...) on top of that spine. Keep them
  independently launchable - modularity is a go-to-market asset here, not just an implementation detail.
- **Grocery integration is a generic store-connector abstraction**, HEB as the first implementation.
  HEB has no public consumer API, so the abstraction (aggregator/assisted now, official later) is what
  keeps "plug into any store" honest. Never hard-wire a single store into product logic.
- **Multiplayer is the whole game.** The hub + tap-to-claim (no-password participant profiles) exists
  to solve family-wide adoption; do not reintroduce per-user login friction on the shared device.

## Azure resource naming

`infra/` Bicep templates are intentionally **policy-agnostic**: names and tags are fully
parameter-driven and the committed `.bicepparam` values are placeholders. Before deploying, fill them
with values valid for the target subscription's Azure Policy. If the target is a Frontier Energy
subscription, generate compliant names/tags with the `azure-resource-naming` skill rather than
hand-authoring them.

## Working in the knowledge base

`Butler.KnowledgeBase/` is a knowledge graph: articles are nodes, `related:` edges are bidirectional,
and `README.md` is the map. Every write is a graph edit (update the index, the reciprocal edges, and
`last-reviewed:`). Use the `knowledge-base` skill (writer + auditor subagents) for any non-trivial
change; do not hand-edit articles in a way that leaves orphans or one-directional edges. Plain ASCII
only - no em dashes, curly quotes, or ellipsis (the usability scorer hard-fails them).

## Test workspace

This repo has a local test-workspace capability managed by the `frontier-energy:local-workspace`
skill. The manifest (source of truth) is `.workspace/workspace.yaml` and its human companion is
`.workspace/workspace.md`. It brings up **both** sub-services together, API-first: the Butler.API
.NET 10 Web API on **:5108** (bound there to match the UI's hard-coded dev default) and the
Butler.UI Expo web hub on **:8081**, using the API's **in-memory store fallback** (no external
storage). Isolation is **in-place** (uses the working checkout - commit or stash first). Bring it
up, check status, or tear it down with **`/local-workspace`**.
