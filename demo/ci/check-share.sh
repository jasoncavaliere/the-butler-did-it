#!/usr/bin/env bash
# Checks the demo CLI's share and unshare subcommands (#101) against a stub
# tailscale, through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-share.sh static|stack
#   static - no stack needed (docker must be on PATH, since both scripts check
#            for it first). Covers Tailscale missing (AC1), not logged in
#            (AC2), daemon down, no HTTPS name, serve failing, the serve call,
#            URL and QR code (AC3-AC5), and unshare (AC6). Run it once without
#            qrencode (the npx qrcode-terminal fallback) and once with it.
#   stack  - needs the stack up (demo/demo.sh up). After share, and again
#            after unshare, Caddy still serves the hub, its service worker and
#            the API on http://localhost:8080 (AC7).
#
# Every case runs both scripts and fails unless their output (stdout and
# stderr together), exit code and stub tailscale calls are identical.
# Needs bash, pwsh (PowerShell 7) and, for stack, curl and jq.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  static|stack) ;;
  *)
    echo "Usage: bash demo/ci/check-share.sh static|stack" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HUB_URL="http://localhost:8080"
NAME="demo-desktop.example-tailnet.ts.net"
URL="https://$NAME"

S1='Tailscale is not installed (no tailscale command found). Install it from https://tailscale.com/download and sign in.'
S3='Tailscale reports no HTTPS name for this machine. Enable MagicDNS and HTTPS Certificates on the DNS page of the Tailscale admin console, then run share again.'
S4='Sharing http://localhost:8080 on your tailnet (tailscale serve --bg 8080) ...'
S5="tailscale serve failed. On Linux, allow your user once with 'sudo tailscale set --operator=\$USER', then run share again."
S6="Hub on your tailnet: $URL"
S7='Scan this on the tablet (it must be signed in to the same tailnet):'
S8='Could not print a QR code (install qrencode, or let npx reach the npm registry). Type the URL above on the tablet instead.'
S9='The tablet needs the stack running (up). Run unshare to stop sharing.'
S10='Tailscale sharing is off. The hub is still at http://localhost:8080.'
S11="Could not turn off tailscale serve (was it on?). Check with 'tailscale serve status'."
s2() { echo "Tailscale is installed but not logged in (backend state: $1). Run 'tailscale up' or sign in from the Tailscale app, then run share again."; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export TS_STUB_LOG="$WORK/tailscale.log"
: > "$TS_STUB_LOG"

# A stub tailscale CLI: logs its arguments, prints `status --json` shaped like
# the real one (indented, CertDomains as a multi-line array, a peer with its
# own DNSName), and fails on any call the scripts should not make.
cat > "$STUB_DIR/tailscale" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${TS_STUB_LOG:-/dev/null}"
state="${TS_STUB_STATE:-Running}"
case "$*" in
  "status --json")
    if [ "$state" = "daemon-down" ]; then
      echo "failed to connect to local tailscaled; it doesn't appear to be running" >&2
      exit 1
    fi
    if [ "$state" = "Running" ] && [ "${TS_STUB_CERT:-yes}" != "no" ]; then
      certs='[
    "demo-desktop.example-tailnet.ts.net"
  ]'
    else
      certs='null'
    fi
    cat <<JSON
{
  "Version": "1.76.6-stub",
  "BackendState": "$state",
  "Self": {
    "HostName": "demo-desktop",
    "DNSName": "demo-desktop.example-tailnet.ts.net.",
    "Online": true
  },
  "CertDomains": $certs,
  "Peer": {
    "nodekey:0123456789abcdef": {
      "HostName": "other-box",
      "DNSName": "other-box.example-tailnet.ts.net.",
      "Online": true
    }
  }
}
JSON
    ;;
  "serve --bg 8080")
    rc="${TS_STUB_SERVE_RC:-0}"
    if [ "$rc" -ne 0 ]; then
      echo "stub serve: Access denied: serve config denied" >&2
      exit "$rc"
    fi
    echo "stub serve: https://demo-desktop.example-tailnet.ts.net/ proxy http://127.0.0.1:8080"
    ;;
  "serve --https=443 off")
    exit "${TS_STUB_OFF_RC:-0}"
    ;;
  *)
    echo "stub tailscale: unexpected arguments: $*" >&2
    exit 64
    ;;
esac
STUB
chmod +x "$STUB_DIR/tailscale"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# run_both <label> <args...>: runs demo.sh and demo.ps1 with the same args and
# environment, requires identical output, exit code and stub log, and leaves
# them in OUT, RC and LOG.
run_both() {
  local label="$1" sh_out sh_rc sh_log ps_out ps_rc ps_log
  shift
  : > "$TS_STUB_LOG"
  set +e
  sh_out="$(bash "$REPO_ROOT/demo/demo.sh" "$@" 2>&1)"
  sh_rc=$?
  set -e
  sh_log="$(cat "$TS_STUB_LOG")"
  : > "$TS_STUB_LOG"
  set +e
  ps_out="$(pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" "$@" 2>&1)"
  ps_rc=$?
  set -e
  ps_log="$(cat "$TS_STUB_LOG")"
  echo "== $label: demo.sh exit=$sh_rc demo.ps1 exit=$ps_rc"
  printf '%s\n' "$sh_out"
  if [ "$sh_out" != "$ps_out" ]; then
    diff <(printf '%s\n' "$sh_out") <(printf '%s\n' "$ps_out") || true
    fail "$label: demo.sh and demo.ps1 print different output"
  fi
  [ "$sh_rc" -eq "$ps_rc" ] || fail "$label: exit codes differ ($sh_rc vs $ps_rc)"
  if [ "$sh_log" != "$ps_log" ]; then
    diff <(printf '%s\n' "$sh_log") <(printf '%s\n' "$ps_log") || true
    fail "$label: demo.sh and demo.ps1 make different tailscale calls"
  fi
  OUT="$sh_out"
  RC="$sh_rc"
  LOG="$sh_log"
}

expect_rc() { [ "$RC" -eq "$2" ] || fail "$1: expected exit $2, got $RC"; }
expect_out() {
  if [ "$OUT" != "$2" ]; then
    diff <(printf '%s\n' "$2") <(printf '%s\n' "$OUT") || true
    fail "$1: unexpected output"
  fi
}
expect_log() {
  if [ "$LOG" != "$2" ]; then
    diff <(printf '%s\n' "$2") <(printf '%s\n' "$LOG") || true
    fail "$1: unexpected tailscale calls"
  fi
}
expect_line() { printf '%s\n' "$OUT" | grep -qxF -- "$2" || fail "$1: missing line '$2'"; }
expect_no() { if printf '%s\n' "$OUT" | grep -qF -- "$2"; then fail "$1: output must not contain '$2'"; fi; }

# Runs both scripts with the stub tailscale first on PATH.
with_stub() { PATH="$STUB_DIR:$PATH" run_both "$@"; }

share_ok() {
  with_stub "share (Running)" share
  expect_rc "share" 0
  # AC3: exactly one serve call, the documented one.
  expect_log "share" "$(printf '%s\n' 'status --json' 'serve --bg 8080')"
  expect_line "share" "$S4"
  # AC4: the https://<host>.<tailnet>.ts.net URL, from CertDomains (not a peer).
  expect_line "share" "$S6"
  expect_no "share" "other-box"
  expect_line "share" "$S7"
  expect_line "share" "$S9"
  # AC5: a terminal QR code, and never the could-not-print hint.
  expect_no "share" "Could not print a QR code"
  if command -v qrencode >/dev/null 2>&1; then
    local qr
    qr="$(qrencode -t ansiutf8 "$URL")"
    case "$OUT" in
      *"$qr"*) echo "QR code matches qrencode -t ansiutf8" ;;
      *) fail "share: output does not contain the qrencode QR code of $URL" ;;
    esac
  else
    printf '%s' "$OUT" | grep -qF $'\033[40m' || fail "share: no qrcode-terminal QR code in the output"
    echo "QR code printed by npx qrcode-terminal"
  fi
}

unshare_ok() {
  with_stub "unshare" unshare
  expect_rc "unshare" 0
  expect_log "unshare" "serve --https=443 off"
  expect_out "unshare" "$S10"
}

check_hub() {
  local label="$1"
  echo "-- $label: Caddy on :8080"
  curl -fsS "$HUB_URL/" | grep -qi '<html' || fail "$label: $HUB_URL/ is not the hub"
  curl -fsS "$HUB_URL/sw.js" | grep -qF 'butler-precache:begin' || fail "$label: sw.js is not served"
  curl -fsS "$HUB_URL/api/health" | jq -e '.status == "ok"' > /dev/null || fail "$label: /api/health is not ok"
  # tailscale serve forwards requests for the ts.net name to :8080; the :8080
  # site matches any Host.
  curl -fsS -H "Host: $NAME" "http://127.0.0.1:8080/" | grep -qi '<html' || fail "$label: :8080 does not serve the ts.net Host"
  local health
  health="$(docker compose -f "$REPO_ROOT/demo/docker-compose.yml" ps --format '{{.Service}} {{.Health}}')"
  echo "$health"
  [ "$(printf '%s\n' "$health" | grep -c ' healthy$' || true)" -eq 3 ] || fail "$label: not every service is healthy"
}

if [ "$mode" = "static" ]; then
  # The not-installed cases need a machine without Tailscale.
  if command -v tailscale >/dev/null 2>&1 || [ -e /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    fail "a real tailscale is installed here; run this check on a machine without it"
  fi
  command -v docker >/dev/null 2>&1 || fail "docker must be on PATH (both scripts check for it first)"

  # AC1: not installed.
  run_both "share (not installed)" share
  expect_rc "share (not installed)" 1
  expect_out "share (not installed)" "$S1"
  run_both "unshare (not installed)" unshare
  expect_rc "unshare (not installed)" 1
  expect_out "unshare (not installed)" "$S1"

  # AC2: installed but not logged in; serve is never called.
  TS_STUB_STATE=NeedsLogin with_stub "share (NeedsLogin)" share
  expect_rc "share (NeedsLogin)" 1
  expect_out "share (NeedsLogin)" "$(s2 NeedsLogin)"
  expect_log "share (NeedsLogin)" "status --json"

  # tailscaled not running: status --json fails.
  TS_STUB_STATE=daemon-down with_stub "share (daemon down)" share
  expect_rc "share (daemon down)" 1
  expect_out "share (daemon down)" "$(s2 unavailable)"
  expect_log "share (daemon down)" "status --json"

  # Logged in, but MagicDNS / HTTPS certificates are off.
  TS_STUB_CERT=no with_stub "share (no CertDomains)" share
  expect_rc "share (no CertDomains)" 1
  expect_out "share (no CertDomains)" "$S3"
  expect_log "share (no CertDomains)" "status --json"

  # serve fails (for example, not an operator on Linux).
  TS_STUB_SERVE_RC=3 with_stub "share (serve fails)" share
  expect_rc "share (serve fails)" 3
  expect_line "share (serve fails)" "$S4"
  expect_line "share (serve fails)" "$S5"
  expect_no "share (serve fails)" "Hub on your tailnet"
  expect_log "share (serve fails)" "$(printf '%s\n' 'status --json' 'serve --bg 8080')"

  # AC3 + AC4 + AC5.
  share_ok

  # A QR command that fails only prints the hint; share still succeeds.
  QR_FAIL_DIR="$WORK/qr-fail"
  mkdir -p "$QR_FAIL_DIR"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$QR_FAIL_DIR/qrencode"
  chmod +x "$QR_FAIL_DIR/qrencode"
  PATH="$QR_FAIL_DIR:$PATH" with_stub "share (QR command fails)" share
  expect_rc "share (QR command fails)" 0
  expect_out "share (QR command fails)" "$(printf '%s\n' "$S4" \
    'stub serve: https://demo-desktop.example-tailnet.ts.net/ proxy http://127.0.0.1:8080' \
    "$S6" "$S7" "$S8" "$S9")"

  # AC6.
  unshare_ok
  TS_STUB_OFF_RC=1 with_stub "unshare (fails)" unshare
  expect_rc "unshare (fails)" 1
  expect_out "unshare (fails)" "$S11"
  expect_log "unshare (fails)" "serve --https=443 off"
else
  # AC7: sharing does not change what Caddy serves on :8080.
  check_hub "before share"
  share_ok
  check_hub "after share"
  unshare_ok
  check_hub "after unshare"
fi

echo "check-share.sh $mode: all checks passed"
