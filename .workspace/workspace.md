# Test workspace: the-butler-did-it

> Rendered from `.workspace/workspace.yaml` by `fe-delivery:local-workspace`. The `.yaml` is the
> source of truth; keep this companion in sync. Bring the workspace up with `/local-workspace` (or
> follow the steps below by hand).

## What this is

Local test workspace for Butler. It runs the demo compose stack from `demo/docker-compose.yml`
through the repo's demo CLI (`demo/demo.sh`): Azurite (Table service, data in `demo/.data/azurite`),
the Butler.API container against Azurite on `127.0.0.1:5108`, and Caddy on :8080 serving the hub PWA
at `/` and proxying `/api/*` to the API. A lighter in-memory dev loop (`dotnet run` +
`expo start --web`) is documented below as the quick option.

## Prerequisites

- docker (`docker info --format '{{.ServerVersion}}'`) - the daemon must be running, not just the CLI
- docker-compose (`docker compose version`), min 2.17 - `demo.sh up` relies on
  `up --wait --wait-timeout`
- node (`node --version`), min 22 - `demo.sh up` builds the hub export (`Butler.UI/dist`);
  `ui-ci.yml` pins Node 22
- dotnet (`dotnet --info`), min 10 - test block only; `Butler.API/global.json` pins the SDK to 10.x

## Bring it up

```
# setup
dotnet restore Butler.API/Butler.API.sln -v q --nologo
npm --prefix Butler.UI ci --no-audit --no-fund --loglevel=error

# service: azurite (demo.sh up also starts it; port 10002 is not published to the host)
docker compose -f demo/docker-compose.yml up -d --wait azurite
# ready: docker compose -f demo/docker-compose.yml ps azurite --format '{{.Health}}' | grep -qx healthy

# run (one-shot; returns when azurite, api and web are all healthy)
demo/demo.sh up
```

`demo/demo.sh up` builds `Butler.UI/dist` with `EXPO_PUBLIC_API_BASE_URL=/api` when the export is
missing or stale, runs `docker compose -f demo/docker-compose.yml up -d --build --wait
--wait-timeout 300`, and recreates `web` after a rebuild so Caddy serves the new export.

Health is confirmed by:

- http `http://localhost:5108/health` (600s) - API container up and serving (anonymous GET /health)
- http `http://localhost:8080/` (600s) - Caddy (web) serving the hub PWA export
- http `http://localhost:8080/api/health` (600s) - proxy route: Caddy strips `/api` and reaches the API

Exposed ports: `8080: web (Caddy) - hub PWA at / and the API at /api/*`,
`5108: api (127.0.0.1 only; container port 8080)`. Azurite's 10002 is not published.

## Run the tests

```
dotnet test Butler.API/Butler.API.sln --nologo
npm --prefix Butler.UI run ci:verify      # CI-equivalent: lint + typecheck + coverage-gated jest (non-interactive)
```

## Tear it down

```
# docker compose down (never -v): stops and removes the containers, keeps demo/.data/azurite.
demo/demo.sh down
```

Isolation: **in-place**

## Quick option: in-memory dev loop

For fast UI or API iteration with no containers. The API uses its in-memory store and auto-seeds.

```
# run (both long-running; start the API first, then the UI)
dotnet run --project Butler.API/src/Butler.Api -- --urls http://localhost:5108
npm --prefix Butler.UI run web            # = expo start --web; Metro on :8081

# stop (bracket trick so pkill does not match its own shell)
pkill -f '[B]utler.Api' || true
pkill -f '[e]xpo start' || true
```

Health: http `http://localhost:5108/health` and tcp `127.0.0.1:8081`.

- **API on :5108, not :5099.** :5108 matches `DEFAULT_DEV_API_BASE_URL` in
  `Butler.UI/src/api/config.ts` (line 13), so the UI needs no env var. DRIFT NOTE (found
  2026-07-21): under `dotnet run` the `http` launch profile's `applicationUrl=:5099` overrides an
  `ASPNETCORE_URLS` env var, so the port MUST be forced with the command-line arg
  `-- --urls http://localhost:5108` (higher config precedence). The env-var form silently binds :5099.

## Notes & gotchas

- **In-place isolation** uses the working checkout directly. Commit or stash before bringing the
  workspace up so dev artifacts do not mix with your changes.
- **Compose shape.** Project `butler-demo` (fixed name). `azurite` runs the Table service only, with
  its data bind-mounted from `demo/.data/azurite` (git-ignored, root-owned). `api` is the Butler.API
  image in the `Demo` environment with `Storage__UseInMemoryStore=false`, pointed at the `azurite`
  service (the connection string lives in the compose file, not the manifest). It starts only after
  azurite is healthy and creates its tables at startup. `web` is Caddy on :8080; API routes are at
  `http://localhost:8080/api/...` (SystemController lands at `/api/api/system/*`).
- **First run is slow.** The first `demo/demo.sh up` builds the api image and the hub export, so allow
  several minutes. Use `demo/demo.sh status` and `demo/demo.sh logs` to inspect the stack.
- **Data is kept on down.** `demo/demo.sh down` runs `docker compose down` without `-v`, so
  `demo/.data/azurite` and the dataset survive.
- **Wiping data is a separate step**, never part of teardown: run `demo/demo.sh down`, then delete
  `demo/.data/azurite` by hand (it is root-owned, so `sudo` may be needed).
- **One stack per host.** The project name is fixed, so a second checkout's `up` reuses the same
  containers and `down` from any checkout stops them.
- **:5108 conflict.** The quick loop and the compose stack both use :5108. Stop one before starting the
  other, or `demo.sh up` fails with "port is already allocated".
