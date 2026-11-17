# Butler demo stack

A local, persistent demo of Butler: Azurite (Table storage), the Butler API and
the hub PWA served by Caddy, all started with one Docker Compose command.

| Service | Image | What it does |
| --- | --- | --- |
| `azurite` | `mcr.microsoft.com/azure-storage/azurite:3.35.0` | Table storage, data kept in `demo/.data/azurite`; Table port also on `127.0.0.1:10012` for the smoke step |
| `api` | `butler-api:demo` (built from `Butler.API/`) | The Butler API in the `Demo` environment |
| `web` | `caddy:2.10.2-alpine` | Serves the hub PWA export on port 8080 and proxies `/api/*` to the API |

## Demo CLI

Two scripts drive the stack: `demo/demo.sh` (bash, Linux and macOS) and
`demo/demo.ps1` (PowerShell 7, Windows, Linux and macOS). They take the same
subcommands, print the same text and work from any directory. Both run every
command against the one compose file, `demo/docker-compose.yml`.

```bash
demo/demo.sh up        # build the hub export if needed, start, wait for healthy, run the smoke suite
demo/demo.sh status    # container health, hub URL and dataset id
demo/demo.sh logs      # follow the API and Caddy logs (Ctrl+C to stop)
demo/demo.sh logs --api   # API only
demo/demo.sh logs -f azurite   # Azurite only
demo/demo.sh down      # stop; data in demo/.data/azurite is kept
demo/demo.sh reset     # delete the demo data, restart and re-seed the demo household
demo/demo.sh snapshot <name>   # save a copy of the demo data in demo/.data/snapshots/<name>
demo/demo.sh restore <name>    # put that copy back and change the dataset id
demo/demo.sh snapshots         # list the snapshots with their dates
demo/demo.sh verify    # headless browser test of the demo path, then reset
demo/demo.sh share     # HTTPS URL + QR code for a tablet on your tailnet
demo/demo.sh unshare   # stop sharing; localhost:8080 keeps working
```

PowerShell 7:

```powershell
pwsh demo/demo.ps1 up          # or ./demo/demo.ps1 up from a pwsh prompt
pwsh demo/demo.ps1 status
pwsh demo/demo.ps1 logs
pwsh demo/demo.ps1 logs --api
pwsh demo/demo.ps1 logs -f azurite
pwsh demo/demo.ps1 down
pwsh demo/demo.ps1 reset
pwsh demo/demo.ps1 snapshot <name>
pwsh demo/demo.ps1 restore <name>
pwsh demo/demo.ps1 snapshots
pwsh demo/demo.ps1 verify
pwsh demo/demo.ps1 share
pwsh demo/demo.ps1 unshare
```

| Command | What it does |
| --- | --- |
| `demo.sh up` | Checks that `BUTLER_DEMO_PIN` is a 4-6 digit PIN (from the shell, else from `demo/.env`) and stops with `demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md.` before running npm or docker if it is not. Then builds `Butler.UI/dist` when it is missing, older than the `Butler.UI` sources, or lacks a matching, current build stamp (running `npm ci` first if `node_modules` is missing or stale, and setting `EXPO_PUBLIC_API_BASE_URL=/api`, `EXPO_PUBLIC_AUTH_PROVIDER=pin`, `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household` and `EXPO_PUBLIC_BUILD_SHA` for the build), starts the stack (passing the same git short SHA to the API image build as `BUILD_SHA`), recreates `web` after a rebuild, and waits until every service reports healthy. Then it runs the smoke suite with the host .NET SDK and prints `Demo ready: <urls>` and exits 0 only when every smoke check passes (see [Smoke step](#smoke-step)); it checks for the SDK first, before running npm or docker. After each successful build, `up` writes the stamp `Butler.UI/dist/.demo-build-env` (the `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_AUTH_PROVIDER` and `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID` values it used), so an export built another way, such as by hand, or by an older `up` without `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID`, is rebuilt once. If the export build fails, `up` deletes `Butler.UI/dist/index.html` and the stamp, so the next `up` rebuilds the export instead of serving the broken one. See [Organizer PIN](#organizer-pin). |
| `demo.sh down` | Stops the stack. The Azurite data in `demo/.data/azurite` is kept. |
| `demo.sh reset` | Puts the demo back to a known state with no prompts: refuses to run unless the target is the local demo stack, stops the stack, deletes the Azurite data in `demo/.data/azurite`, starts the stack as `up` does (without the smoke step), signs in with `BUTLER_DEMO_PIN` and seeds the demo household ("The Parker Household"), which also changes the dataset id. It prints the old and new dataset id. Needs `curl` (`demo.sh` only). See [Reset the demo](#reset-the-demo). |
| `demo.sh snapshot` | `snapshot <name>` saves a copy of the demo data: refuses to run unless the target is the local demo stack, stops only Azurite, copies `demo/.data/azurite` to `demo/.data/snapshots/<name>` and starts Azurite again. The API and the hub keep running, so the organizer stays signed in. Refuses a name that is already taken. See [Snapshots](#snapshots). |
| `demo.sh restore` | `restore <name>` puts a snapshot back: checks the PIN, refuses to run unless the target is the local demo stack, stops the stack, replaces `demo/.data/azurite` with the snapshot, starts the stack as `up` does (without the smoke step), signs in with `BUTLER_DEMO_PIN` and changes the dataset id. It prints the snapshot's and the new dataset id. Snapshot dates do not move. Needs `curl` (`demo.sh` only). See [Snapshots](#snapshots). |
| `demo.sh snapshots` | Lists the snapshots in `demo/.data/snapshots`, newest first, with the local date and time each was taken. See [Snapshots](#snapshots). |
| `demo.sh verify` | Checks the PIN, installs the browser suite in `demo/e2e` (`npm ci`) and its Chromium if needed, then runs the Playwright suite headless at 1280x800 against `http://localhost:8080`: it pairs the hub, claims a name, completes and reopens a chore, checks the fairness bars, adds a typed grocery item, confirms the cart as the organizer and sees the receipt, then reloads offline and syncs a chore completed offline. Exits non-zero when any test fails. Always runs `reset` afterwards, pass or fail. Needs Node 22 and a running stack (`up`). See [Verify the demo](#verify-the-demo). |
| `demo.sh status` | Shows each container's state and health, the hub URL `http://localhost:8080` and the dataset id. |
| `demo.sh logs` | Follows the API and Caddy (`web`) logs together, starting from the last 100 lines of each. `--api` shows only the API. Any other argument goes to `docker compose logs` as-is and turns off the default `--follow --tail 100` (for example `logs --api --since 10m`). Naming a compose service (`azurite`, `api` or `web`) shows only the services named: `logs -f azurite` follows Azurite alone, and the API and Caddy default applies only when no service is named. See [Logs](#logs). |
| `demo.sh share` | Checks that Tailscale is installed and logged in, runs `tailscale serve --bg 8080`, and prints the hub's `https://<host>.<tailnet>.ts.net` URL and a terminal QR code of it. Stops with a message and a non-zero exit if Tailscale is missing, logged out, or has no HTTPS name. See [Connecting a tablet](#connecting-a-tablet). |
| `demo.sh unshare` | Removes only the `/` handler `share` added (`tailscale serve --https=443 --set-path=/ off`); other serve handlers on 443 are kept. The hub stays on `http://localhost:8080`. |

Running a script with no subcommand, or with one it does not know, prints this
list and exits non-zero. The `demo.ps1` commands are the same. The manual
sections below are the fallback when you want to run the steps yourself.

## Prerequisites

- Docker Desktop (or Docker Engine with the Compose v2 plugin on Linux).
- A `demo/.env` file that sets `BUTLER_DEMO_PIN` (see [Organizer PIN](#organizer-pin)).
- Node 22 (the active LTS) to build the hub export.
- The .NET 10 SDK (`dotnet --list-sdks` lists a 10.x SDK) for the smoke step
  `up` runs (see [Smoke step](#smoke-step)). Without an SDK, `up` stops
  before it starts anything.
- PowerShell 7 to use `demo/demo.ps1` (bash is enough for `demo/demo.sh`).
- For `verify`: Node 22 again, and a one-time download of about 150 MB for
  Playwright's Chromium (`verify` fetches it). On Linux, Chromium also needs
  some system libraries; if it will not start, run
  `npx playwright install-deps chromium` in `demo/e2e` once. That needs
  `sudo`, which the scripts never run for you.
- Optional, for `share`: Tailscale 1.52 or later (older versions use a
  different `tailscale serve` syntax).
- Optional, for `share`: `qrencode` to print the QR code offline. Without it,
  `share` uses `npx` to download `qrcode-terminal` from the npm registry.

## Build the hub export

`demo.sh up` does this for you when the export is missing, out of date, or
was not built by `up` (it has no matching, current
`Butler.UI/dist/.demo-build-env` stamp). A hand build like the one below is
therefore rebuilt once by the next `up`.

The `web` service serves the export from `Butler.UI/dist`, which is built on
the host. Build it once, and again after any UI change, with the API base set
to `/api` so the hub calls the API on its own origin, the organizer sign-in
set to the PIN pad, and the demo household as the hub's starting household:

```bash
cd Butler.UI
npm ci
EXPO_PUBLIC_API_BASE_URL=/api EXPO_PUBLIC_AUTH_PROVIDER=pin EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household npm run build:web
cd ..
```

PowerShell:

```powershell
cd Butler.UI
npm ci
$env:EXPO_PUBLIC_API_BASE_URL = '/api'; $env:EXPO_PUBLIC_AUTH_PROVIDER = 'pin'; $env:EXPO_PUBLIC_DEMO_HOUSEHOLD_ID = 'demo-household'; npm run build:web
cd ..
```

Expo inlines `EXPO_PUBLIC_*` values when it bundles, so the variables must be
set in the shell that runs the build. Without `EXPO_PUBLIC_API_BASE_URL` the
hub calls `http://localhost:5108` directly, a different origin, and the
browser blocks those calls with CORS errors. Without
`EXPO_PUBLIC_AUTH_PROVIDER=pin` the hub shows no PIN pad and cannot sign the
organizer in against the Demo API.

`EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household` (#316) is the household the hub
opens when its browser has no stored pairing: the one `reset` seeds ("The
Parker Household"). A fresh tablet, or one whose pairing a reset removed, then
opens the demo family instead of the setup screens; it shows the family once
the organizer signs in with the PIN. A stored pairing still wins. Leave the
variable out to get the setup screens on a fresh browser, as before. The id
must exist: on a stack that was never reset the household is missing, and the
hub shows an error instead of setup, so run `demo/demo.sh reset` once.

`demo.sh up` also stamps both builds with the git short SHA (#126): it sets
`BUTLER_BUILD_SHA` (unless your shell already set it), which compose passes to
the API image as `BUILD_SHA` and the export build gets as
`EXPO_PUBLIC_BUILD_SHA`. The organizer's Version button shows both and flags a
mismatch. A hand-built export without `EXPO_PUBLIC_BUILD_SHA` reports `dev`.
`up` rebuilds an export it built itself only when the UI sources are newer
than `dist` (the build stamp leaves the SHA out), so after a commit that touched only the API the hub keeps its older SHA and the
Version panel honestly flags the mismatch.

`Butler.UI/metro.config.js` keys Metro's transform cache on every
`EXPO_PUBLIC_*` value, so a changed value always reaches the bundle. If a
rebuild still calls `localhost:5108`, clear the cache once with
`npx expo export --platform web --clear && node scripts/pwa-export.js dist`
(variables still set).

If `Butler.UI/dist` is missing, `up` fails with a bind-mount error rather than
serving an empty site.

A build replaces the `dist` folder, so if the stack is already running,
recreate `web` afterwards or Caddy keeps serving the old folder:
`docker compose -f demo/docker-compose.yml up -d --force-recreate web`.

## Start the stack

`demo.sh up` (or `demo.ps1 up`) runs this and waits until every service is
healthy. To run it by hand, from the repo root:

```bash
mkdir -p demo/.data/logs && chmod 777 demo/.data/logs
docker compose -f demo/docker-compose.yml up -d --build
```

`--build` rebuilds the API image so it always matches your checkout. The
`mkdir`/`chmod` line (which `up` runs for you) makes the API's log folder
writable: the API container runs as a non-root user, and on a Linux engine a
folder Docker creates for the bind mount is owned by root. Skip it and the API
still runs, but writes no log files. Compose reads `BUTLER_DEMO_PIN` from
`demo/.env` (or your shell); without it the API does not start. If `up` says
the API file log is off, see
[When up says the API file log is off](#when-up-says-the-api-file-log-is-off).

### Smoke step

Once every service is healthy, `up` (both `demo.sh` and `demo.ps1`, but not
`reset`) runs the API's smoke suite (`Butler.API/src/Butler.Api.SmokeTests`)
against the running stack with the host .NET SDK, so a stack that is up but
broken does not look ready (#103). It prints
`Running the smoke suite against http://localhost:8080/api/ ...`, streams the
`dotnet test` output, and runs:

- **Liveness**: the read-only `GET /health` and `GET /api/system/ping`
  checks, through the Caddy proxy.
- **Endpoints**: the Rooms HTTP round trip (#92): create, read, update with
  and without a current `If-Match`, and delete a room, and read the Rooms
  table directly to prove the API wrote to Azurite. Each test works in its own
  throwaway household, `smoke-rooms-<guid>`, and deletes the rooms it created,
  so the seeded demo household is never touched.

It never runs the Demo category (which seeds the demo household; `reset`
does that), nor the Storage or Provisioning categories.

The Demo API signs the organizer in with the PIN, so the suite signs in once,
with the PIN from your shell or `demo/.env`, through
`POST /api/auth/pin/sign-in` and sends the token on its requests. The PIN
reaches `dotnet` only through its environment, never its command line. The
direct Rooms table reads use Azurite's loopback-only host port
`127.0.0.1:10012` and the well-known public `devstoreaccount1` key.

When every check passes, the last line is:

```text
Demo ready: hub http://localhost:8080 | API http://localhost:8080/api/health | Swagger http://localhost:5108/swagger
```

and `up` exits 0. When a check fails, `up` prints one line per failed test on
stderr, then `Demo is not ready: the smoke suite failed. Run the logs command to see why.`,
and exits 1. The stack keeps running, so you can look at the logs:

```text
Smoke check failed: Butler.Api.SmokeTests.LivenessSmokeTests.Get_health_returns_200_with_status_ok
Demo is not ready: the smoke suite failed. Run the logs command to see why.
```

When no .NET SDK is found (no `dotnet` on `PATH`, or `dotnet --list-sdks`
lists none), `up` prints this and exits 1 before it runs npm or docker. It
never skips the smoke step:

```text
The .NET SDK is required for the smoke step that up runs, and none was found. Install the .NET 10 SDK, then run up again. See demo/README.md.
```

To run the same smoke step by hand against a running stack, from the repo root:

```bash
cd Butler.API
BUTLER_SMOKE_BASE_URL=http://localhost:8080/api/ \
BUTLER_SMOKE_STORAGE_CONNECTION_STRING='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10012/devstoreaccount1;' \
BUTLER_SMOKE_ORGANIZER_PIN="<your BUTLER_DEMO_PIN>" \
  dotnet test src/Butler.Api.SmokeTests/Butler.Api.SmokeTests.csproj --filter 'Category=Liveness|Category=Endpoints'
```

The trailing slash in `BUTLER_SMOKE_BASE_URL` matters: without it the suite's
requests drop the `/api` prefix.

## Organizer PIN

In the demo the organizer signs in with a 4-6 digit PIN (#105). The API reads
it from the `BUTLER_DEMO_PIN` environment variable, which compose passes from
`demo/.env`. That file is git-ignored: never commit a PIN.

Set the PIN once, from the repo root (pick your own digits, or generate them):

```bash
printf 'BUTLER_DEMO_PIN=%s\n' "$(shuf -i 1000-999999 -n 1)" > demo/.env
```

PowerShell:

```powershell
"BUTLER_DEMO_PIN=$(Get-Random -Minimum 1000 -Maximum 1000000)" | Set-Content demo/.env
```

The demo flow:

1. **Open the demo household.** Run `demo/demo.sh up`, and on a fresh stack
   run `demo/demo.sh reset` once to seed the demo household (see
   [Reset the demo](#reset-the-demo)). Open http://localhost:8080. With
   nothing stored in the browser, the hub opens "The Parker Household"
   (`demo-household`, #316) instead of the setup screens.
2. **Sign in with the PIN.** Tap "Organizer sign in", type the PIN on the PIN
   pad and tap Sign in. The hub then shows Maria, Dan, Ava and Leo. A wrong
   PIN says "That PIN is not right."; after 5 wrong PINs in a row every
   attempt is refused for 60 s. To set up your own household on the setup
   screens instead, build the export without `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID`
   (see [Build the hub export](#build-the-hub-export)).
3. **Pair the hub.** On the hub, tap "Pair this tablet". The tablet now
   reads and writes as the hub: name tiles, chores, completions, the grocery
   list. The hub stays paired across page reloads, including automatic ones
   (a new build arriving, #108, or the hub recovering itself, #109): it comes
   back on the household's tiles and chores without the PIN. A
   reload does sign the organizer out, so sign in with the PIN again for the
   organizer actions.
4. **Sign out.** Tap "Sign out" in the organizer bar. The hub stays on the
   household's tiles and chores, and the sensitive actions (Confirm order,
   pairing) disappear. To sign in again, tap "Organizer sign in" and enter the
   PIN.
5. **Open the hidden maintenance menu.** On the hub, press and hold the
   household name for 3 s, then enter the PIN. The menu shows the API URL,
   whether the API answers its ping, the dataset id, and the hub and API build
   versions. From there you can reload the app, clear this household's local
   cache (its last-known week and queued writes), or sign the organizer out,
   each after a confirmation, without leaving kiosk mode.

The organizer token also expires after 15 minutes without use. The hub has no
idle timer of its own (#195), so it keeps showing the organizer bar until it
next calls the API. On that next request (any tap that loads or saves), the
API refuses the expired token and the hub returns to the household's tiles and
chores without the organizer bar, the same as after "Sign out", and repeats
the request as the paired hub. If that request was an organizer-only action
(Confirm order, pairing), it does not go through: tap "Organizer sign in",
enter the PIN, and repeat it. The demo scripts
(#98, #99) sign in the same way, with the PIN from `demo/.env`:
`POST /api/auth/pin/sign-in` with `{"pin":"<pin>"}` returns a `token` to send
as `Authorization: Bearer <token>`.

**Unpair the hub.** The hub keeps its pairing (the household id and the
device token, never the organizer token) in the tablet browser's local
storage under `butler.hubPairing.v1`. To unpair it, do one of these:

- Delete the household: sign in, tap "Delete household" and confirm. The hub
  forgets the pairing and returns to setup.
- Clear the hub's site data in the tablet browser. This also drops the
  offline last-known week and the queue of unsent writes. Or, from the
  browser's developer console on the hub page, run
  `localStorage.removeItem('butler.hubPairing.v1')` and reload.
- After `reset` (see [Reset the demo](#reset-the-demo)) or "Wipe the demo
  data" below, the API no longer knows the device token, so the hub unpairs
  itself on its next load. A hub built by `up` (#316) then returns to the
  demo household and shows the re-seeded family once the organizer signs in
  with the PIN; a hub built without `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID` shows
  setup.

## URLs

| What | URL |
| --- | --- |
| Hub (PWA) | http://localhost:8080 |
| API health (through the proxy) | http://localhost:8080/api/health |
| System ping (through the proxy) | http://localhost:8080/api/api/system/ping |
| Dataset id (through the proxy) | http://localhost:8080/api/api/system/dataset |
| API health (direct, for debugging) | http://localhost:5108/health |
| Swagger UI (direct) | http://localhost:5108/swagger |
| Azurite Table endpoint (loopback only, for the smoke step) | http://127.0.0.1:10012/devstoreaccount1 |

Use `http://localhost:8080` (not a LAN IP) so the browser treats the page as a
secure context and registers the service worker. To open the hub on a tablet,
see [Connecting a tablet](#connecting-a-tablet).

### Single origin

The hub and the API share one origin, `http://localhost:8080`, so there is no
CORS. Caddy strips the `/api` prefix before proxying, so
`/api/households` reaches the API's `/households`. `SystemController` keeps
its own `api/system` route, so through the proxy its endpoints are at
`/api/api/system/*` (for example `/api/api/system/ping`).

Any other path that is not a file in the export returns `index.html`, so deep
links work. `index.html`, `sw.js` and `manifest.json` are sent with
`Cache-Control: no-cache`; the content-hashed files under `/_expo/static/` and
`/assets/` are cached for a year.

demo-ci also runs `node demo/ci/check-precache.cjs <url-or-file>` against the
served `sw.js`. It passes only when the worker carries the precache list that
`npm run build:web` injects: a 12-hex build id, the app shell (`/index.html`)
and at least one `/_expo/**.js` bundle. It rejects the placeholder worker that
a bare `expo export` copies from `Butler.UI/public/sw.js`. The checker exits 0
when the list is real, 1 when it rejects the worker, and 2 on bad usage or an
error (unreadable file, failed fetch); `demo/ci/check-precache-exit.sh` checks
those codes. You can point it at a local build too, for example
`node demo/ci/check-precache.cjs Butler.UI/dist/sw.js`.

To check it end to end, `demo/ci/check-household-flow.cjs` (run by demo-ci)
opens the hub in a headless browser, creates a household through the setup
screens and waits for the hub to read it back. It fails if any API call is not
under `http://localhost:8080/api/`, any request leaves that origin, or the
console shows a CORS error. It needs the setup screens, so run it against an
export built without `EXPO_PUBLIC_DEMO_HOUSEHOLD_ID` (see
[Build the hub export](#build-the-hub-export)), not the one `up` builds.

`demo/ci/check-demo-household.cjs` (#316, also run by demo-ci) fits the export
`up` builds. Run it after `demo/demo.sh up` and `demo/demo.sh reset`: it opens
the hub in a fresh browser, checks that the setup screens are not shown, signs
the organizer in with `BUTLER_DEMO_PIN`, and waits for "The Parker Household"
and "Maria". It fails if the hub creates a household, makes no same-origin 200
`GET /api/households/demo-household`, sends a request to another origin, has a
request fail, or the console shows a CORS error.

Both need Playwright, which is not a repo dependency:

```bash
npm install --no-save --prefix /tmp/pw playwright@1.64.1
/tmp/pw/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/pw/node_modules node demo/ci/check-household-flow.cjs http://localhost:8080/
NODE_PATH=/tmp/pw/node_modules node demo/ci/check-demo-household.cjs http://localhost:8080/
```

## Connecting a tablet

The hub is an offline-first PWA, and its service worker only registers in a
secure context: HTTPS, or `http://localhost`. On a tablet,
`http://<lan-ip>:8080` loads, but the service worker never registers, so the
hub silently stops working the moment the tablet goes offline. Use one of the
three options below. Checking them on real devices is tracked in #132.

For a hub tablet running Fully Kiosk Browser, import the reviewed hub settings
from [tablet/README.md](tablet/README.md) (#129).

### Tailscale (default)

`share` puts the hub on your tailnet at `https://<host>.<tailnet>.ts.net` with
a publicly trusted certificate.

One-time setup:

1. Create a free Tailscale account and install Tailscale 1.52 or later on the
   desktop that runs the stack and on the tablet.
2. In the Tailscale admin console, on the DNS page, enable MagicDNS and HTTPS
   Certificates.
3. Sign in to the same tailnet on both devices.
4. Linux only: allow your user to configure serving, once:
   `sudo tailscale set --operator=$USER`.

Each demo:

```bash
demo/demo.sh up
demo/demo.sh share      # runs tailscale serve --bg 8080, prints the URL and a QR code
# scan the QR code on the tablet, or type the URL
demo/demo.sh unshare    # when you are done
```

- The certificate is publicly trusted, so the tablet needs no extra setup, and
  kiosk apps and WebViews that ignore user-installed certificates still work.
- It works across networks: the tablet can be on a phone hotspot while the
  desktop is on office Wi-Fi.
- It uses `tailscale serve`, not `tailscale funnel`, so the URL is reachable
  only from devices signed in to your tailnet, never from the public internet.
- The first request after `share` can take a few seconds while Tailscale
  issues the certificate.
- `http://localhost:8080` keeps working on the desktop while sharing is on:
  `tailscale serve` only forwards the HTTPS traffic to it.
- `share` stops with a message, without changing anything, if Tailscale is not
  installed, not logged in, or reports no HTTPS name (MagicDNS or HTTPS
  Certificates are off).
- `unshare` turns off only the HTTPS handler that `share` added. It does not
  run `tailscale serve reset`, so any other serve config you have is kept.

### Local CA (manual fallback)

Without Tailscale, serve the hub over HTTPS on the LAN with a certificate from
a local certificate authority, and trust that authority on the tablet. This is
not automated.

With mkcert, on the desktop:

```bash
mkcert -install                 # creates the local CA (rootCA.pem in `mkcert -CAROOT`)
mkcert 192.168.1.20             # your desktop's LAN IP; writes 192.168.1.20.pem and 192.168.1.20-key.pem
```

Then put an HTTPS proxy in front of the hub, for example with Caddy installed
on the desktop and a `Caddyfile` outside the repo:

```
https://192.168.1.20:8443 {
	tls 192.168.1.20.pem 192.168.1.20-key.pem
	reverse_proxy localhost:8080
}
```

Run it with `caddy run --config Caddyfile`. Or skip mkcert and let Caddy's own
internal CA issue the certificate:

```bash
caddy reverse-proxy --from https://192.168.1.20:8443 --to localhost:8080 --internal-certs --disable-redirects
```

Caddy's root certificate is then `pki/authorities/local/root.crt` under
Caddy's data directory (`caddy environ` prints it as `caddy.AppDataDir`).
Allow port 8443 through the desktop firewall, then install the root
certificate (mkcert's `rootCA.pem` or Caddy's `root.crt`) on the tablet:

- Android: copy the file to the tablet, then open Settings > Security >
  Encryption & credentials > Install a certificate > CA certificate (the menu
  path varies by vendor).
- iPad: send the file by AirDrop or email and open it, install the profile in
  Settings > General > VPN & Device Management, then turn on full trust for it
  in Settings > General > About > Certificate Trust Settings.

Open `https://192.168.1.20:8443` on the tablet. Caveat: since Android 7, apps
do not trust user-installed CAs unless they opt in, so a kiosk app or WebView
may reject the certificate even though Chrome accepts it. Prefer Tailscale in
that case.

### adb reverse (Android, USB)

For an Android tablet on a USB cable, `adb reverse` maps the tablet's own
`localhost:8080` to the desktop's, so the hub is a secure context with no
certificate at all:

1. Enable Developer options and USB debugging on the tablet, connect it, and
   accept the debugging prompt.
2. On the desktop: `adb reverse tcp:8080 tcp:8080`.
3. On the tablet, open `http://localhost:8080`.

The mapping lasts only while adb is connected; reconnecting the cable or
restarting adb drops it. Remove it with `adb reverse --remove tcp:8080`.

## Logs

`demo.sh logs` follows the API and Caddy container logs together (Caddy
writes one JSON access-log line per request, except its own healthcheck probe,
#192); `demo.sh logs --api` shows only the API, and naming a service
(`demo.sh logs -f azurite`) shows only that service. Caddy's access log
exists only there, in its container log.

In the stack the API also writes a structured log file (the `Demo`
environment only; nowhere else):

- Path: `demo/.data/logs/butler-api-<yyyyMMdd>.log`, mounted at `/app/logs` in
  the `api` container. Git-ignored, and kept across `down` and `up`.
- Format: one compact JSON object per line (Serilog CLEF): `@t` timestamp,
  `@mt` message template, plus the event's properties. Every request except
  `GET /health`, the healthcheck probe (#192), writes one line with `Method`,
  `Path`, `StatusCode`, `ElapsedMs`, `HouseholdId` (when the route has one)
  and `CorrelationId`.
- Limits: a new file starts each day and whenever the current one reaches
  10 MB (`butler-api-<date>_001.log`, ...); at most 10 files are kept, the
  oldest deleted first. Change them with `DemoLogging__FileSizeLimitBytes` and
  `DemoLogging__RetainedFileCountLimit` on the `api` service.
- Correlation: an RFC 7807 error body's `traceId` is the request's
  `CorrelationId`, so find the log line for a failed call with:

  ```bash
  grep -h '"CorrelationId":"<traceId>"' demo/.data/logs/butler-api-*.log
  ```

- The files are owned by the container user (uid 1654). Delete them with
  `sudo rm` on Linux if your user cannot.

### When up says the API file log is off

If `up` cannot create `demo/.data/logs` or make it writable for the API
container, it prints this before it starts the stack (#193):

```text
WARNING: The API file log is off. up could not make demo/.data/logs writable for the API container.
demo/.data is probably owned by root from an earlier run. The stack still starts, without the API log files.
To fix it, run down, then this from the repo root, then up again:
  sudo chown -R "$(id -u):$(id -g)" demo/.data
```

The usual cause is a `demo/.data` folder owned by root. On a Linux engine,
Docker creates a missing bind-mount folder as root, for example after a plain
`docker compose up` without the `mkdir` line above, or after a run from before
`up` created the folder itself (#107). Your user then cannot create or chmod
`demo/.data/logs`, and the non-root API container cannot write to it. The
stack still runs and serves the hub, and `demo.sh logs` still works, but there
are no `demo/.data/logs/butler-api-*.log` files.

Fix it once, from the repo root:

```bash
demo/demo.sh down
sudo chown -R "$(id -u):$(id -g)" demo/.data
demo/demo.sh up
```

`-R` also hands you the Azurite data in `demo/.data/azurite`, which is
harmless. After that, every `up` can make the log folder writable again, and
the warning goes away. Docker Desktop on macOS and Windows normally does not
hit this. The scripts never run `sudo` themselves.

## Stop the stack

`demo.sh down` (or `demo.ps1 down`) runs this. By hand:

```bash
docker compose -f demo/docker-compose.yml down
```

Data survives `down` and the next `up`: it lives in `demo/.data/azurite`,
which is git-ignored.

## Reset the demo

`demo/demo.sh reset` (or `pwsh demo/demo.ps1 reset`) puts the demo back to a
known state between demos. It asks nothing, so it also runs from scripts and
CI. In order, it:

1. Checks that `BUTLER_DEMO_PIN` is a 4-6 digit PIN, as `up` does, and stops
   with the same message if it is not.
2. Refuses to run, and exits non-zero without changing anything, unless the
   target is the local demo stack: the Docker engine is local (a `unix://` or
   `npipe://` endpoint, from `DOCKER_HOST` or the current Docker context), the
   compose project is `butler-demo`, the API's storage connection string
   points at the `azurite` service, and Azurite's data folder is
   `demo/.data/azurite`. The message starts with `Refusing to reset:` and
   names the check that failed.
3. Stops the stack (`down`, never `-v`).
4. Deletes everything in `demo/.data/azurite`, inside a one-off `azurite`
   container (`find /data -mindepth 1 -delete`), so it needs no `sudo` on
   Linux. The API log files in `demo/.data/logs` are kept.
5. Starts the stack as `up` does: builds the hub export if needed and waits
   until every service is healthy. It does not run the smoke step or need
   the .NET SDK.
6. Signs in with `BUTLER_DEMO_PIN` (`POST /api/auth/pin/sign-in`), once, and
   seeds the demo household (`POST /api/demo/seed`): "The Parker Household",
   id `demo-household`, with Maria, Dan, Ava and Leo on the roster, chores,
   this week's assignments and a fairness history.
7. Checks that the dataset id changed and prints `Dataset: <old> -> <new>`.

After a reset:

- The organizer signs in with the PIN again: the restart dropped every
  organizer session.
- The tablet pairs again: the delete removed every hub-device token, so a
  paired hub unpairs itself on its next load. A hub built by `up` returns to
  the seeded demo household (#316) and shows the Parker family once the
  organizer signs in with the PIN; pair it again from there.
- The new dataset id tells the hub to drop its offline cache and its queue of
  unsent writes (#100), so nothing from before the reset is replayed.

## Verify the demo

`demo/demo.sh verify` (or `pwsh demo/demo.ps1 verify`) walks the demo path in
a headless browser and tells you whether it still works. The suite is in
`demo/e2e` (Playwright, with its own `package.json`); it is not part of the
UI's jest gate or of PR CI.

Before the first run:

1. Start the stack: `demo/demo.sh up`.
2. Reset it, so the suite starts from the seeded demo household:
   `demo/demo.sh reset`.
3. Make sure `BUTLER_DEMO_PIN` is set (in `demo/.env` or the shell), as for
   `up`. `verify` passes it to the suite through the environment only; it is
   never printed or put on a command line.

Then run `demo/demo.sh verify`. It installs the suite's dependencies
(`npm ci` in `demo/e2e`) and Playwright's Chromium when they are missing,
then runs the suite headless in a 1280x800 window against
`http://localhost:8080`. In order, the suite:

1. Opens the hub, signs the organizer in with the PIN, checks that "The
   Parker Household" and its four members show, pairs the tablet and signs
   the organizer out again.
2. Checks the browser window is 1280x800.
3. Taps Maria's name and checks her tile shows her as claimed.
4. Taps one of her Open chores, checks it shows Done, taps it again and
   checks it shows Open.
5. Checks the fairness view draws its bars.
6. Types "oat milk" into the grocery cart and checks H-E-B Oat Milk appears
   in the cart.
7. Signs the organizer in with the PIN, confirms the cart and checks the
   receipt screen shows.
8. Takes the browser offline, reloads and checks the last-known board shows.
9. Comes back online, completes a chore offline, goes online again and
   checks the queued completion syncs and the chore is still Done after a
   reload.

`verify` exits 0 and prints `Demo verified: the browser suite passed and the
stack was reset.` when every test passes. When a test fails it exits
non-zero and prints `Demo verify failed. See the Playwright output above;
traces are in demo/e2e/test-results.` The trace and a screenshot of each
failed test are in `demo/e2e/test-results` (git-ignored); open a trace with
`npx playwright show-trace <path>` from `demo/e2e`.

`verify` ALWAYS runs `reset` when the suite finishes, pass or fail (from
Playwright's global teardown), so the stack is back in the seeded state and
the next demo does not start with the suite's confirmed cart. This takes a
minute or more. It also means:

- Anything you staged by hand for a demo is wiped. Take a snapshot first if
  you want it back.
- The tablet must pair again, and the organizer sign in again, afterwards.
- If that reset fails, `verify` exits non-zero with `demo reset failed after
  the browser suite. Run demo reset by hand.`

`verify` takes no arguments and ignores extras. To run the suite yourself
(for example headed, or one test), run `npx playwright test` in `demo/e2e`
with `BUTLER_DEMO_PIN` set; its teardown still runs `reset`.

## Snapshots

A snapshot is a copy of the demo data that you can put back later. Use it for
a short-lived, hand-staged state, such as a mid-week board set up for one
prospect: stage it once, take a snapshot, and restore it before each run of
that demo. For a demo dated today, use `reset` instead (see the warning
below).

```bash
demo/demo.sh snapshot prospect-acme    # save the current demo data
demo/demo.sh snapshots                 # list the snapshots, newest first
demo/demo.sh restore prospect-acme     # put that data back
```

```powershell
pwsh demo/demo.ps1 snapshot prospect-acme
pwsh demo/demo.ps1 snapshots
pwsh demo/demo.ps1 restore prospect-acme
```

**Warning: snapshot dates do not move.** A restore puts back the data exactly
as it was. Chores, assignments, completions and the fairness history keep the
dates they had when the snapshot was taken, so a snapshot ages: restore it a
week later and the hub shows last week. Use `reset` for a demo dated today.

Snapshot names use letters, digits, `.`, `_` and `-`, start with a letter or
digit, and are at most 64 characters. Snapshots live in
`demo/.data/snapshots/<name>`, which is git-ignored like the rest of
`demo/.data`.

`snapshot <name>`, in order:

1. Checks the name, and stops if `demo/.data/snapshots/<name>` already exists.
2. Refuses to run, as `reset` does, unless the target is the local demo stack.
   The message starts with `Refusing to snapshot:`.
3. Stops only Azurite (`stop azurite`), so it saves its store to disk. The API
   and the hub keep running, and the organizer stays signed in. If the stack
   was down, only Azurite is running afterwards.
4. Copies `demo/.data/azurite` to `demo/.data/snapshots/<name>` inside a
   one-off `azurite` container, so it needs no `sudo` on Linux. A failed copy
   is removed.
5. Starts Azurite again and waits until it is healthy, and prints
   `Snapshot saved: demo/.data/snapshots/<name>`.

`restore <name>`, in order:

1. Checks the name, checks that `BUTLER_DEMO_PIN` is a 4-6 digit PIN, as `up`
   does, and stops if there is no snapshot with that name.
2. Refuses to run, as `reset` does, unless the target is the local demo stack.
   The message starts with `Refusing to restore:`.
3. Stops the stack (`down`, never `-v`).
4. Deletes everything in `demo/.data/azurite` and copies the snapshot into it,
   inside one-off `azurite` containers. The snapshot itself is not changed, so
   you can restore it again and again.
5. Starts the stack as `up` does, without the smoke step, so the API starts
   fresh on the restored data.
6. Signs in with `BUTLER_DEMO_PIN`, once, and changes the dataset id
   (`POST /api/demo/dataset/regenerate`, organizer only).
7. Checks that the dataset id changed and prints
   `Dataset: <snapshot id> -> <new id>`.

After a restore:

- The organizer signs in with the PIN again: the restart dropped every
  organizer session.
- A tablet paired after the snapshot was taken pairs again: its hub-device
  token is not in the restored data. Tablets paired before it stay paired.
- The new dataset id tells the hub to drop its offline cache and its queue of
  unsent writes (#100). A hub that reconnects in the few seconds between the
  stack start and the id change can still replay taps queued before the
  restore (#361), so keep tablets closed or offline during a restore.

`snapshots` lists every snapshot, newest first, with the local date and time
it was taken (`YYYY-MM-DD HH:MM`).

There is no delete command. On Linux the snapshot folders are owned by root
(Azurite writes its data as root), so delete one with sudo:

```bash
sudo rm -rf demo/.data/snapshots/<name>   # Linux
rm -rf demo/.data/snapshots/<name>        # macOS / Windows (Docker Desktop)
```

## Wipe the demo data

To start from an empty store instead, use `reset` above for a seeded one, or
wipe by hand. Stop the stack, then delete the data folder. Azurite writes it
as root, so on Linux use sudo:

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

- Organizer session: the PIN token lives only in the API's memory and the
  hub's memory. Reloading the hub, or restarting the API (`down` then `up`),
  signs the organizer out, but a reload keeps the hub paired (#188), so only
  the organizer has to sign in again. The token expires after 15 minutes
  without use, and 5 wrong PINs lock sign-in for 60 s.

- Port 5108: the API is published on `127.0.0.1:5108`, which is also the
  port the in-memory quick loop documented in `.workspace/` binds `dotnet run`
  to. Stop a locally running API before `up`, or `up` fails with "port is
  already allocated".

- Port 10012: Azurite's Table port is published on `127.0.0.1:10012` (loopback
  only, never `0.0.0.0`) so the smoke step can read the Rooms table. 10012,
  not Azurite's usual 10002, so it does not clash with an Azurite that
  `Start-LocalSession` runs on 10002. If something else holds 10012, `up`
  fails with "port is already allocated".

- Smoke sign-in: the smoke step signs the organizer in with the PIN on every
  `up` and never signs out. The token is not used again and expires after 15
  minutes without use. A wrong PIN in the smoke step is a single failed
  attempt, not one per test.
