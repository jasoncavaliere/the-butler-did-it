# Butler demo stack

A local, persistent demo of Butler: Azurite (Table storage), the Butler API and
the hub PWA served by Caddy, all started with one Docker Compose command.

| Service | Image | What it does |
| --- | --- | --- |
| `azurite` | `mcr.microsoft.com/azure-storage/azurite:3.35.0` | Table storage, data kept in `demo/.data/azurite` |
| `api` | `butler-api:demo` (built from `Butler.API/`) | The Butler API in the `Demo` environment |
| `web` | `caddy:2.10.2-alpine` | Serves the hub PWA export on port 8080 |

## Prerequisites

- Docker Desktop (or Docker Engine with the Compose v2 plugin on Linux).
- Node 22 (the active LTS) to build the hub export.

## Build the hub export

The `web` service serves the export from `Butler.UI/dist`, which is built on
the host. Build it once, and again after any UI change:

```bash
cd Butler.UI
npm ci
npm run build:web
cd ..
```

If `Butler.UI/dist` is missing, `up` fails with a bind-mount error rather than
serving an empty site.

## Start the stack

From the repo root:

```bash
docker compose -f demo/docker-compose.yml up -d --build
```

`--build` rebuilds the API image so it always matches your checkout.

## URLs

| What | URL |
| --- | --- |
| Hub (PWA) | http://localhost:8080 |
| API health | http://localhost:5108/health |

Use `http://localhost:8080` (not a LAN IP) so the browser treats the page as a
secure context and registers the service worker.

## Stop the stack

```bash
docker compose -f demo/docker-compose.yml down
```

Data survives `down` and the next `up`: it lives in `demo/.data/azurite`,
which is git-ignored.

## Wipe the demo data

Stop the stack, then delete the data folder. Azurite writes it as root, so on
Linux use sudo:

```bash
docker compose -f demo/docker-compose.yml down
sudo rm -rf demo/.data     # Linux
rm -rf demo/.data          # macOS / Windows (Docker Desktop)
```

## Tables

You do not create tables. The API creates every Table Storage table it needs at
startup (#91), and logs `Provisioned N Table Storage tables`. This folder holds
no table-creation steps.

## Known limits

- CORS: the API only allows the Expo dev origins today, so the hub on :8080
  cannot call the API yet. #96 adds the `/api` proxy that fixes this.
- Port 5108: the API is published on `127.0.0.1:5108`, which is also the
  port the local dev workspace (`.workspace/`) binds `dotnet run` to. Stop a
  locally running API before `up`, or `up` fails with "port is already
  allocated".
