#!/usr/bin/env bash
# Butler demo CLI (#102): one entry point for the local demo stack defined in
# demo/docker-compose.yml (Azurite + Butler.API + Caddy serving the hub).
#
# Usage: demo/demo.sh <command> [args]   (run from any directory)
#
# demo/demo.ps1 is the PowerShell 7 twin. Both scripts accept the same
# subcommands and print the same text, so keep every fixed string below
# byte-identical to the one in demo.ps1. See demo/README.md.
#
# Works with macOS's bash 3.2: no associative arrays, no mapfile.
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$DEMO_DIR")"
COMPOSE_FILE="$DEMO_DIR/docker-compose.yml"
# The services in docker-compose.yml (#190). Naming one of these narrows
# logs to the services named. Keep in step with the compose file and with
# $ComposeServices in demo.ps1 (demo/ci/check-logs-args.sh fails on drift).
COMPOSE_SERVICES="azurite api web"
# Bind-mounted at /app/logs in the api container (#107): its rolling log files.
LOGS_DIR="$DEMO_DIR/.data/logs"
UI_DIR="$REPO_ROOT/Butler.UI"
# The hub export's freshness marker. A failed build deletes it (#183), so the
# next up rebuilds instead of reporting a broken export as up to date.
EXPORT_MARKER="$UI_DIR/dist/index.html"
# The EXPO_PUBLIC_* values up builds the hub export with.
DEMO_API_BASE_URL=/api
DEMO_AUTH_PROVIDER=pin
# The household a hub with nothing stored opens (#316): the one demo reset seeds.
DEMO_HOUSEHOLD_ID=demo-household
# up writes this stamp after each successful build (#184), so an export built
# another way (for example by hand, without EXPO_PUBLIC_API_BASE_URL=/api) is
# rebuilt instead of served. demo.ps1 writes the same bytes: these three lines,
# LF only, with a final LF.
EXPORT_STAMP="$UI_DIR/dist/.demo-build-env"
EXPORT_STAMP_TEXT="EXPO_PUBLIC_API_BASE_URL=$DEMO_API_BASE_URL
EXPO_PUBLIC_AUTH_PROVIDER=$DEMO_AUTH_PROVIDER
EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=$DEMO_HOUSEHOLD_ID"
# Git-ignored; holds BUTLER_DEMO_PIN, the organizer PIN (#105). Compose reads it.
ENV_FILE="$DEMO_DIR/.env"

HUB_URL="http://localhost:8080"
DATASET_URL="$HUB_URL/api/api/system/dataset"
# reset (#98) signs the organizer in with the PIN, then seeds the demo household.
PIN_SIGN_IN_URL="$HUB_URL/api/auth/pin/sign-in"
SEED_URL="$HUB_URL/api/demo/seed"
# restore (#99) copies a snapshot back, then changes the dataset id through
# this organizer-only endpoint. Snapshots live in git-ignored demo/.data.
REGENERATE_URL="$HUB_URL/api/demo/dataset/regenerate"
SNAPSHOTS_DIR="$DEMO_DIR/.data/snapshots"
# A snapshot name: a letter or digit, then up to 63 letters, digits, '.', '_'
# or '-'. Kept in a variable so [[ =~ ]] works the same in bash 3.2.
SNAPSHOT_NAME_RE='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
WAIT_TIMEOUT=300

# The smoke step up runs once the stack is healthy (#103): the smoke suite,
# run with the host .NET SDK from Butler.API/ (so global.json applies), through
# the Caddy proxy. The trailing slash matters: without it, the suite's relative
# URLs drop /api. The storage string is the well-known public Azurite
# devstoreaccount1 key (not a secret, the same one docker-compose.yml gives
# the api), pointed at Azurite's loopback-only host port 10012.
SMOKE_BASE_URL="$HUB_URL/api/"
SMOKE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10012/devstoreaccount1;"
SMOKE_PROJECT="src/Butler.Api.SmokeTests/Butler.Api.SmokeTests.csproj"
# Liveness (read-only) and Endpoints (#92's Rooms round trip, in a throwaway
# smoke-rooms-<guid> household). Never Demo: the seeded household stays as is.
SMOKE_FILTER="Category=Liveness|Category=Endpoints"
SMOKE_LOGGER="console;verbosity=normal"
DEMO_READY="Demo ready: hub $HUB_URL | API $HUB_URL/api/health | Swagger http://localhost:5108/swagger"

# Subcommand registry, in usage order: one "name|description" per line.
# To add a subcommand: add a line here and a cmd_<name> function below (and
# the same entry and handler in demo.ps1, plus a row in demo/README.md).
COMMANDS="up|Build the hub export if needed, start the stack, wait until it is healthy and run the smoke suite
down|Stop the stack (data in demo/.data/azurite is kept)
reset|Delete the demo data, restart the stack, re-seed the demo household and change the dataset id
snapshot|Save a copy of the demo data in demo/.data/snapshots/<name> (stops Azurite while it copies)
restore|Replace the demo data with a snapshot, restart the stack and change the dataset id
snapshots|List the snapshots in demo/.data/snapshots with their dates
status|Show container health, the hub URL and the dataset id
logs|Follow the API and Caddy logs (--api: API only; extra arguments go to docker compose logs)
share|Share the hub on your tailnet over HTTPS (tailscale serve) and print its URL and a QR code
unshare|Turn off tailscale serve (the hub stays on http://localhost:8080)"

# Files and folders under Butler.UI/ that the hub export is built from.
UI_SOURCES="App.tsx index.ts app.json package.json package-lock.json tsconfig.json design-tokens.json src public assets scripts/pwa-export.js"

usage() {
  {
    echo "Usage: demo <command> [args]"
    echo ""
    echo "Commands:"
    local name desc
    while IFS='|' read -r name desc; do
      printf '  %-9s %s\n' "$name" "$desc"
    done <<EOF
$COMMANDS
EOF
  } >&2
}

is_command() {
  local name desc
  while IFS='|' read -r name desc; do
    if [ "$name" = "$1" ]; then
      return 0
    fi
  done <<EOF
$COMMANDS
EOF
  return 1
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# Prints the state of the hub export in Butler.UI/dist, checked in this order:
#   missing   - no dist/index.html.
#   stale     - a source file is newer than dist/index.html.
#   unstamped - up's build stamp (#184) is absent, older than dist/index.html,
#               or holds other settings (CRs and trailing newlines ignored).
#   fresh     - none of the above.
export_state() {
  local marker="$EXPORT_MARKER"
  if [ ! -f "$marker" ]; then
    echo "missing"
    return 0
  fi
  local paths=() src
  for src in $UI_SOURCES; do
    if [ -e "$UI_DIR/$src" ]; then
      paths+=("$UI_DIR/$src")
    fi
  done
  if [ "${#paths[@]}" -gt 0 ] && [ -n "$(find "${paths[@]}" -type f -newer "$marker" -print -quit)" ]; then
    echo "stale"
    return 0
  fi
  if [ ! -f "$EXPORT_STAMP" ] || [ "$marker" -nt "$EXPORT_STAMP" ] \
    || [ "$(tr -d '\r' < "$EXPORT_STAMP")" != "$EXPORT_STAMP_TEXT" ]; then
    echo "unstamped"
    return 0
  fi
  echo "fresh"
}

# npm ci is needed when node_modules is missing or older than the lockfile.
needs_npm_ci() {
  local installed="$UI_DIR/node_modules/.package-lock.json"
  [ ! -d "$UI_DIR/node_modules" ] && return 0
  [ ! -f "$installed" ] && return 0
  [ "$UI_DIR/package-lock.json" -nt "$installed" ] && return 0
  return 1
}

build_export() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found. Install Node 22 to build the hub export." >&2
    return 1
  fi
  local rc=0
  if needs_npm_ci; then
    echo "Installing Butler.UI dependencies (npm ci) ..."
    (cd "$UI_DIR" && npm ci --no-audit --no-fund --loglevel=error) || rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "Hub export build failed." >&2
      return "$rc"
    fi
  fi
  # Expo inlines EXPO_PUBLIC_* at bundle time; /api keeps the hub same-origin,
  # and pin makes the hub sign the organizer in on the PIN pad (#105).
  # EXPO_PUBLIC_BUILD_SHA stamps the hub with the same git SHA as the API (#126).
  # EXPO_PUBLIC_DEMO_HOUSEHOLD_ID opens the seeded demo household when nothing is stored (#316).
  # The stamp is written only after a successful build (#184).
  rm -f "$EXPORT_STAMP"
  (cd "$UI_DIR" && EXPO_PUBLIC_API_BASE_URL="$DEMO_API_BASE_URL" EXPO_PUBLIC_AUTH_PROVIDER="$DEMO_AUTH_PROVIDER" \
    EXPO_PUBLIC_DEMO_HOUSEHOLD_ID="$DEMO_HOUSEHOLD_ID" EXPO_PUBLIC_BUILD_SHA="${BUTLER_BUILD_SHA:-}" npm run build:web) || rc=$?
  if [ "$rc" -ne 0 ]; then
    # build:web runs expo export and then pwa-export.js, so a failure in the
    # second step leaves a new index.html behind. Delete it (#183): the export
    # is then missing, and the next up rebuilds it.
    rm -f "$EXPORT_MARKER"
    echo "Hub export build failed." >&2
    return "$rc"
  fi
  printf '%s\n' "$EXPORT_STAMP_TEXT" > "$EXPORT_STAMP"
}

# True when demo/.data/logs exists and anyone may write and enter it, so the
# API container can use it even though this user cannot chmod it.
logs_dir_open() {
  [ -d "$LOGS_DIR" ] && [ -n "$(find "$LOGS_DIR" -maxdepth 0 -perm -0003 2>/dev/null)" ]
}

# The API container runs as a non-root user, so on a Linux engine it cannot
# write a bind-mount folder that Docker creates as root. Create it first and
# make it world-writable. A folder that is already world-writable is fine even
# when this user cannot chmod it (it is root-owned). Otherwise up warns on
# stdout (#193) that the API file log is off and prints the command that
# fixes it: the user takes back ownership of demo/.data. The stack still
# starts, the exit code is unchanged, and the script never runs sudo.
ensure_logs_dir() {
  if mkdir -p "$LOGS_DIR" 2>/dev/null && { chmod 0777 "$LOGS_DIR" 2>/dev/null || logs_dir_open; }; then
    return 0
  fi
  echo 'WARNING: The API file log is off. up could not make demo/.data/logs writable for the API container.'
  echo 'demo/.data is probably owned by root from an earlier run. The stack still starts, without the API log files.'
  echo 'To fix it, run down, then this from the repo root, then up again:'
  echo '  sudo chown -R "$(id -u):$(id -g)" demo/.data'
  return 0
}

# Prints the organizer PIN (#105): BUTLER_DEMO_PIN from the shell if set,
# otherwise the last BUTLER_DEMO_PIN= line of demo/.env (quotes stripped).
demo_pin() {
  if [ -n "${BUTLER_DEMO_PIN:-}" ]; then
    printf '%s\n' "$BUTLER_DEMO_PIN"
    return 0
  fi
  [ -f "$ENV_FILE" ] || return 0
  sed -n 's/^[[:space:]]*BUTLER_DEMO_PIN[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" \
    | tail -n 1 | tr -d '\r' | sed -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//"
}

# The Demo API refuses to start without a 4-6 digit PIN, so fail fast, before
# npm or docker run.
check_pin() {
  case "$(demo_pin)" in
    [0-9][0-9][0-9][0-9] | [0-9][0-9][0-9][0-9][0-9] | [0-9][0-9][0-9][0-9][0-9][0-9])
      return 0
      ;;
  esac
  echo "demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md." >&2
  return 1
}

# Build version (#126): export the git short SHA as BUTLER_BUILD_SHA, unless the
# shell already set it. Compose passes it to the API image build and
# build_export stamps it into the hub. Outside a git checkout it stays empty,
# and both report "dev". Prints nothing.
ensure_build_sha() {
  BUTLER_BUILD_SHA="${BUTLER_BUILD_SHA:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || true)}"
  export BUTLER_BUILD_SHA
}

# The smoke step needs the host .NET SDK (#103), so fail fast, before npm or
# docker run. A dotnet with no SDK (a runtime-only install) counts as none.
check_dotnet_sdk() {
  local sdks=""
  if command -v dotnet >/dev/null 2>&1; then
    sdks="$(dotnet --list-sdks 2>/dev/null)" || sdks=""
  fi
  case "$sdks" in
    *[![:space:]]*)
      return 0
      ;;
  esac
  echo "The .NET SDK is required for the smoke step that up runs, and none was found. Install the .NET 10 SDK, then run up again. See demo/README.md." >&2
  return 1
}

# Builds the hub export if needed, starts the stack and waits until every
# service is healthy. up runs the smoke suite after it; reset does not.
start_stack() {
  local state rebuilt=0 rc=0
  ensure_build_sha
  state="$(export_state)"
  case "$state" in
    fresh)
      echo "Hub export is up to date (Butler.UI/dist)."
      ;;
    missing)
      echo "Hub export is missing; building Butler.UI/dist ..."
      build_export || return $?
      rebuilt=1
      ;;
    stale)
      echo "Hub export is older than its sources; building Butler.UI/dist ..."
      build_export || return $?
      rebuilt=1
      ;;
    unstamped)
      echo "Hub export was not built with the demo settings; building Butler.UI/dist ..."
      build_export || return $?
      rebuilt=1
      ;;
  esac

  ensure_logs_dir
  echo "Starting the demo stack ..."
  compose up -d --build --wait --wait-timeout "$WAIT_TIMEOUT" || rc=$?
  if [ "$rc" -eq 0 ] && [ "$rebuilt" -eq 1 ]; then
    # A build replaces the dist folder; a running Caddy keeps serving the old one.
    echo "Recreating web to serve the new export ..."
    compose up -d --no-deps --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" web || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "Demo stack did not become healthy. Run the logs command to see why." >&2
    return "$rc"
  fi
  echo "Demo stack is up and healthy: $HUB_URL"
}

# The smoke step (#103): runs the Liveness and Endpoints smoke tests against
# the running stack. Their output streams through and is kept in a temp log;
# a failure names each failed test (in order, once each) on stderr. The
# settings go to dotnet only through its environment, so the PIN is never in
# argv or printed.
run_smoke() {
  local log rc=0 name
  log="$(mktemp "${TMPDIR:-/tmp}/butler-demo-smoke.XXXXXX")" || return 1
  echo "Running the smoke suite against $SMOKE_BASE_URL ..."
  (
    cd "$REPO_ROOT/Butler.API" &&
      BUTLER_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
      BUTLER_SMOKE_STORAGE_CONNECTION_STRING="$SMOKE_STORAGE_CONNECTION_STRING" \
      BUTLER_SMOKE_ORGANIZER_PIN="$(demo_pin)" \
      MSBUILDTERMINALLOGGER=off \
      DOTNET_NOLOGO=1 \
      dotnet test "$SMOKE_PROJECT" --filter "$SMOKE_FILTER" --logger "$SMOKE_LOGGER"
  ) 2>&1 | tee "$log" || rc=$?
  if [ "$rc" -eq 0 ]; then
    rm -f "$log"
    echo "$DEMO_READY"
    return 0
  fi
  # VSTest prints "  Failed <test name> [<duration>]" once per failed test.
  while IFS= read -r name; do
    if [ -n "$name" ]; then
      echo "Smoke check failed: $name" >&2
    fi
  done <<EOF
$(tr -d '\r' < "$log" | sed -n 's/^[[:space:]]*Failed \(.*\) \[[^][]*\]$/\1/p' | awk '!seen[$0]++')
EOF
  rm -f "$log"
  echo "Demo is not ready: the smoke suite failed. Run the logs command to see why." >&2
  return 1
}

cmd_up() {
  check_pin || return 1
  check_dotnet_sdk || return 1
  start_stack || return $?
  run_smoke
}

cmd_down() {
  echo "Stopping the demo stack (data in demo/.data/azurite is kept) ..."
  # Never -v: the Azurite data must survive.
  compose down || return $?
  echo "Demo stack stopped."
}

# Prints the API's current dataset id, or nothing when the API (or curl) is
# not there. No jq: sed picks the one field out of {"datasetId":"..."}.
dataset_id() {
  local dataset=""
  if command -v curl >/dev/null 2>&1; then
    dataset="$(curl -fsS --max-time 3 "$DATASET_URL" 2>/dev/null \
      | sed -n 's/.*"datasetId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || dataset=""
  fi
  printf '%s\n' "$dataset"
}

# reset (#98), snapshot and restore (#99) touch the demo data, so they run
# only against the local demo stack: a local Docker engine, the butler-demo
# compose project, an api that stores its data in the azurite service, and
# Azurite's data in demo/.data/azurite. $1 is the verb for the message. Prints
# why to stderr and returns 1 otherwise. The rendered compose config is never
# printed: it holds BUTLER_DEMO_PIN from demo/.env.
check_local_target() {
  local verb="$1" endpoint="" config="" reason=""
  endpoint="${DOCKER_HOST:-}"
  if [ -z "$endpoint" ]; then
    endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || endpoint=""
  fi
  case "$endpoint" in
    unix://* | npipe://*) ;;
    *) reason="the Docker engine is not local (${endpoint:-unknown})" ;;
  esac
  if [ -z "$reason" ]; then
    if config="$(compose config 2>/dev/null)"; then
      # Here-strings, not pipes: under pipefail, grep -q exiting early can
      # fail the writer of a pipe (#265).
      config="$(tr -d '\r' <<<"$config")"
      if ! grep -qx 'name: butler-demo' <<<"$config"; then
        reason="the compose project is not butler-demo"
      elif ! grep -qE '^ +Storage__ConnectionString: .*;TableEndpoint=http://azurite:10002/devstoreaccount1;' <<<"$config"; then
        reason="the api does not use the azurite service for storage"
      elif ! grep -qE '^ +source: .*[/\\]demo[/\\]\.data[/\\]azurite$' <<<"$config"; then
        reason="the Azurite data folder is not demo/.data/azurite"
      fi
    else
      reason="demo/docker-compose.yml could not be rendered"
    fi
  fi
  if [ -n "$reason" ]; then
    echo "Refusing to $verb: $reason. $verb only runs against the local demo stack." >&2
    return 1
  fi
  return 0
}

# reset (#98): stop the stack, delete the Azurite data, start it again, sign
# in with the PIN and seed the demo household, which also changes the dataset
# id. Asks nothing. Takes no arguments and, like up and down, ignores extras.
cmd_reset() {
  local old new token="" rc=0
  check_pin || return 1
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl was not found. Install curl to run reset." >&2
    return 1
  fi
  check_local_target reset || return 1
  old="$(dataset_id)"
  [ -z "$old" ] && old="unavailable"

  echo "Stopping the demo stack ..."
  # Never -v. Azurite saves its store on SIGINT, so delete only after down.
  compose down || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not stop the demo stack. Nothing was deleted." >&2
    return "$rc"
  fi
  # Delete inside the azurite container: on Linux the files are root-owned,
  # and demo/.data/logs must survive.
  echo "Deleting the demo data in demo/.data/azurite ..."
  compose run --rm --no-deps -T --entrypoint find azurite /data -mindepth 1 -delete || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not delete the demo data in demo/.data/azurite." >&2
    return "$rc"
  fi

  start_stack || return $?

  # Sign in once, after up (a restart drops PIN tokens), with no retry: five
  # wrong PINs lock sign-in. The PIN goes to curl on stdin, not in argv.
  echo "Signing in with the demo PIN ..."
  token="$(printf '{"pin":"%s"}' "$(demo_pin)" \
    | curl -fsS --max-time 30 -X POST "$PIN_SIGN_IN_URL" -H 'Content-Type: application/json' --data-binary @- 2>/dev/null \
    | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || token=""
  if [ -z "$token" ]; then
    echo "PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run reset again." >&2
    return 1
  fi

  echo "Seeding the demo household ..."
  if ! curl -fsS --max-time 120 -o /dev/null -X POST "$SEED_URL" -H "Authorization: Bearer $token" -d '' 2>/dev/null; then
    echo "Seeding the demo household failed. Run the logs command to see why." >&2
    return 1
  fi

  new="$(dataset_id)"
  if [ -z "$new" ] || [ "$new" = "$old" ]; then
    echo "The dataset id did not change after the reset. Run the logs command to see why." >&2
    return 1
  fi
  echo "Dataset: $old -> $new"
  echo "Demo reset complete: the demo household is seeded at $HUB_URL"
  echo "Sign in with the PIN and pair the tablet again: the reset cleared organizer sessions and hub pairings."
}

# snapshot and restore (#99) take exactly one name. $1 is the verb; the rest
# are the arguments. Prints the usage or the name rule to stderr and returns 2
# otherwise. The rule also keeps the name safe as a container path.
check_snapshot_name() {
  local verb="$1"
  shift
  if [ "$#" -ne 1 ]; then
    echo "Usage: demo $verb <name>" >&2
    return 2
  fi
  if ! [[ $1 =~ $SNAPSHOT_NAME_RE ]]; then
    echo "Snapshot names use letters, digits, '.', '_' and '-', start with a letter or digit, and are at most 64 characters." >&2
    return 2
  fi
  return 0
}

# Created on the host before docker mounts it, so docker does not create a
# root-owned mount point.
ensure_snapshots_dir() {
  if ! mkdir -p "$SNAPSHOTS_DIR" 2>/dev/null; then
    echo "Could not create demo/.data/snapshots." >&2
    return 1
  fi
  return 0
}

# snapshot (#99): stop only Azurite (it saves its store on SIGINT), copy
# demo/.data/azurite to demo/.data/snapshots/<name>, start Azurite again. The
# api and web keep running, so the organizer stays signed in. The copy runs
# inside an azurite container: on Linux the files are root-owned. cp -R, not
# -a, so the new folder's date is the snapshot time (snapshots lists it).
cmd_snapshot() {
  local name rc=0
  check_snapshot_name snapshot "$@" || return $?
  name="$1"
  if [ -e "$SNAPSHOTS_DIR/$name" ]; then
    echo "Snapshot $name already exists in demo/.data/snapshots. Pick another name, or delete that folder first." >&2
    return 1
  fi
  check_local_target snapshot || return 1
  ensure_snapshots_dir || return 1

  echo "Stopping Azurite ..."
  compose stop azurite || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not stop Azurite. No snapshot was taken." >&2
    return "$rc"
  fi

  echo "Copying demo/.data/azurite to demo/.data/snapshots/$name ..."
  local copy_rc=0
  compose run --rm --no-deps -T -v "$SNAPSHOTS_DIR:/snapshots" --entrypoint cp azurite -R /data "/snapshots/$name" || copy_rc=$?
  if [ "$copy_rc" -ne 0 ]; then
    echo "Could not copy demo/.data/azurite to demo/.data/snapshots/$name." >&2
    # Best effort: drop the partial copy, then still start Azurite.
    compose run --rm --no-deps -T -v "$SNAPSHOTS_DIR:/snapshots" --entrypoint rm azurite -rf "/snapshots/$name" || true
  fi

  echo "Starting Azurite ..."
  compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" azurite || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Azurite did not become healthy. Run the logs command to see why." >&2
    return "$rc"
  fi
  if [ "$copy_rc" -ne 0 ]; then
    return "$copy_rc"
  fi
  echo "Snapshot saved: demo/.data/snapshots/$name"
}

# restore (#99): stop the stack (down, so the api container is recreated and
# provisions its tables against the restored data), replace demo/.data/azurite
# with the snapshot inside an azurite container, start the stack as reset
# does, sign in with the PIN and change the dataset id, so the hub drops its
# offline cache. The snapshot itself is never changed, so restore repeats.
cmd_restore() {
  local name snap new returned body token="" rc=0
  check_snapshot_name restore "$@" || return $?
  name="$1"
  check_pin || return 1
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl was not found. Install curl to run restore." >&2
    return 1
  fi
  if [ ! -d "$SNAPSHOTS_DIR/$name" ]; then
    echo "No snapshot named $name in demo/.data/snapshots. Run the snapshots command to list them." >&2
    return 1
  fi
  check_local_target restore || return 1

  echo "Stopping the demo stack ..."
  # Never -v. Azurite saves its store on SIGINT, so replace it only after down.
  compose down || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not stop the demo stack. Nothing was restored." >&2
    return "$rc"
  fi

  echo "Restoring demo/.data/azurite from demo/.data/snapshots/$name ..."
  compose run --rm --no-deps -T --entrypoint find azurite /data -mindepth 1 -delete || rc=$?
  if [ "$rc" -eq 0 ]; then
    # "/." copies the snapshot's contents into /data, not a folder named $name.
    compose run --rm --no-deps -T -v "$SNAPSHOTS_DIR:/snapshots" --entrypoint cp azurite -R "/snapshots/$name/." /data || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "Could not restore demo/.data/azurite from demo/.data/snapshots/$name. Run restore again, or reset." >&2
    return "$rc"
  fi

  start_stack || return $?

  # The id the restored data holds (the API reads it from storage).
  snap="$(dataset_id)"
  [ -z "$snap" ] && snap="unavailable"

  # Sign in once, after the restart, with no retry: five wrong PINs lock
  # sign-in. The PIN goes to curl on stdin, not in argv.
  echo "Signing in with the demo PIN ..."
  token="$(printf '{"pin":"%s"}' "$(demo_pin)" \
    | curl -fsS --max-time 30 -X POST "$PIN_SIGN_IN_URL" -H 'Content-Type: application/json' --data-binary @- 2>/dev/null \
    | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || token=""
  if [ -z "$token" ]; then
    echo "PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run restore again." >&2
    return 1
  fi

  echo "Changing the dataset id ..."
  body="$(curl -fsS --max-time 30 -X POST "$REGENERATE_URL" -H "Authorization: Bearer $token" -d '' 2>/dev/null)" || body=""
  returned="$(sed -n 's/.*"datasetId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$body")" || returned=""
  if [ -z "$returned" ]; then
    echo "Changing the dataset id failed. Run the logs command to see why." >&2
    return 1
  fi

  new="$(dataset_id)"
  if [ -z "$new" ] || [ "$new" != "$returned" ] || [ "$new" = "$snap" ]; then
    echo "The dataset id did not change after the restore. Run the logs command to see why." >&2
    return 1
  fi
  echo "Dataset: $snap -> $new"
  echo "Restore complete: the demo data matches snapshot $name at $HUB_URL"
  echo "Sign in with the PIN again: the restore restarted the API. Tablets paired after the snapshot was taken must pair again, and the new dataset id makes the hub drop its offline cache and queued writes."
}

# Prints the last-modified time of $1 in whole seconds (GNU stat, then BSD).
mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

# Prints epoch $1 as local YYYY-MM-DD HH:MM (GNU date, then BSD).
format_epoch() {
  date -d "@$1" '+%Y-%m-%d %H:%M' 2>/dev/null || date -r "$1" '+%Y-%m-%d %H:%M'
}

# snapshots (#99): list the snapshot folders, newest first (ties by name),
# with their dates. Skips files and folders that are not valid names. Ignores
# extra arguments, like status.
cmd_snapshots() {
  local d name epoch lines="" tab sorted when
  tab="$(printf '\t')"
  if [ -d "$SNAPSHOTS_DIR" ]; then
    for d in "$SNAPSHOTS_DIR"/* "$SNAPSHOTS_DIR"/.[!.]* "$SNAPSHOTS_DIR"/..?*; do
      [ -d "$d" ] || continue
      name="$(basename "$d")"
      [[ $name =~ $SNAPSHOT_NAME_RE ]] || continue
      epoch="$(mtime_epoch "$d")" || continue
      lines="$lines$epoch$tab$name
"
    done
  fi
  if [ -z "$lines" ]; then
    echo "No snapshots in demo/.data/snapshots. Take one with the snapshot command."
    return 0
  fi
  sorted="$(printf '%s' "$lines" | LC_ALL=C sort -t "$tab" -k1,1nr -k2,2)"
  echo "Snapshots in demo/.data/snapshots (newest first):"
  while IFS="$tab" read -r epoch name; do
    [ -z "$name" ] && continue
    when="$(format_epoch "$epoch")"
    echo "  $when  $name"
  done <<EOF
$sorted
EOF
}

cmd_status() {
  local rows
  rows="$(compose ps --all --format '{{.Service}}	{{.State}}	{{.Health}}')" || return $?
  if [ -z "$rows" ]; then
    echo "Stack is not running."
  else
    printf '%-9s %-9s %s\n' "SERVICE" "STATE" "HEALTH"
    local svc state health
    while IFS='	' read -r svc state health; do
      [ -z "$svc" ] && continue
      printf '%-9s %-9s %s\n' "$svc" "$state" "${health:--}"
    done <<EOF
$rows
EOF
  fi
  echo ""
  echo "Hub:     $HUB_URL"
  local dataset
  dataset="$(dataset_id)"
  echo "Dataset: ${dataset:-unavailable}"
}

# Default: follow the api and web (Caddy) logs, last 100 lines each. --api
# narrows the default to the API. Any other argument goes to docker compose
# logs as-is and turns off the default --follow --tail 100 (pass -f to
# follow). Naming a service from COMPOSE_SERVICES (exact, case-sensitive
# match), as in `logs -f azurite`, shows only the services named (#190).
cmd_logs() {
  local services="api web" rest=() arg svc named=0
  for arg in "$@"; do
    if [ "$arg" = "--api" ]; then
      services="api"
    else
      rest+=("$arg")
      for svc in $COMPOSE_SERVICES; do
        if [ "$arg" = "$svc" ]; then
          named=1
        fi
      done
    fi
  done
  if [ "${#rest[@]}" -eq 0 ]; then
    rest=(--follow --tail 100)
  fi
  if [ "$named" -eq 1 ]; then
    services=""
  fi
  # $services is unquoted on purpose: it is zero, one or two service names.
  # shellcheck disable=SC2086
  compose logs "${rest[@]}" $services
}

# Prints the path of the tailscale CLI, or S1 to stderr and returns 1.
find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  local mac="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  if [ -x "$mac" ]; then
    echo "$mac"
    return 0
  fi
  echo "Tailscale is not installed (no tailscale command found). Install it from https://tailscale.com/download and sign in." >&2
  return 1
}

# Prints a terminal QR code of $1. A missing tool or a failed QR command only
# prints a hint: the URL is already on screen.
print_qr() {
  local url="$1" rc=1
  if command -v qrencode >/dev/null 2>&1; then
    rc=0
    qrencode -t ansiutf8 "$url" || rc=$?
  elif command -v npx >/dev/null 2>&1; then
    rc=0
    # qrcode-terminal's bin reads stdin (not argv) when stdin is not a TTY.
    printf '%s\n' "$url" | npx --yes --loglevel=error --no-update-notifier qrcode-terminal@0.12.0 || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    echo "Could not print a QR code (install qrencode, or let npx reach the npm registry). Type the URL above on the tablet instead." >&2
  fi
  return 0
}

# Service workers need a secure context, so a tablet must reach the hub over
# HTTPS. tailscale serve proxies https://<host>.<tailnet>.ts.net to
# http://127.0.0.1:8080, which Caddy keeps serving for the desktop browser.
cmd_share() {
  local ts json flat state name rc=0
  ts="$(find_tailscale)" || return 1
  json="$("$ts" status --json 2>/dev/null)" || json=""
  # No jq: flatten the JSON and pick the two top-level fields out of it.
  flat="$(printf '%s' "$json" | tr -d ' \t\r\n')" || flat=""
  state="$(printf '%s' "$flat" | grep -o '"BackendState":"[^"]*"' | head -n 1 | sed 's/^"BackendState":"//; s/"$//')" || state=""
  [ -z "$state" ] && state="unavailable"
  if [ "$state" != "Running" ]; then
    echo "Tailscale is installed but not logged in (backend state: $state). Run 'tailscale up' or sign in from the Tailscale app, then run share again." >&2
    return 1
  fi
  # CertDomains, not Self.DNSName: DNSName also appears under every peer.
  name="$(printf '%s' "$flat" | grep -o '"CertDomains":\["[^"]*"' | head -n 1 | sed 's/^"CertDomains":\["//; s/"$//')" || name=""
  if [ -z "$name" ]; then
    echo "Tailscale reports no HTTPS name for this machine. Enable MagicDNS and HTTPS Certificates on the DNS page of the Tailscale admin console, then run share again." >&2
    return 1
  fi
  echo "Sharing http://localhost:8080 on your tailnet (tailscale serve --bg 8080) ..."
  "$ts" serve --bg 8080 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "tailscale serve failed. On Linux, allow your user once with 'sudo tailscale set --operator=\$USER', then run share again." >&2
    return "$rc"
  fi
  local url="https://$name"
  echo "Hub on your tailnet: $url"
  echo "Scan this on the tablet (it must be signed in to the same tailnet):"
  print_qr "$url"
  echo "The tablet needs the stack running (up). Run unshare to stop sharing."
}

# Turns off only the HTTPS 443 handler that share set up; `serve reset` would
# also wipe any other serve config the user has.
cmd_unshare() {
  local ts rc=0
  ts="$(find_tailscale)" || return 1
  "$ts" serve --https=443 --set-path=/ off || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not turn off tailscale serve (was it on?). Check with 'tailscale serve status'." >&2
    return "$rc"
  fi
  echo "Tailscale sharing is off. The hub is still at http://localhost:8080."
}

main() {
  if [ "$#" -eq 0 ]; then
    usage
    exit 2
  fi
  local name="$1"
  shift
  if ! is_command "$name"; then
    echo "Unknown command: $name" >&2
    echo "" >&2
    usage
    exit 2
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker was not found. Install Docker Desktop (or Docker Engine with the Compose v2 plugin)." >&2
    exit 1
  fi
  local rc=0
  "cmd_$name" "$@" || rc=$?
  exit "$rc"
}

main "$@"
