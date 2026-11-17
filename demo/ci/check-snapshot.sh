#!/usr/bin/env bash
# Checks the demo CLI's snapshot, restore and snapshots subcommands (#99)
# through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-snapshot.sh static|stack
#   static - a stub docker, no stack. A missing, extra or invalid name exits
#            2 with no docker call; a taken name (snapshot) and a missing
#            snapshot (restore) exit 1 with no docker call; restore without a
#            valid PIN exits 1 with no docker call (AC6b); a remote
#            DOCKER_HOST is refused for both. snapshot stops only Azurite,
#            copies demo/.data/azurite in a container with cp -R and starts
#            Azurite again (AC1); a failed copy is removed and Azurite still
#            starts. restore stops the whole stack (down), then wipes and
#            copies in containers (AC2); a failed down, wipe or copy does not
#            start the stack. Then it starts only Azurite and the API, and the
#            hub (web) only once the dataset id has changed (#361): a failed
#            API start, or a failed PIN sign-in (no API answers on
#            127.0.0.1:5108 here), ends restore with no web call. A fake fresh
#            hub export and a failing npm stub keep the build out of these
#            cases. snapshots lists valid-named folders newest first with
#            their local dates (AC7). Also checks that demo/README.md
#            documents the three commands and the restore order (AC8, #361).
#            Refuses to run when demo/.env exists (these cases need control
#            of the PIN), when demo/.data/snapshots exists (it creates and
#            deletes fake snapshots there), or when something answers on
#            127.0.0.1:5108 (the PIN must not reach a real API).
#   stack  - needs the stack up (demo/demo.sh up) and BUTLER_DEMO_PIN (from
#            the shell or demo/.env). REPLACES THE LOCAL DEMO DATA. Takes
#            snapshot ci-snap-sh with demo.sh (the PIN token keeps working:
#            only Azurite restarted), lists it, adds a household, then
#            restores it with demo.sh and demo.ps1, each with stdin closed.
#            After each restore: the dataset id is new and differs from the
#            snapshot's (AC6), the api container was recreated and the old
#            token gets 401 (review F1), the household from before the
#            snapshot is back and the later one is gone (AC2). A background
#            watcher polls the hub during each restore: once the hub has gone
#            down, every answer it gives must be 200 with the new dataset id
#            (#361). Also takes ci-snap-ps with demo.ps1. Deletes both
#            snapshots on exit.
#
# static runs both scripts in every case and fails unless their output
# (stdout and stderr together), exit code and docker calls are identical.
# stack compares the lines the scripts print themselves (docker and npm
# output varies run to run), with the dataset ids and snapshot names masked.
# Needs bash, pwsh (PowerShell 7), docker and curl; stack also needs jq.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  static|stack) ;;
  *)
    echo "Usage: bash demo/ci/check-snapshot.sh static|stack" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_YML="$REPO_ROOT/demo/docker-compose.yml"
README="$REPO_ROOT/demo/README.md"
DATA_DIR="$REPO_ROOT/demo/.data"
SNAP_DIR="$DATA_DIR/snapshots"
LOGS_DIR="$DATA_DIR/logs"
DIST="$REPO_ROOT/Butler.UI/dist"
MOUNT="$SNAP_DIR:/snapshots"
HUB_URL="http://localhost:8080"
API_URL="http://127.0.0.1:5108"

PIN_MSG='demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md.'
NAME_RULE="Snapshot names use letters, digits, '.', '_' and '-', start with a letter or digit, and are at most 64 characters."
STOPPING_AZURITE='Stopping Azurite ...'
STARTING_AZURITE='Starting Azurite ...'
STOP_FAILED='Could not stop Azurite. No snapshot was taken.'
UP_FAILED='Azurite did not become healthy. Run the logs command to see why.'
STOPPING='Stopping the demo stack ...'
DOWN_FAILED='Could not stop the demo stack. Nothing was restored.'
EXPORT_FRESH='Hub export is up to date (Butler.UI/dist).'
STARTING_API='Starting Azurite and the API (the hub starts after the dataset id changes) ...'
API_UP='Azurite and the API are up and healthy.'
STARTING_HUB='Starting the hub ...'
HUB_UP='Demo stack is up and healthy: http://localhost:8080'
STACK_FAILED='Demo stack did not become healthy. Run the logs command to see why.'
SIGNING_IN='Signing in with the demo PIN ...'
SIGN_IN_FAILED='PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run restore again.'
CHANGING='Changing the dataset id ...'
SIGN_IN_AGAIN='Sign in with the PIN again: the restore restarted the API. Tablets paired after the snapshot was taken must pair again, and the new dataset id makes the hub drop its offline cache and queued writes.'
NONE='No snapshots in demo/.data/snapshots. Take one with the snapshot command.'
LIST_HEADER='Snapshots in demo/.data/snapshots (newest first):'
copying() { echo "Copying demo/.data/azurite to demo/.data/snapshots/$1 ..."; }
saved() { echo "Snapshot saved: demo/.data/snapshots/$1"; }
copy_failed() { echo "Could not copy demo/.data/azurite to demo/.data/snapshots/$1."; }
taken() { echo "Snapshot $1 already exists in demo/.data/snapshots. Pick another name, or delete that folder first."; }
missing() { echo "No snapshot named $1 in demo/.data/snapshots. Run the snapshots command to list them."; }
restoring() { echo "Restoring demo/.data/azurite from demo/.data/snapshots/$1 ..."; }
restore_failed() { echo "Could not restore demo/.data/azurite from demo/.data/snapshots/$1. Run restore again, or reset."; }
complete() { echo "Restore complete: the demo data matches snapshot $1 at $HUB_URL"; }
refusal() { echo "Refusing to $1: $2. $1 only runs against the local demo stack."; }

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker must be on PATH"
command -v pwsh >/dev/null 2>&1 || fail "pwsh (PowerShell 7) must be on PATH"
command -v curl >/dev/null 2>&1 || fail "curl must be on PATH"

WORK="$(mktemp -d)"
DIST_SAVED="$WORK/dist-saved"
CLEANUP_STATIC=0
CLEANUP_STACK=0
DATA_CREATED=0
LOGS_EXISTED=0
DIST_FAKED=0
WATCH_PID=""
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
    # Everything under it was created by this script, as this user.
    rm -rf "$SNAP_DIR"
    # restore reaches ensure_logs_dir, which creates demo/.data/logs.
    if [ "$LOGS_EXISTED" -eq 0 ]; then
      rm -rf "$LOGS_DIR"
    fi
    if [ "$DATA_CREATED" -eq 1 ]; then
      rmdir "$DATA_DIR" 2>/dev/null || true
    fi
  fi
  if [ "$CLEANUP_STACK" -eq 1 ] && [ -d "$SNAP_DIR" ]; then
    # The snapshot folders are root-owned on Linux: delete them in a container.
    docker compose -f "$COMPOSE_YML" run --rm --no-deps -T -v "$MOUNT" --entrypoint rm azurite \
      -rf /snapshots/ci-snap-sh /snapshots/ci-snap-ps >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

static_mode() {
  [ ! -e "$REPO_ROOT/demo/.env" ] || fail "demo/.env exists; move it aside to run the static checks"
  [ ! -e "$SNAP_DIR" ] || fail "demo/.data/snapshots exists; move it aside to run the static checks"
  # restore signs in on the API's loopback port once the stub "starts" it
  # (#361). PIN 1234 must never reach a real API there: five wrong PINs lock
  # sign-in.
  if curl -s --max-time 2 -o /dev/null "$API_URL/health"; then
    fail "something answers on $API_URL; stop that demo stack to run the static checks"
  fi
  [ -d "$DATA_DIR" ] || DATA_CREATED=1
  [ -e "$LOGS_DIR" ] && LOGS_EXISTED=1
  CLEANUP_STATIC=1
  unset DOCKER_HOST DOCKER_CONTEXT COMPOSE_PROJECT_NAME
  export BUTLER_DEMO_PIN=1234

  # A fresh export with a valid stamp (#184), newer than index.html, so
  # restore reports it up to date and never calls npm (as in
  # check-smoke-step.sh). Any real export is put back on exit.
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

  # A stub docker: logs its arguments. `context inspect` prints a local
  # socket. `compose ... config` renders the real compose file. stop, down and
  # up exit with $STUB_STOP_RC / $STUB_DOWN_RC / $STUB_UP_RC. run exits with
  # $STUB_RUN_RC (default 5) when its arguments hold `--entrypoint
  # $STUB_RUN_FAIL_ON`, and 0 otherwise. Anything else succeeds.
  cat > "$stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:-/dev/null}"
if [ "${1:-}" = "context" ] && [ "${2:-}" = "inspect" ]; then
  printf '%s\n' "unix:///var/run/docker.sock"
  exit 0
fi
if [ "${1:-}" = "compose" ]; then
  case "${4:-}" in
    config) exec "$REAL_DOCKER" "$@" ;;
    stop) exit "${STUB_STOP_RC:-0}" ;;
    down) exit "${STUB_DOWN_RC:-0}" ;;
    up) exit "${STUB_UP_RC:-0}" ;;
    run)
      if [ -n "${STUB_RUN_FAIL_ON:-}" ]; then
        prev=""
        for arg in "$@"; do
          if [ "$prev" = "--entrypoint" ] && [ "$arg" = "$STUB_RUN_FAIL_ON" ]; then
            exit "${STUB_RUN_RC:-5}"
          fi
          prev="$arg"
        done
      fi
      exit 0
      ;;
  esac
fi
exit 0
STUB
  chmod +x "$stub_dir/docker"
  # A stub npm: logs its arguments and fails. restore must not build here.
  export NPM_STUB_LOG="$WORK/npm.log"
  : > "$NPM_STUB_LOG"
  cat > "$stub_dir/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_STUB_LOG:-/dev/null}"
echo "stub npm: restore must not build the export in this check: $*" >&2
exit 64
STUB
  chmod +x "$stub_dir/npm"
  export PATH="$stub_dir:$PATH"

  local inspect="context inspect --format {{.Endpoints.docker.Host}}"
  local config="compose -f $COMPOSE_YML config"
  local c="compose -f $COMPOSE_YML"
  local long_name
  long_name="$(printf 'a%.0s' $(seq 1 65))"

  # Usage and the name rule: exit 2, no docker call.
  local verb
  for verb in snapshot restore; do
    run_both "$verb (no name)" "$verb"
    expect_rc "$verb (no name)" 2
    expect_out "$verb (no name)" "Usage: demo $verb <name>"
    expect_log "$verb (no name)" ""

    run_both "$verb (two names)" "$verb" one two
    expect_rc "$verb (two names)" 2
    expect_out "$verb (two names)" "Usage: demo $verb <name>"
    expect_log "$verb (two names)" ""

    local bad
    for bad in .hidden 'a/b' 'a b' "$long_name" $'ok\n' _x; do
      run_both "$verb (bad name '$bad')" "$verb" "$bad"
      expect_rc "$verb (bad name)" 2
      expect_out "$verb (bad name)" "$NAME_RULE"
      expect_log "$verb (bad name)" ""
    done
  done

  # AC7: no snapshots folder yet.
  run_both "snapshots (no folder)" snapshots
  expect_rc "snapshots (no folder)" 0
  expect_out "snapshots (no folder)" "$NONE"
  expect_log "snapshots (no folder)" ""

  mkdir -p "$SNAP_DIR/taken"

  # A taken name: exit 1, no docker call.
  run_both "snapshot (taken)" snapshot taken
  expect_rc "snapshot (taken)" 1
  expect_out "snapshot (taken)" "$(taken taken)"
  expect_log "snapshot (taken)" ""

  # A missing snapshot: exit 1, no docker call.
  run_both "restore (missing)" restore nope
  expect_rc "restore (missing)" 1
  expect_out "restore (missing)" "$(missing nope)"
  expect_log "restore (missing)" ""

  # AC6b: restore needs a valid PIN before anything touches docker.
  unset BUTLER_DEMO_PIN
  run_both "restore (no PIN)" restore taken
  expect_rc "restore (no PIN)" 1
  expect_out "restore (no PIN)" "$PIN_MSG"
  expect_log "restore (no PIN)" ""
  export BUTLER_DEMO_PIN=1234
  BUTLER_DEMO_PIN=12ab run_both "restore (bad PIN)" restore taken
  expect_rc "restore (bad PIN)" 1
  expect_out "restore (bad PIN)" "$PIN_MSG"
  expect_log "restore (bad PIN)" ""

  # Only the local demo stack.
  DOCKER_HOST=tcp://10.0.0.5:2376 run_both "snapshot (DOCKER_HOST tcp)" snapshot fresh
  expect_rc "snapshot (DOCKER_HOST tcp)" 1
  expect_out "snapshot (DOCKER_HOST tcp)" "$(refusal snapshot 'the Docker engine is not local (tcp://10.0.0.5:2376)')"
  expect_log "snapshot (DOCKER_HOST tcp)" ""
  DOCKER_HOST=tcp://10.0.0.5:2376 run_both "restore (DOCKER_HOST tcp)" restore taken
  expect_rc "restore (DOCKER_HOST tcp)" 1
  expect_out "restore (DOCKER_HOST tcp)" "$(refusal restore 'the Docker engine is not local (tcp://10.0.0.5:2376)')"
  expect_log "restore (DOCKER_HOST tcp)" ""
  COMPOSE_PROJECT_NAME=other run_both "snapshot (other project)" snapshot fresh
  expect_rc "snapshot (other project)" 1
  expect_out "snapshot (other project)" "$(refusal snapshot 'the compose project is not butler-demo')"
  expect_log "snapshot (other project)" "$(printf '%s\n' "$inspect" "$config")"

  # AC1: stop only Azurite, copy in a container with cp -R, start Azurite.
  local copy_call="$c run --rm --no-deps -T -v $MOUNT --entrypoint cp azurite -R /data /snapshots/fresh"
  local rm_call="$c run --rm --no-deps -T -v $MOUNT --entrypoint rm azurite -rf /snapshots/fresh"
  local up_call="$c up -d --no-deps --wait --wait-timeout 300 azurite"
  run_both "snapshot (success)" snapshot fresh
  expect_rc "snapshot (success)" 0
  expect_out "snapshot (success)" "$(printf '%s\n' "$STOPPING_AZURITE" "$(copying fresh)" "$STARTING_AZURITE" "$(saved fresh)")"
  expect_log "snapshot (success)" "$(printf '%s\n' "$inspect" "$config" "$c stop azurite" "$copy_call" "$up_call")"

  # Stopping Azurite fails: nothing is copied.
  STUB_STOP_RC=6 run_both "snapshot (stop fails)" snapshot fresh
  expect_rc "snapshot (stop fails)" 6
  expect_out "snapshot (stop fails)" "$(printf '%s\n' "$STOPPING_AZURITE" "$STOP_FAILED")"
  expect_log "snapshot (stop fails)" "$(printf '%s\n' "$inspect" "$config" "$c stop azurite")"

  # The copy fails: the partial copy is removed, Azurite still starts, and
  # the exit code is the copy's.
  STUB_RUN_FAIL_ON=cp STUB_RUN_RC=5 run_both "snapshot (copy fails)" snapshot fresh
  expect_rc "snapshot (copy fails)" 5
  expect_out "snapshot (copy fails)" "$(printf '%s\n' "$STOPPING_AZURITE" "$(copying fresh)" "$(copy_failed fresh)" "$STARTING_AZURITE")"
  expect_log "snapshot (copy fails)" "$(printf '%s\n' "$inspect" "$config" "$c stop azurite" "$copy_call" "$rm_call" "$up_call")"

  # Azurite does not come back.
  STUB_UP_RC=4 run_both "snapshot (up fails)" snapshot fresh
  expect_rc "snapshot (up fails)" 4
  expect_out "snapshot (up fails)" "$(printf '%s\n' "$STOPPING_AZURITE" "$(copying fresh)" "$STARTING_AZURITE" "$UP_FAILED")"
  expect_log "snapshot (up fails)" "$(printf '%s\n' "$inspect" "$config" "$c stop azurite" "$copy_call" "$up_call")"

  # AC2 and F1: restore stops the whole stack (down), wipes and copies in
  # containers. Each failure stops before anything starts.
  local wipe_call="$c run --rm --no-deps -T --entrypoint find azurite /data -mindepth 1 -delete"
  local restore_call="$c run --rm --no-deps -T -v $MOUNT --entrypoint cp azurite -R /snapshots/taken/. /data"
  STUB_DOWN_RC=7 run_both "restore (down fails)" restore taken
  expect_rc "restore (down fails)" 7
  expect_out "restore (down fails)" "$(printf '%s\n' "$STOPPING" "$DOWN_FAILED")"
  expect_log "restore (down fails)" "$(printf '%s\n' "$inspect" "$config" "$c down")"

  STUB_RUN_FAIL_ON=find STUB_RUN_RC=8 run_both "restore (wipe fails)" restore taken
  expect_rc "restore (wipe fails)" 8
  expect_out "restore (wipe fails)" "$(printf '%s\n' "$STOPPING" "$(restoring taken)" "$(restore_failed taken)")"
  expect_log "restore (wipe fails)" "$(printf '%s\n' "$inspect" "$config" "$c down" "$wipe_call")"

  STUB_RUN_FAIL_ON=cp STUB_RUN_RC=9 run_both "restore (copy fails)" restore taken
  expect_rc "restore (copy fails)" 9
  expect_out "restore (copy fails)" "$(printf '%s\n' "$STOPPING" "$(restoring taken)" "$(restore_failed taken)")"
  expect_log "restore (copy fails)" "$(printf '%s\n' "$inspect" "$config" "$c down" "$wipe_call" "$restore_call")"

  # #361: restore starts only Azurite and the API, never the hub (web), until
  # the dataset id has changed. The API does not come up: no web call.
  local api_up_call="$c up -d --build --wait --wait-timeout 300 azurite api"
  STUB_UP_RC=4 run_both "restore (API start fails)" restore taken
  expect_rc "restore (API start fails)" 4
  expect_out "restore (API start fails)" "$(printf '%s\n' "$STOPPING" "$(restoring taken)" "$EXPORT_FRESH" "$STARTING_API" "$STACK_FAILED")"
  expect_log "restore (API start fails)" "$(printf '%s\n' "$inspect" "$config" "$c down" "$wipe_call" "$restore_call" "$api_up_call")"

  # The stub "starts" the API, but nothing answers on 127.0.0.1:5108, so the
  # PIN sign-in fails and the hub stays down: no web call.
  run_both "restore (sign-in fails, hub stays down)" restore taken
  expect_rc "restore (sign-in fails, hub stays down)" 1
  expect_out "restore (sign-in fails, hub stays down)" "$(printf '%s\n' "$STOPPING" "$(restoring taken)" "$EXPORT_FRESH" "$STARTING_API" "$API_UP" "$SIGNING_IN" "$SIGN_IN_FAILED")"
  expect_log "restore (sign-in fails, hub stays down)" "$(printf '%s\n' "$inspect" "$config" "$c down" "$wipe_call" "$restore_call" "$api_up_call")"
  if grep -qE ' web$' <<<"$LOG"; then
    fail "restore (sign-in fails, hub stays down): the hub (web) was started"
  fi
  [ ! -s "$NPM_STUB_LOG" ] || fail "restore ran npm: $(cat "$NPM_STUB_LOG")"

  # AC7: an empty folder, then a list sorted newest first, ties by name in
  # byte order (Zeta before alpha), skipping files and invalid names.
  rmdir "$SNAP_DIR/taken"
  run_both "snapshots (empty folder)" snapshots
  expect_rc "snapshots (empty folder)" 0
  expect_out "snapshots (empty folder)" "$NONE"
  expect_log "snapshots (empty folder)" ""

  mkdir -p "$SNAP_DIR/old_one" "$SNAP_DIR/alpha" "$SNAP_DIR/Zeta" "$SNAP_DIR/beta.1" "$SNAP_DIR/.hidden"
  touch "$SNAP_DIR/notes.txt"
  touch -d '2026-03-01 09:30:00' "$SNAP_DIR/old_one"
  touch -d '2026-04-02 18:05:59' "$SNAP_DIR/alpha" "$SNAP_DIR/Zeta"
  touch -d '2026-05-10 07:00:00' "$SNAP_DIR/beta.1"
  touch -d '2026-06-01 12:00:00' "$SNAP_DIR/.hidden" "$SNAP_DIR/notes.txt"
  run_both "snapshots (list)" snapshots extra-args-are-ignored
  expect_rc "snapshots (list)" 0
  expect_out "snapshots (list)" "$(printf '%s\n' "$LIST_HEADER" \
    '  2026-05-10 07:00  beta.1' \
    '  2026-04-02 18:05  Zeta' \
    '  2026-04-02 18:05  alpha' \
    '  2026-03-01 09:30  old_one')"
  expect_log "snapshots (list)" ""

  # AC8: the README documents the three commands.
  grep -qxF '## Snapshots' "$README" || fail "demo/README.md has no '## Snapshots' section"
  local cmd
  for cmd in snapshot restore snapshots; do
    grep -qF "| \`demo.sh $cmd\` |" "$README" || fail "demo/README.md has no demo.sh $cmd table row"
    grep -qF "demo/demo.sh $cmd" "$README" || fail "demo/README.md does not show demo/demo.sh $cmd"
    grep -qF "pwsh demo/demo.ps1 $cmd" "$README" || fail "demo/README.md does not show pwsh demo/demo.ps1 $cmd"
  done
  grep -qF 'snapshot dates do not move' "$README" || fail "demo/README.md does not warn that snapshot dates do not move"
  grep -qF 'hub stays stopped until the dataset id has changed' "$README" \
    || fail "demo/README.md does not say the hub stays stopped until the dataset id has changed (#361)"
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

api_container() { docker compose -f "$COMPOSE_YML" ps -q api; }

all_healthy() {
  local health
  health="$(docker compose -f "$COMPOSE_YML" ps --format '{{.Service}} {{.Health}}')"
  echo "$health"
  [ "$(printf '%s\n' "$health" | grep -c ' healthy$' || true)" -eq 3 ] || fail "$1: not every service is healthy"
}

# create_household <token> <name>: prints the new household's id.
create_household() {
  curl -fsS -X POST "$HUB_URL/api/households" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "{\"name\":\"$2\"}" | jq -er '.householdId'
}

# http_code <token> <household id>: the status of GET /households/<id>.
http_code() {
  curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "$HUB_URL/api/households/$2"
}

# The lines the scripts print themselves, in order.
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
    -e 'Stopping Azurite \.\.\.' \
    -e 'Starting Azurite \.\.\.' \
    -e 'Copying demo/\.data/azurite to .*' \
    -e 'Snapshot saved: .*' \
    -e 'Restoring demo/\.data/azurite from .*' \
    -e 'Signing in with the demo PIN \.\.\.' \
    -e 'Changing the dataset id \.\.\.' \
    -e 'Dataset: .* -> .*' \
    -e 'Restore complete: .*' \
    -e 'Sign in with the PIN again: .*' \
    -e 'Snapshots in demo/\.data/snapshots .*' \
    -e '  [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}  .*' \
    -e 'Refusing to .*' \
    -e 'Could not .*' \
    -e 'Azurite did not become healthy\..*' \
    -e 'PIN sign-in failed\..*' \
    -e 'Changing the dataset id failed\..*' \
    -e 'The dataset id did not change.*' || true
}
# Masks the dataset ids and the CI snapshot names.
mask() { sed -E -e 's/^Dataset: .* -> .*$/Dataset: <old> -> <new>/' -e 's/ci-snap-(sh|ps)/<name>/g'; }
# Drops the export lines, which depend on the state of Butler.UI/dist.
core() {
  grep -vE '^(Hub export |Installing Butler\.UI |Recreating web )' || true
}

# run_cli <label> <sh|ps> <args...>: runs a demo script with stdin closed and
# a 600 s timeout, requires exit 0, and leaves its output in CLI_OUT and its
# masked own lines in OWN.
run_cli() {
  local label="$1" script="$2" rc
  shift 2
  set +e
  if [ "$script" = "sh" ]; then
    CLI_OUT="$(timeout 600 bash "$REPO_ROOT/demo/demo.sh" "$@" < /dev/null 2>&1)"
  else
    CLI_OUT="$(timeout 600 pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" "$@" < /dev/null 2>&1)"
  fi
  rc=$?
  set -e
  echo "== $label: exit=$rc"
  printf '%s\n' "$CLI_OUT" | own
  [ "$rc" -eq 0 ] || { printf '%s\n' "$CLI_OUT" | tail -n 40; fail "$label: expected exit 0, got $rc"; }
  OWN="$(printf '%s\n' "$CLI_OUT" | own | mask)"
}

expect_core() {
  local got
  got="$(printf '%s\n' "$OWN" | core)"
  if [ "$got" != "$2" ]; then
    diff <(printf '%s\n' "$2") <(printf '%s\n' "$got") || true
    fail "$1: unexpected lines"
  fi
}

EXPECTED_SNAPSHOT="$(printf '%s\n' "$STOPPING_AZURITE" "$(copying '<name>')" "$STARTING_AZURITE" "$(saved '<name>')")"
# #361: the hub starts only after the dataset id has changed.
EXPECTED_RESTORE="$(printf '%s\n' "$STOPPING" "$(restoring '<name>')" "$STARTING_API" "$API_UP" \
  "$SIGNING_IN" "$CHANGING" 'Dataset: <old> -> <new>' "$STARTING_HUB" "$HUB_UP" \
  "$(complete '<name>')" "$SIGN_IN_AGAIN")"

# watch_hub <log>: polls the hub's dataset endpoint every 0.2 s until killed.
# Logs nothing until the hub first stops answering (000), then 'down' once,
# then '<code> <dataset id>' for each answer. Answers from before restore's
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
# restore. cleanup also stops it.
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

# check_hub_order <label> <log> (#361): the watcher saw the hub go down, and
# every answer after that was 200 with the dataset id the API reports now, so
# the hub never served the restored data under the snapshot's id. No answer
# after down is allowed too.
check_hub_order() {
  local label="$1" log="$2" now line n=0
  now="$(dataset_now)" || fail "$label: no dataset id after the restore"
  line="$(head -n 1 "$log")"
  [ "$line" = "down" ] || fail "$label: the hub watcher never saw the hub go down (first line '$line')"
  while IFS= read -r line; do
    n=$((n + 1))
    [ "$n" -eq 1 ] && continue
    [ "$line" = "200 $now" ] \
      || fail "$label: the hub answered '$line' (watcher line $n) before the dataset id changed to $now"
  done < "$log"
  echo "$label: the hub stayed down until the dataset id changed ($((n - 1)) answers, all '200 $now')"
}

# check_restore <label> <snapshot id> <old token> <old api container> <marker> <later>
check_restore() {
  local label="$1" snap="$2" old_token="$3" old_api="$4" marker="$5" later="$6" line new now api token code
  expect_core "$label" "$EXPECTED_RESTORE"
  # AC6: the dataset line names the snapshot's id and a new one, which the
  # API now reports.
  line="$(printf '%s\n' "$CLI_OUT" | grep -E '^Dataset: .* -> .*$')"
  new="${line##* -> }"
  [ "$line" = "Dataset: $snap -> $new" ] || fail "$label: expected 'Dataset: $snap -> <new>', got '$line'"
  [ -n "$new" ] && [ "$new" != "$snap" ] || fail "$label: the dataset id did not change ($snap)"
  now="$(dataset_now)" || fail "$label: no dataset id after the restore"
  [ "$now" = "$new" ] || fail "$label: the restore printed $new but the API reports $now"
  # F1: down recreated the api container, so the old PIN token is gone.
  api="$(api_container)"
  [ -n "$api" ] && [ "$api" != "$old_api" ] || fail "$label: the api container was not recreated ($old_api)"
  code="$(http_code "$old_token" "$marker")"
  [ "$code" = "401" ] || fail "$label: the pre-restore token still works (HTTP $code)"
  # AC2: the data is the snapshot's.
  token="$(sign_in)" || fail "$label: PIN sign-in failed after the restore"
  code="$(http_code "$token" "$marker")"
  [ "$code" = "200" ] || fail "$label: household $marker from before the snapshot is missing (HTTP $code)"
  code="$(http_code "$token" "$later")"
  [ "$code" = "404" ] || fail "$label: household $later from after the snapshot survived the restore (HTTP $code)"
  all_healthy "$label"
  echo "$label: dataset $snap -> $new, api recreated, $marker back, $later gone"
}

stack_mode() {
  command -v curl >/dev/null 2>&1 || fail "curl must be on PATH"
  command -v jq >/dev/null 2>&1 || fail "jq must be on PATH"
  [ -n "$(demo_pin)" ] || fail "set BUTLER_DEMO_PIN or demo/.env"
  [ ! -e "$SNAP_DIR/ci-snap-sh" ] && [ ! -e "$SNAP_DIR/ci-snap-ps" ] \
    || fail "demo/.data/snapshots/ci-snap-sh or ci-snap-ps exists; delete it first"
  CLEANUP_STACK=1
  local token marker later d0 api0 code sh_restore

  token="$(sign_in)" || fail "PIN sign-in failed before the snapshot"
  marker="$(create_household "$token" "Snapshot CI Marker")" || fail "could not create the marker household"
  d0="$(dataset_now)" || fail "the stack is not up (no dataset id)"
  api0="$(api_container)"

  # AC1: demo.sh snapshot. Only Azurite restarts: the api keeps its container
  # and the organizer's token.
  run_cli "demo.sh snapshot" sh snapshot ci-snap-sh
  expect_core "demo.sh snapshot" "$EXPECTED_SNAPSHOT"
  [ -d "$SNAP_DIR/ci-snap-sh" ] || fail "demo.sh snapshot: demo/.data/snapshots/ci-snap-sh was not created"
  all_healthy "demo.sh snapshot"
  [ "$(api_container)" = "$api0" ] || fail "demo.sh snapshot: the api container changed"
  code="$(http_code "$token" "$marker")"
  [ "$code" = "200" ] || fail "demo.sh snapshot: the organizer token stopped working (HTTP $code)"

  # AC7: snapshots lists it.
  run_cli "demo.sh snapshots" sh snapshots
  grep -qE '^  [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}  ci-snap-sh$' <<<"$CLI_OUT" \
    || fail "demo.sh snapshots does not list ci-snap-sh"

  # AC2, AC6, F1: demo.sh restore.
  later="$(create_household "$token" "Snapshot CI Later")" || fail "could not create the later household"
  start_watch "$WORK/hub-sh.log"
  run_cli "demo.sh restore" sh restore ci-snap-sh
  stop_watch
  sh_restore="$OWN"
  check_hub_order "demo.sh restore" "$WORK/hub-sh.log"
  check_restore "demo.sh restore" "$d0" "$token" "$api0" "$marker" "$later"

  # demo.ps1 snapshot prints the same lines.
  local sh_snapshot
  sh_snapshot="$EXPECTED_SNAPSHOT"
  run_cli "demo.ps1 snapshot" ps snapshot ci-snap-ps
  expect_core "demo.ps1 snapshot" "$sh_snapshot"
  [ -d "$SNAP_DIR/ci-snap-ps" ] || fail "demo.ps1 snapshot: demo/.data/snapshots/ci-snap-ps was not created"
  all_healthy "demo.ps1 snapshot"

  # demo.ps1 restore of the same snapshot: same lines, same checks.
  token="$(sign_in)" || fail "PIN sign-in failed before demo.ps1 restore"
  api0="$(api_container)"
  later="$(create_household "$token" "Snapshot CI Later 2")" || fail "could not create the second later household"
  start_watch "$WORK/hub-ps.log"
  run_cli "demo.ps1 restore" ps restore ci-snap-sh
  stop_watch
  check_hub_order "demo.ps1 restore" "$WORK/hub-ps.log"
  if [ "$OWN" != "$sh_restore" ]; then
    diff <(printf '%s\n' "$sh_restore") <(printf '%s\n' "$OWN") || true
    fail "demo.sh and demo.ps1 restore print different lines"
  fi
  check_restore "demo.ps1 restore" "$d0" "$token" "$api0" "$marker" "$later"
}

if [ "$mode" = "static" ]; then
  static_mode
else
  stack_mode
fi

echo "check-snapshot.sh $mode: all checks passed"
