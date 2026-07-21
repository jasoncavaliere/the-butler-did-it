# Test workspace: the-butler-did-it

> Rendered from `.workspace/workspace.yaml` by `frontier-energy:local-workspace`. The `.yaml` is the
> source of truth; keep this companion in sync. Bring the workspace up with `/local-workspace` (or
> follow the steps below by hand).

## What this is

Local dev workspace for Butler - runs both sub-services together (API-first): the Butler.API .NET 10
Web API on :5108 and the Butler.UI Expo web hub on :8081. There is no root build, so every command
targets an explicit sub-folder from the repo root. The API runs on the in-memory store fallback (no
external storage) and is deliberately bound to :5108 to match the UI's hard-coded dev default.

## Prerequisites

- dotnet (`dotnet --info`), min 10 - `Butler.API/global.json` pins the .NET SDK to 10.x
- node (`node --version`), min 22 - `.github/workflows/ui-ci.yml` pins Node 22

## Bring it up

```
# setup
dotnet restore Butler.API/Butler.API.sln
npm --prefix Butler.UI ci

# run (both long-running; start the API first, then the UI)
dotnet run --project Butler.API/src/Butler.Api -- --urls http://localhost:5108
npm --prefix Butler.UI run web            # = expo start --web; Metro on :8081
```

Health is confirmed by:

- http `http://localhost:5108/health` (60s) - API maps GET /health -> {status:ok}
- tcp `127.0.0.1:8081` (120s) - Expo/Metro web dev server

Exposed ports: `5108: api`, `8081: expo web / metro`

## Run the tests

```
dotnet test Butler.API/Butler.API.sln
npm --prefix Butler.UI run ci:verify      # CI-equivalent: lint + typecheck + coverage-gated jest (non-interactive)
```

## Tear it down

```
# Bracket trick ([B]/[e]) so the pkill pattern does not self-match the shell running it.
pkill -f '[B]utler.Api' || true
pkill -f '[e]xpo start' || true
```

Isolation: **in-place**

## Notes & gotchas

- **In-place isolation** uses the working checkout directly (tree was clean at authoring time). Commit
  or stash before bringing the workspace up so dev artifacts do not mix with your changes.
- **API on :5108, not :5099.** The API must be started on :5108 so the UI's hard-coded default in
  `Butler.UI/src/api/config.ts:11` (`DEFAULT_DEV_API_BASE_URL`) reaches it with no code change.
  DRIFT NOTE (found during provisioning 2026-07-21): under `dotnet run` the `http` launch profile's
  `applicationUrl=:5099` overrides an `ASPNETCORE_URLS` env var, so the port MUST be forced with the
  command-line arg `-- --urls http://localhost:5108` (higher config precedence). The earlier
  env-var form silently bound :5099. The launch profile still supplies
  `ASPNETCORE_ENVIRONMENT=Development`.
- **In-memory store fallback.** No Azurite / no external storage is used. The API auto-seeds when no
  storage is configured, so there is no service block and no data volume to tear down.
- **Process-based teardown.** `pkill` stops the API and the Expo/Metro dev server without touching data.
