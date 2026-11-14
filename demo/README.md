# Butler demo stack

A local, persistent demo of Butler: Azurite (Table storage), the Butler API and
the hub PWA served by Caddy, all started with one Docker Compose command.

| Service | Image | What it does |
| --- | --- | --- |
| `azurite` | `mcr.microsoft.com/azure-storage/azurite:3.35.0` | Table storage, data kept in `demo/.data/azurite` |
| `api` | `butler-api:demo` (built from `Butler.API/`) | The Butler API in the `Demo` environment |
| `web` | `caddy:2.10.2-alpine` | Serves the hub PWA export on port 8080 and proxies `/api/*` to the API |

## Demo CLI

Two scripts drive the stack: `demo/demo.sh` (bash, Linux and macOS) and
`demo/demo.ps1` (PowerShell 7, Windows, Linux and macOS). They take the same
subcommands, print the same text and work from any directory. Both run every
command against the one compose file, `demo/docker-compose.yml`.

```bash
demo/demo.sh up        # build the hub export if needed, start, wait for healthy
demo/demo.sh status    # container health, hub URL and dataset id
demo/demo.sh logs -f api
demo/demo.sh down      # stop; data in demo/.data/azurite is kept
demo/demo.sh share     # HTTPS URL + QR code for a tablet on your tailnet
demo/demo.sh unshare   # stop sharing; localhost:8080 keeps working
```

PowerShell 7:

```powershell
pwsh demo/demo.ps1 up          # or ./demo/demo.ps1 up from a pwsh prompt
pwsh demo/demo.ps1 status
pwsh demo/demo.ps1 logs -f api
pwsh demo/demo.ps1 down
pwsh demo/demo.ps1 share
pwsh demo/demo.ps1 unshare
```

| Command | What it does |
| --- | --- |
| `demo.sh up` | Builds `Butler.UI/dist` when it is missing or older than the `Butler.UI` sources (running `npm ci` first if `node_modules` is missing or stale, and setting `EXPO_PUBLIC_API_BASE_URL=/api` for the build), starts the stack, recreates `web` after a rebuild, and returns only when every service reports healthy. |
| `demo.sh down` | Stops the stack. The Azurite data in `demo/.data/azurite` is kept. |
| `demo.sh status` | Shows each container's state and health, the hub URL `http://localhost:8080` and the dataset id. |
| `demo.sh logs` | Shows the stack logs. Extra arguments go to `docker compose logs` (for example `logs -f api`). |
| `demo.sh share` | Checks that Tailscale is installed and logged in, runs `tailscale serve --bg 8080`, and prints the hub's `https://<host>.<tailnet>.ts.net` URL and a terminal QR code of it. Stops with a message and a non-zero exit if Tailscale is missing, logged out, or has no HTTPS name. See [Connecting a tablet](#connecting-a-tablet). |
| `demo.sh unshare` | Removes only the `/` handler `share` added (`tailscale serve --https=443 --set-path=/ off`); other serve handlers on 443 are kept. The hub stays on `http://localhost:8080`. |

Running a script with no subcommand, or with one it does not know, prints this
list and exits non-zero. The `demo.ps1` commands are the same. The manual
sections below are the fallback when you want to run the steps yourself.

## Prerequisites

- Docker Desktop (or Docker Engine with the Compose v2 plugin on Linux).
- Node 22 (the active LTS) to build the hub export.
- PowerShell 7 to use `demo/demo.ps1` (bash is enough for `demo/demo.sh`).
- Optional, for `share`: Tailscale 1.52 or later (older versions use a
  different `tailscale serve` syntax).
- Optional, for `share`: `qrencode` to print the QR code offline. Without it,
  `share` uses `npx` to download `qrcode-terminal` from the npm registry.

## Build the hub export

`demo.sh up` does this for you when the export is missing or out of date.

The `web` service serves the export from `Butler.UI/dist`, which is built on
the host. Build it once, and again after any UI change, with the API base set
to `/api` so the hub calls the API on its own origin:

```bash
cd Butler.UI
npm ci
EXPO_PUBLIC_API_BASE_URL=/api npm run build:web
cd ..
```

PowerShell:

```powershell
cd Butler.UI
npm ci
$env:EXPO_PUBLIC_API_BASE_URL = '/api'; npm run build:web
cd ..
```

Expo inlines `EXPO_PUBLIC_*` values when it bundles, so the variable must be
set in the shell that runs the build. Without it the hub calls
`http://localhost:5108` directly, a different origin, and the browser blocks
those calls with CORS errors.

If a rebuild still calls `localhost:5108`, Metro served a cached bundle. Clear
it once with
`npx expo export --platform web --clear && node scripts/pwa-export.js dist`
(variable still set).

If `Butler.UI/dist` is missing, `up` fails with a bind-mount error rather than
serving an empty site.

A build replaces the `dist` folder, so if the stack is already running,
recreate `web` afterwards or Caddy keeps serving the old folder:
`docker compose -f demo/docker-compose.yml up -d --force-recreate web`.

## Start the stack

`demo.sh up` (or `demo.ps1 up`) runs this and waits until every service is
healthy. To run it by hand, from the repo root:

```bash
docker compose -f demo/docker-compose.yml up -d --build
```

`--build` rebuilds the API image so it always matches your checkout.

## URLs

| What | URL |
| --- | --- |
| Hub (PWA) | http://localhost:8080 |
| API health (through the proxy) | http://localhost:8080/api/health |
| System ping (through the proxy) | http://localhost:8080/api/api/system/ping |
| Dataset id (through the proxy) | http://localhost:8080/api/api/system/dataset |
| API health (direct, for debugging) | http://localhost:5108/health |

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

To check it end to end, `demo/ci/check-household-flow.cjs` (run by demo-ci)
opens the hub in a headless browser, creates a household through the setup
screens and waits for the hub to read it back. It fails if any API call is not
under `http://localhost:8080/api/`, any request leaves that origin, or the
console shows a CORS error. It needs Playwright, which is not a repo
dependency:

```bash
npm install --no-save --prefix /tmp/pw playwright@1.64.1
/tmp/pw/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/pw/node_modules node demo/ci/check-household-flow.cjs http://localhost:8080/
```

## Connecting a tablet

The hub is an offline-first PWA, and its service worker only registers in a
secure context: HTTPS, or `http://localhost`. On a tablet,
`http://<lan-ip>:8080` loads, but the service worker never registers, so the
hub silently stops working the moment the tablet goes offline. Use one of the
three options below. Checking them on real devices is tracked in #132.

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

## Stop the stack

`demo.sh down` (or `demo.ps1 down`) runs this. By hand:

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

- Port 5108: the API is published on `127.0.0.1:5108`, which is also the
  port the local dev workspace (`.workspace/`) binds `dotnet run` to. Stop a
  locally running API before `up`, or `up` fails with "port is already
  allocated".
