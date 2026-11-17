#!/usr/bin/env bash
# Checks the demo CLI's reset subcommand (#98) through both demo/demo.sh and
# demo/demo.ps1.
#
# Usage: bash demo/ci/check-reset.sh static|stack|hub-order
#   static - a stub docker, no stack. A missing PIN (AC8b) and every
#            non-local target (AC7: a remote DOCKER_HOST, an ssh context,
#            another compose project, an api that does not store its data in
#            the azurite service, another Azurite data folder, a compose file
#            that does not render) exit 1 with the exact message and make no
#            down, run or up call. A failed down deletes nothing, a failed
#            wipe does not start the stack, and the wipe is the exact
#            in-container find. Then reset starts only Azurite and the API,
#            and the hub (web) only once the seed has changed the dataset id
#            (#378): a failed API start, or a failed PIN sign-in (no API
#            answers on 127.0.0.1:5108 here), ends reset with no web call. A
#            fake fresh hub export and a failing npm stub keep the build out
#            of these cases. Also checks that demo/README.md documents reset
#            (AC8) and its order (#378). Refuses to run when demo/.env exists
#            (these cases need control of the PIN) or when something answers
#            on 127.0.0.1:5108 (the PIN must not reach a real API).
#   stack  - needs the stack up (demo/demo.sh up) and BUTLER_DEMO_PIN (from
#            the shell or demo/.env). DELETES THE LOCAL DEMO DATA. Runs
#            demo.sh reset, demo.ps1 reset and a reset from a stopped stack,
#            each with stdin closed (AC1, AC2), and after each one checks the
#            seeded household (AC3-AC5), that the dataset id changed (AC6), and
#            that a household created before the reset is gone. A hub watcher
#            polls the hub during each reset and fails unless every answer
#            after down carries the new dataset id (#378). After each reset
#            the check waits up to 30 s for at least one answer after down
#            before it stops the watcher, and requires one (#383).
#   hub-order - no stack and no docker. Runs check_hub_order over fixture
#            watcher logs (empty, down only, down plus the new id, down plus
#            the old id, down plus both) and checks each verdict and message
#            (#383). CI runs it 20 times in a row to show the verdicts are
#            stable.
#
# static runs both scripts in every case and fails unless their output
# (stdout and stderr together), exit code and docker calls are identical.
# stack compares the lines the scripts print themselves (docker and npm
# output varies run to run), with the dataset ids masked.
# Needs bash, pwsh (PowerShell 7), docker and curl; stack also needs jq.
# hub-order needs only bash.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  static|stack|hub-order) ;;
  *)
    echo "Usage: bash demo/ci/check-reset.sh static|stack|hub-order" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_YML="$REPO_ROOT/demo/docker-compose.yml"
README="$REPO_ROOT/demo/README.md"
HUB_URL="http://localhost:8080"
API_URL="http://127.0.0.1:5108"
DATA_DIR="$REPO_ROOT/demo/.data"
LOGS_DIR="$DATA_DIR/logs"
DIST="$REPO_ROOT/Butler.UI/dist"

PIN_MSG='demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md.'
STOPPING='Stopping the demo stack ...'
DELETING='Deleting the demo data in demo/.data/azurite ...'
DOWN_FAILED='Could not stop the demo stack. Nothing was deleted.'
WIPE_FAILED='Could not delete the demo data in demo/.data/azurite.'
EXPORT_FRESH='Hub export is up to date (Butler.UI/dist).'
STARTING_API='Starting Azurite and the API (the hub starts after the dataset id changes) ...'
API_UP='Azurite and the API are up and healthy.'
STARTING_HUB='Starting the hub ...'
HUB_UP='Demo stack is up and healthy: http://localhost:8080'
STACK_FAILED='Demo stack did not become healthy. Run the logs command to see why.'
SIGNING_IN='Signing in with the demo PIN ...'
SIGN_IN_FAILED='PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run reset again.'
SEEDING='Seeding the demo household ...'
COMPLETE="Demo reset complete: the demo household is seeded at $HUB_URL"
PAIR_AGAIN='Sign in with the PIN and pair the tablet again: the reset cleared organizer sessions and hub pairings.'
WIPE_CALL="compose -f $COMPOSE_YML run --rm --no-deps -T --entrypoint find azurite /data -mindepth 1 -delete"
API_UP_CALL="compose -f $COMPOSE_YML up -d --build --wait --wait-timeout 300 azurite api"
refusal() { echo "Refusing to reset: $1. reset only runs against the local demo stack."; }

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [ "$mode" != "hub-order" ]; then
  command -v docker >/dev/null 2>&1 || fail "docker must be on PATH"
  command -v pwsh >/dev/null 2>&1 || fail "pwsh (PowerShell 7) must be on PATH"
  command -v curl >/dev/null 2>&1 || fail "curl must be on PATH"
fi

WORK="$(mktemp -d)"
DIST_SAVED="$WORK/dist-saved"
CLEANUP_STATIC=0
DATA_CREATED=0
LOGS_EXISTED=0
DIST_FAKED=0
WATCH_PID=""
RESET_N=0
cleanup() {
  set +e
  if [ -n "$WATCH_PID" ]; then
    kill "$WATCH_PID" 2>/dev/null
    wait "$WATCH_PID" 2>/dev/null
  fi
  if [ "$DIST_FAKED" -eq 1 ]; then
    # Drop the fake export and put back any real one.
    rm -rf "$DIST"
    if [ -d "$DIST_SAVED" ]; then
      mv "$DIST_SAVED" "$DIST"
    fi
  fi
  rm -rf "$WORK"
  if [ "$CLEANUP_STATIC" -eq 1 ]; then
    # reset reaches ensure_logs_dir, which creates demo/.data/logs.
    if [ "$LOGS_EXISTED" -eq 0 ]; then
      rm -rf "$LOGS_DIR"
    fi
    if [ "$DATA_CREATED" -eq 1 ]; then
      rmdir "$DATA_DIR" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

static_mode() {
  [ ! -e "$REPO_ROOT/demo/.env" ] || fail "demo/.env exists; move it aside to run the static checks"
  # reset signs in on the API's loopback port once the stub "starts" it
  # (#378). PIN 1234 must never reach a real API there: five wrong PINs lock
  # sign-in.
  if curl -s --max-time 2 -o /dev/null "$API_URL/health"; then
    fail "something answers on $API_URL; stop that demo stack to run the static checks"
  fi
  [ -d "$DATA_DIR" ] || DATA_CREATED=1
  [ -e "$LOGS_DIR" ] && LOGS_EXISTED=1
  CLEANUP_STATIC=1
  unset DOCKER_HOST DOCKER_CONTEXT COMPOSE_PROJECT_NAME
  export BUTLER_DEMO_PIN=1234

  # A fresh export with a valid stamp (#184), newer than index.html, so reset
  # reports it up to date and never calls npm (as in check-snapshot.sh). Any
  # real export is put back on exit.
  DIST_FAKED=1
  if [ -e "$DIST" ]; then
    mv "$DIST" "$DIST_SAVED"
  fi
  mkdir -p "$DIST"
  echo '<!doctype html><title>stub export</title>' > "$DIST/index.html"
  printf 'EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_AUTH_PROVIDER=pin\nEXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household\n' > "$DIST/.demo-build-env"
  touch -d "@$(( $(date +%s) + 60 ))" "$DIST/.demo-build-env"

  REAL_DOCKER="$(command -v docker)"
  export REAL_DOCKER
  local stub_dir="$WORK/bin"
  mkdir -p "$stub_dir"
  export DOCKER_STUB_LOG="$WORK/docker.log"
  : > "$DOCKER_STUB_LOG"

  # A stub docker: logs its arguments. `context inspect` prints
  # $STUB_ENDPOINT (a local socket by default). `compose ... config` prints
  # $STUB_CONFIG_FILE when set, fails with $STUB_CONFIG_RC when set, and
  # otherwise renders the real compose file. down, run and up exit with
  # $STUB_DOWN_RC / $STUB_RUN_RC / $STUB_UP_RC; anything else succeeds.
  cat > "$stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:-/dev/null}"
if [ "${1:-}" = "context" ] && [ "${2:-}" = "inspect" ]; then
  printf '%s\n' "${STUB_ENDPOINT:-unix:///var/run/docker.sock}"
  exit 0
fi
if [ "${1:-}" = "compose" ]; then
  case "${4:-}" in
    config)
      if [ -n "${STUB_CONFIG_RC:-}" ]; then
        echo "stub docker: invalid compose project" >&2
        exit "$STUB_CONFIG_RC"
      fi
      if [ -n "${STUB_CONFIG_FILE:-}" ]; then
        cat "$STUB_CONFIG_FILE"
        exit 0
      fi
      exec "$REAL_DOCKER" "$@"
      ;;
    down) exit "${STUB_DOWN_RC:-0}" ;;
    run) exit "${STUB_RUN_RC:-0}" ;;
    up) exit "${STUB_UP_RC:-0}" ;;
  esac
fi
exit 0
STUB
  chmod +x "$stub_dir/docker"
  # A stub npm: logs its arguments and fails. reset must not build here.
  export NPM_STUB_LOG="$WORK/npm.log"
  : > "$NPM_STUB_LOG"
  cat > "$stub_dir/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_STUB_LOG:-/dev/null}"
echo "stub npm: reset must not build the export in this check: $*" >&2
exit 64
STUB
  chmod +x "$stub_dir/npm"
  export PATH="$stub_dir:$PATH"

  # Rendered configs that point somewhere else. They hold the test PIN only.
  local real="$WORK/config.yml"
  "$REAL_DOCKER" compose -f "$COMPOSE_YML" config > "$real" 2>/dev/null || fail "docker compose config failed"
  grep -qF 'TableEndpoint=http://azurite:10002/devstoreaccount1;' "$real" || fail "the real config has no azurite TableEndpoint"
  grep -qE '^ +source: .*/demo/\.data/azurite$' "$real" || fail "the real config does not mount demo/.data/azurite"
  sed 's#TableEndpoint=http://azurite:10002/devstoreaccount1;#TableEndpoint=https://butlerprod.table.core.windows.net/;#' \
    "$real" > "$WORK/remote-storage.yml"
  sed 's#^\( *source: \).*/demo/\.data/azurite$#\1/srv/butler/azurite#' "$real" > "$WORK/other-data.yml"
  # A Windows host renders the source with backslashes; it still counts.
  sed 's#^\( *source: \).*/demo/\.data/azurite$#\1C:\\Users\\demo\\butler\\demo\\.data\\azurite#' "$real" > "$WORK/windows-data.yml"

  local inspect="context inspect --format {{.Endpoints.docker.Host}}"
  local config="compose -f $COMPOSE_YML config"

  # AC8b: no PIN, no docker call.
  unset BUTLER_DEMO_PIN
  run_both "reset (no PIN)" reset
  expect_rc "reset (no PIN)" 1
  expect_out "reset (no PIN)" "$PIN_MSG"
  expect_log "reset (no PIN)" ""
  export BUTLER_DEMO_PIN=1234
  BUTLER_DEMO_PIN=12ab run_both "reset (bad PIN)" reset
  expect_rc "reset (bad PIN)" 1
  expect_out "reset (bad PIN)" "$PIN_MSG"
  expect_log "reset (bad PIN)" ""

  # AC7: a remote engine, from DOCKER_HOST or from the context.
  DOCKER_HOST=tcp://10.0.0.5:2376 run_both "reset (DOCKER_HOST tcp)" reset
  expect_rc "reset (DOCKER_HOST tcp)" 1
  expect_out "reset (DOCKER_HOST tcp)" "$(refusal 'the Docker engine is not local (tcp://10.0.0.5:2376)')"
  expect_log "reset (DOCKER_HOST tcp)" ""

  STUB_ENDPOINT=ssh://demo@build-box run_both "reset (ssh context)" reset
  expect_rc "reset (ssh context)" 1
  expect_out "reset (ssh context)" "$(refusal 'the Docker engine is not local (ssh://demo@build-box)')"
  expect_log "reset (ssh context)" "$inspect"

  # AC7: another compose project (the real compose config honors it).
  COMPOSE_PROJECT_NAME=other run_both "reset (other project)" reset
  expect_rc "reset (other project)" 1
  expect_out "reset (other project)" "$(refusal 'the compose project is not butler-demo')"
  expect_log "reset (other project)" "$(printf '%s\n' "$inspect" "$config")"

  # AC7: the api stores its data somewhere other than the azurite service.
  STUB_CONFIG_FILE="$WORK/remote-storage.yml" run_both "reset (remote storage)" reset
  expect_rc "reset (remote storage)" 1
  expect_out "reset (remote storage)" "$(refusal 'the api does not use the azurite service for storage')"
  expect_log "reset (remote storage)" "$(printf '%s\n' "$inspect" "$config")"

  # AC7: Azurite's data is not in demo/.data/azurite.
  STUB_CONFIG_FILE="$WORK/other-data.yml" run_both "reset (other data folder)" reset
  expect_rc "reset (other data folder)" 1
  expect_out "reset (other data folder)" "$(refusal 'the Azurite data folder is not demo/.data/azurite')"
  expect_log "reset (other data folder)" "$(printf '%s\n' "$inspect" "$config")"

  # The compose file does not render.
  STUB_CONFIG_RC=15 run_both "reset (config fails)" reset
  expect_rc "reset (config fails)" 1
  expect_out "reset (config fails)" "$(refusal 'demo/docker-compose.yml could not be rendered')"
  expect_log "reset (config fails)" "$(printf '%s\n' "$inspect" "$config")"

  # down fails: nothing is deleted, the stack is not started.
  STUB_DOWN_RC=7 run_both "reset (down fails)" reset
  expect_rc "reset (down fails)" 7
  expect_out "reset (down fails)" "$(printf '%s\n' "$STOPPING" "$DOWN_FAILED")"
  expect_log "reset (down fails)" "$(printf '%s\n' "$inspect" "$config" "compose -f $COMPOSE_YML down")"

  # The wipe fails: the stack is not started. A Windows-style data path still
  # counts as demo/.data/azurite. The wipe is exactly the in-container find.
  STUB_CONFIG_FILE="$WORK/windows-data.yml" STUB_RUN_RC=5 run_both "reset (wipe fails)" reset
  expect_rc "reset (wipe fails)" 5
  expect_out "reset (wipe fails)" "$(printf '%s\n' "$STOPPING" "$DELETING" "$WIPE_FAILED")"
  expect_log "reset (wipe fails)" "$(printf '%s\n' "$inspect" "$config" "compose -f $COMPOSE_YML down" "$WIPE_CALL")"

  # #378: reset starts only Azurite and the API, never the hub (web), until
  # the seed has changed the dataset id. The API does not come up: no web call.
  STUB_UP_RC=4 run_both "reset (API start fails)" reset
  expect_rc "reset (API start fails)" 4
  expect_out "reset (API start fails)" "$(printf '%s\n' "$STOPPING" "$DELETING" "$EXPORT_FRESH" "$STARTING_API" "$STACK_FAILED")"
  expect_log "reset (API start fails)" "$(printf '%s\n' "$inspect" "$config" "compose -f $COMPOSE_YML down" "$WIPE_CALL" "$API_UP_CALL")"

  # The stub "starts" the API, but nothing answers on 127.0.0.1:5108, so the
  # PIN sign-in fails and the hub stays down: no web call.
  run_both "reset (sign-in fails, hub stays down)" reset
  expect_rc "reset (sign-in fails, hub stays down)" 1
  expect_out "reset (sign-in fails, hub stays down)" "$(printf '%s\n' "$STOPPING" "$DELETING" "$EXPORT_FRESH" "$STARTING_API" "$API_UP" "$SIGNING_IN" "$SIGN_IN_FAILED")"
  expect_log "reset (sign-in fails, hub stays down)" "$(printf '%s\n' "$inspect" "$config" "compose -f $COMPOSE_YML down" "$WIPE_CALL" "$API_UP_CALL")"
  if grep -qE ' web$' <<<"$LOG"; then
    fail "reset (sign-in fails, hub stays down): the hub (web) was started"
  fi
  [ ! -s "$NPM_STUB_LOG" ] || fail "reset ran npm: $(cat "$NPM_STUB_LOG")"

  # AC8: the README documents reset.
  grep -qxF '## Reset the demo' "$README" || fail "demo/README.md has no '## Reset the demo' section"
  grep -qF 'demo/demo.sh reset' "$README" || fail "demo/README.md does not show demo/demo.sh reset"
  grep -qF 'pwsh demo/demo.ps1 reset' "$README" || fail "demo/README.md does not show pwsh demo/demo.ps1 reset"
  grep -qF '| `demo.sh reset` |' "$README" || fail "demo/README.md has no demo.sh reset table row"
  grep -qF 'hub stays stopped until the seed has changed the dataset id' "$README" \
    || fail "demo/README.md does not say the hub stays stopped until the seed has changed the dataset id (#378)"
  if LC_ALL=C grep -nP '[^\x00-\x7F]' "$README"; then
    fail "demo/README.md must stay plain ASCII"
  fi
}

# run_both <label> <args...>: runs demo.sh and demo.ps1 with the same args and
# environment (stdin closed), requires identical output, exit code and stub
# docker calls, and leaves them in OUT, RC and LOG.
run_both() {
  local label="$1" sh_out sh_rc sh_log ps_out ps_rc ps_log
  shift
  : > "$DOCKER_STUB_LOG"
  set +e
  sh_out="$(bash "$REPO_ROOT/demo/demo.sh" "$@" < /dev/null 2>&1)"
  sh_rc=$?
  set -e
  sh_log="$(cat "$DOCKER_STUB_LOG")"
  : > "$DOCKER_STUB_LOG"
  set +e
  ps_out="$(pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" "$@" < /dev/null 2>&1)"
  ps_rc=$?
  set -e
  ps_log="$(cat "$DOCKER_STUB_LOG")"
  echo "== $label: demo.sh exit=$sh_rc demo.ps1 exit=$ps_rc"
  printf '%s\n' "$sh_out"
  if [ "$sh_out" != "$ps_out" ]; then
    diff <(printf '%s\n' "$sh_out") <(printf '%s\n' "$ps_out") || true
    fail "$label: demo.sh and demo.ps1 print different output"
  fi
  [ "$sh_rc" -eq "$ps_rc" ] || fail "$label: exit codes differ ($sh_rc vs $ps_rc)"
  if [ "$sh_log" != "$ps_log" ]; then
    diff <(printf '%s\n' "$sh_log") <(printf '%s\n' "$ps_log") || true
    fail "$label: demo.sh and demo.ps1 make different docker calls"
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
    fail "$1: unexpected docker calls"
  fi
}

# ---- stack mode ----------------------------------------------------------

demo_pin() {
  if [ -n "${BUTLER_DEMO_PIN:-}" ]; then
    printf '%s\n' "$BUTLER_DEMO_PIN"
    return 0
  fi
  [ -f "$REPO_ROOT/demo/.env" ] || return 0
  sed -n 's/^[[:space:]]*BUTLER_DEMO_PIN[[:space:]]*=[[:space:]]*//p' "$REPO_ROOT/demo/.env" \
    | tail -n 1 | tr -d '\r' | sed -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//"
}

# The PIN goes to curl on stdin, never in argv.
sign_in() {
  printf '{"pin":"%s"}' "$(demo_pin)" \
    | curl -fsS -X POST "$HUB_URL/api/auth/pin/sign-in" -H 'Content-Type: application/json' --data-binary @- \
    | jq -er '.token'
}

dataset_now() { curl -fsS "$HUB_URL/api/api/system/dataset" | jq -er '.datasetId'; }

all_healthy() {
  local health
  health="$(docker compose -f "$COMPOSE_YML" ps --format '{{.Service}} {{.Health}}')"
  echo "$health"
  [ "$(printf '%s\n' "$health" | grep -c ' healthy$' || true)" -eq 3 ] || fail "$1: not every service is healthy"
}

# The lines the scripts print themselves, in order, with the dataset ids masked.
own() {
  grep -xE \
    -e 'Hub export is up to date \(Butler\.UI/dist\)\.' \
    -e 'Hub export is missing; building Butler\.UI/dist \.\.\.' \
    -e 'Hub export is older than its sources; building Butler\.UI/dist \.\.\.' \
    -e 'Hub export was not built with the demo settings; building Butler\.UI/dist \.\.\.' \
    -e 'Installing Butler\.UI dependencies \(npm ci\) \.\.\.' \
    -e 'Starting the demo stack \.\.\.' \
    -e 'Starting Azurite and the API \(the hub starts after the dataset id changes\) \.\.\.' \
    -e 'Azurite and the API are up and healthy\.' \
    -e 'Starting the hub \.\.\.' \
    -e 'Recreating web to serve the new export \.\.\.' \
    -e 'Demo stack is up and healthy: http://localhost:8080' \
    -e 'Demo stack did not become healthy\. Run the logs command to see why\.' \
    -e 'Stopping the demo stack \.\.\.' \
    -e 'Deleting the demo data in demo/\.data/azurite \.\.\.' \
    -e 'Signing in with the demo PIN \.\.\.' \
    -e 'Seeding the demo household \.\.\.' \
    -e 'Dataset: .* -> .*' \
    -e 'Demo reset complete: .*' \
    -e 'Sign in with the PIN and pair the tablet again: .*' \
    -e 'Refusing to reset: .*' \
    -e 'Could not .*' \
    -e 'PIN sign-in failed\..*' \
    -e 'Seeding the demo household failed\..*' \
    -e 'The dataset id did not change.*' || true
}
mask() { sed 's/^Dataset: .* -> .*$/Dataset: <old> -> <new>/'; }
# Drops the export lines, which depend on the state of Butler.UI/dist.
core() {
  grep -vE '^(Hub export |Installing Butler\.UI |Recreating web )' || true
}

# #378: the hub starts only after the seed has changed the dataset id.
EXPECTED_CORE="$(printf '%s\n' "$STOPPING" "$DELETING" "$STARTING_API" "$API_UP" \
  "$SIGNING_IN" "$SEEDING" 'Dataset: <old> -> <new>' "$STARTING_HUB" "$HUB_UP" \
  "$COMPLETE" "$PAIR_AGAIN")"

# watch_hub <log>: polls the hub's dataset endpoint every 0.2 s until killed.
# Logs nothing until the hub first stops answering (000), then 'down' once,
# then '<code> <dataset id>' for each answer. Answers from before reset's
# down (the previous id) are not logged. curl exits 7 on a refused
# connection, hence || true.
watch_hub() {
  local log="$1" resp code id seen_down=0
  : > "$log"
  while :; do
    resp="$(curl -s --max-time 2 -w '%{http_code}' "$HUB_URL/api/api/system/dataset" 2>/dev/null || true)"
    code="000"
    if [ "${#resp}" -ge 3 ]; then
      code="${resp:${#resp}-3}"
    fi
    if [ "$code" = "000" ]; then
      if [ "$seen_down" -eq 0 ]; then
        echo down >> "$log"
        seen_down=1
      fi
    elif [ "$seen_down" -eq 1 ]; then
      id="$(printf '%s' "${resp%???}" | sed -n 's/.*"datasetId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      echo "$code $id" >> "$log"
    fi
    sleep 0.2
  done
}

# start_watch <log> / stop_watch: run watch_hub in the background around one
# reset. cleanup also stops it.
start_watch() {
  watch_hub "$1" &
  WATCH_PID=$!
}

stop_watch() {
  if [ -n "$WATCH_PID" ]; then
    kill "$WATCH_PID" 2>/dev/null || true
    wait "$WATCH_PID" 2>/dev/null || true
    WATCH_PID=""
  fi
}

# wait_hub_answer <log> (#383): waits up to 30 s, polling every 0.2 s, until
# the watcher log holds an answer after 'down' (a second line), so stop_watch
# cannot kill the watcher before its first poll after the hub came back. Also
# stops waiting when the first line is not 'down' (nothing to wait for).
# Never fails: on a timeout check_hub_order names the missing answer.
wait_hub_answer() {
  local log="$1" deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(head -n 1 "$log")" = "down" ] || break
    [ -n "$(sed -n 2p "$log")" ] && break
    sleep 0.2
  done
  return 0
}

# check_hub_order <label> <log> <new id> (#378, #383): the watcher saw the hub
# go down, answered at least once after that, and every answer was 200 with
# the new dataset id, so the hub never served the wiped data before the seed
# changed the id. Reads only the log, so hub-order mode can test it.
check_hub_order() {
  local label="$1" log="$2" now="$3" line n=0
  line="$(head -n 1 "$log")"
  [ "$line" = "down" ] || fail "$label: the hub watcher never saw the hub go down (first line '$line')"
  [ -n "$(sed -n 2p "$log")" ] \
    || fail "$label: the hub watcher saw the hub go down but no answer after it (expected '200 $now')"
  while IFS= read -r line; do
    n=$((n + 1))
    [ "$n" -eq 1 ] && continue
    [ "$line" = "200 $now" ] \
      || fail "$label: the hub answered '$line' (watcher line $n) before the seed changed the dataset id to $now"
  done < "$log"
  echo "$label: the hub stayed down until the seed changed the dataset id ($((n - 1)) answers, all '200 $now')"
}

# expect_hub_order <name> <log> <want rc> <want text>: runs check_hub_order on
# a fixture log with the new id 'new-id' and requires the exit code and a
# substring of its output (#383).
expect_hub_order() {
  local name="$1" log="$2" want_rc="$3" want_text="$4" out rc
  set +e
  out="$(check_hub_order 'fixture reset' "$log" new-id 2>&1)"
  rc=$?
  set -e
  [ "$rc" -eq "$want_rc" ] || fail "hub-order: $name: expected exit $want_rc, got $rc: $out"
  grep -qF -- "$want_text" <<<"$out" || fail "hub-order: $name: expected '$want_text' in: $out"
  echo "hub-order: $name: ok"
}

# hub_order_mode (#383): check_hub_order verdicts on fixture watcher logs.
hub_order_mode() {
  local dir="$WORK/hub-order"
  mkdir -p "$dir"
  : > "$dir/empty.log"
  printf '%s\n' down > "$dir/down-only.log"
  printf '%s\n' down '200 new-id' '200 new-id' > "$dir/new.log"
  printf '%s\n' down '200 old-id' > "$dir/old.log"
  printf '%s\n' down '200 new-id' '200 old-id' > "$dir/mixed.log"
  expect_hub_order empty "$dir/empty.log" 1 'fixture reset: the hub watcher never saw the hub go down'
  expect_hub_order down-only "$dir/down-only.log" 1 'fixture reset: the hub watcher saw the hub go down but no answer after it'
  expect_hub_order new "$dir/new.log" 0 "fixture reset: the hub stayed down until the seed changed the dataset id (2 answers, all '200 new-id')"
  expect_hub_order old "$dir/old.log" 1 "fixture reset: the hub answered '200 old-id' (watcher line 2)"
  expect_hub_order mixed "$dir/mixed.log" 1 "fixture reset: the hub answered '200 old-id' (watcher line 3)"
}

# A household that the reset must delete.
make_leftover() {
  local token
  token="$(sign_in)" || fail "PIN sign-in failed before the reset"
  curl -fsS -X POST "$HUB_URL/api/households" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d '{"name":"Reset CI Leftover"}' | jq -er '.householdId'
}

# run_reset <label> <sh|ps> <dataset before>: runs reset with stdin closed and
# a 600 s timeout while a hub watcher polls the hub, waits up to 30 s after a
# successful reset for the watcher to log an answer after down (#383), checks
# its own lines, the dataset line and the hub order (#378), and leaves the
# masked own lines in OWN.
run_reset() {
  local label="$1" script="$2" before="$3" out rc line new now
  local watch_log
  RESET_N=$((RESET_N + 1))
  watch_log="$WORK/hub-$RESET_N.log"
  start_watch "$watch_log"
  set +e
  if [ "$script" = "sh" ]; then
    out="$(timeout 600 bash "$REPO_ROOT/demo/demo.sh" reset < /dev/null 2>&1)"
  else
    out="$(timeout 600 pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" reset < /dev/null 2>&1)"
  fi
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then wait_hub_answer "$watch_log"; fi
  stop_watch
  echo "== $label: exit=$rc"
  printf '%s\n' "$out" | own
  [ "$rc" -eq 0 ] || { printf '%s\n' "$out" | tail -n 40; fail "$label: expected exit 0, got $rc"; }
  OWN="$(printf '%s\n' "$out" | own | mask)"
  local got
  got="$(printf '%s\n' "$OWN" | core)"
  if [ "$got" != "$EXPECTED_CORE" ]; then
    diff <(printf '%s\n' "$EXPECTED_CORE") <(printf '%s\n' "$got") || true
    fail "$label: unexpected reset lines"
  fi
  # AC6: the dataset line names the id from before the reset and a new one,
  # which status now reports.
  line="$(printf '%s\n' "$out" | grep -E '^Dataset: .* -> .*$')"
  new="${line##* -> }"
  [ "$line" = "Dataset: $before -> $new" ] || fail "$label: expected 'Dataset: $before -> <new>', got '$line'"
  [ -n "$new" ] && [ "$new" != "$before" ] || fail "$label: the dataset id did not change ($before)"
  now="$(dataset_now)" || fail "$label: no dataset id after the reset"
  [ "$now" = "$new" ] || fail "$label: the reset printed $new but the API reports $now"
  check_hub_order "$label" "$watch_log" "$now"
}

# AC3-AC5 and the wipe: the seeded household is all there is.
assert_seeded() {
  local label="$1" leftover="$2" token base body names week code auth
  token="$(sign_in)" || fail "$label: PIN sign-in failed after the reset"
  base="$HUB_URL/api/households/demo-household"
  auth=(-H "Authorization: Bearer $token")
  # AC3.
  body="$(curl -fsS "${auth[@]}" "$base")" || fail "$label: GET demo-household failed"
  jq -e '.name == "The Parker Household"' <<<"$body" > /dev/null || fail "$label: wrong household: $body"
  body="$(curl -fsS "${auth[@]}" "$base/people")" || fail "$label: GET people failed"
  names="$(jq -cr '[.[].displayName] | sort | join(",")' <<<"$body")"
  [ "$names" = "Ava,Dan,Leo,Maria" ] || fail "$label: unexpected roster: $names"
  # AC4: an empty body generates the current ISO week.
  week="$(date -u +%G-W%V)"
  body="$(curl -fsS -X POST "${auth[@]}" "$base/assignments/generate")" || fail "$label: generate with an empty body failed"
  jq -e --arg w "$week" '.weekIso == $w and (.assignments | length) > 0' <<<"$body" > /dev/null \
    || fail "$label: generate did not return $week with assignments: $body"
  # AC5.
  body="$(curl -fsS "${auth[@]}" "$base/fairness")" || fail "$label: GET fairness failed"
  jq -e '.totalEffort > 0 and (.shares | length) > 0' <<<"$body" > /dev/null \
    || fail "$label: fairness has no effort or shares: $body"
  # The wipe: the household created before the reset is gone.
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${auth[@]}" "$HUB_URL/api/households/$leftover")"
  [ "$code" = "404" ] || fail "$label: household $leftover survived the reset (HTTP $code)"
  all_healthy "$label"
  echo "$label: The Parker Household seeded (roster $names, week $week), leftover $leftover gone"
}

stack_mode() {
  command -v curl >/dev/null 2>&1 || fail "curl must be on PATH"
  command -v jq >/dev/null 2>&1 || fail "jq must be on PATH"
  [ -n "$(demo_pin)" ] || fail "set BUTLER_DEMO_PIN or demo/.env"
  local before leftover sh_own ps_own
  # Command substitutions run in a subshell, so a fail there only ends it.
  new_leftover() { leftover="$(make_leftover)" && [ -n "$leftover" ] || fail "could not create a household before the reset"; }

  # AC1 + AC3-AC6: demo.sh reset on a running stack.
  before="$(dataset_now)" || fail "the stack is not up (no dataset id)"
  new_leftover
  run_reset "demo.sh reset" sh "$before"
  sh_own="$OWN"
  assert_seeded "demo.sh reset" "$leftover"

  # AC2 + AC3-AC6: demo.ps1 reset prints the same own lines.
  before="$(dataset_now)" || fail "no dataset id before demo.ps1 reset"
  new_leftover
  run_reset "demo.ps1 reset" ps "$before"
  ps_own="$OWN"
  if [ "$sh_own" != "$ps_own" ]; then
    diff <(printf '%s\n' "$sh_own") <(printf '%s\n' "$ps_own") || true
    fail "demo.sh and demo.ps1 reset print different lines"
  fi
  assert_seeded "demo.ps1 reset" "$leftover"

  # A reset from a stopped stack: the old dataset id is unavailable.
  new_leftover
  docker compose -f "$COMPOSE_YML" down
  run_reset "demo.sh reset (stack stopped)" sh "unavailable"
  assert_seeded "demo.sh reset (stack stopped)" "$leftover"
}

if [ "$mode" = "static" ]; then
  static_mode
elif [ "$mode" = "hub-order" ]; then
  hub_order_mode
else
  stack_mode
fi

echo "check-reset.sh $mode: all checks passed"
