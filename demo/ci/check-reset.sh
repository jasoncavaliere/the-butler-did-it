#!/usr/bin/env bash
# Checks the demo CLI's reset subcommand (#98) through both demo/demo.sh and
# demo/demo.ps1.
#
# Usage: bash demo/ci/check-reset.sh static|stack
#   static - a stub docker, no stack. A missing PIN (AC8b) and every
#            non-local target (AC7: a remote DOCKER_HOST, an ssh context,
#            another compose project, an api that does not store its data in
#            the azurite service, another Azurite data folder, a compose file
#            that does not render) exit 1 with the exact message and make no
#            down, run or up call. A failed down deletes nothing, a failed
#            wipe does not start the stack, and the wipe is the exact
#            in-container find. Also checks that demo/README.md documents
#            reset (AC8). Refuses to run when demo/.env exists: these cases
#            need control of the PIN.
#   stack  - needs the stack up (demo/demo.sh up) and BUTLER_DEMO_PIN (from
#            the shell or demo/.env). DELETES THE LOCAL DEMO DATA. Runs
#            demo.sh reset, demo.ps1 reset and a reset from a stopped stack,
#            each with stdin closed (AC1, AC2), and after each one checks the
#            seeded household (AC3-AC5), that the dataset id changed (AC6), and
#            that a household created before the reset is gone.
#
# static runs both scripts in every case and fails unless their output
# (stdout and stderr together), exit code and docker calls are identical.
# stack compares the lines the scripts print themselves (docker and npm
# output varies run to run), with the dataset ids masked.
# Needs bash, pwsh (PowerShell 7) and docker; stack also needs curl and jq.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  static|stack) ;;
  *)
    echo "Usage: bash demo/ci/check-reset.sh static|stack" >&2
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_YML="$REPO_ROOT/demo/docker-compose.yml"
README="$REPO_ROOT/demo/README.md"
HUB_URL="http://localhost:8080"

PIN_MSG='demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md.'
STOPPING='Stopping the demo stack ...'
DELETING='Deleting the demo data in demo/.data/azurite ...'
DOWN_FAILED='Could not stop the demo stack. Nothing was deleted.'
WIPE_FAILED='Could not delete the demo data in demo/.data/azurite.'
SIGNING_IN='Signing in with the demo PIN ...'
SEEDING='Seeding the demo household ...'
COMPLETE="Demo reset complete: the demo household is seeded at $HUB_URL"
PAIR_AGAIN='Sign in with the PIN and pair the tablet again: the reset cleared organizer sessions and hub pairings.'
WIPE_CALL="compose -f $COMPOSE_YML run --rm --no-deps -T --entrypoint find azurite /data -mindepth 1 -delete"
refusal() { echo "Refusing to reset: $1. reset only runs against the local demo stack."; }

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker must be on PATH"
command -v pwsh >/dev/null 2>&1 || fail "pwsh (PowerShell 7) must be on PATH"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

static_mode() {
  [ ! -e "$REPO_ROOT/demo/.env" ] || fail "demo/.env exists; move it aside to run the static checks"
  unset DOCKER_HOST DOCKER_CONTEXT COMPOSE_PROJECT_NAME
  export BUTLER_DEMO_PIN=1234

  REAL_DOCKER="$(command -v docker)"
  export REAL_DOCKER
  local stub_dir="$WORK/bin"
  mkdir -p "$stub_dir"
  export DOCKER_STUB_LOG="$WORK/docker.log"
  : > "$DOCKER_STUB_LOG"

  # A stub docker: logs its arguments. `context inspect` prints
  # $STUB_ENDPOINT (a local socket by default). `compose ... config` prints
  # $STUB_CONFIG_FILE when set, fails with $STUB_CONFIG_RC when set, and
  # otherwise renders the real compose file. down and run exit with
  # $STUB_DOWN_RC / $STUB_RUN_RC; anything else succeeds.
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
  esac
fi
exit 0
STUB
  chmod +x "$stub_dir/docker"
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

  # AC8: the README documents reset.
  grep -qxF '## Reset the demo' "$README" || fail "demo/README.md has no '## Reset the demo' section"
  grep -qF 'demo/demo.sh reset' "$README" || fail "demo/README.md does not show demo/demo.sh reset"
  grep -qF 'pwsh demo/demo.ps1 reset' "$README" || fail "demo/README.md does not show pwsh demo/demo.ps1 reset"
  grep -qF '| `demo.sh reset` |' "$README" || fail "demo/README.md has no demo.sh reset table row"
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

EXPECTED_CORE="$(printf '%s\n' "$STOPPING" "$DELETING" 'Starting the demo stack ...' \
  'Demo stack is up and healthy: http://localhost:8080' "$SIGNING_IN" "$SEEDING" \
  'Dataset: <old> -> <new>' "$COMPLETE" "$PAIR_AGAIN")"

# A household that the reset must delete.
make_leftover() {
  local token
  token="$(sign_in)" || fail "PIN sign-in failed before the reset"
  curl -fsS -X POST "$HUB_URL/api/households" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d '{"name":"Reset CI Leftover"}' | jq -er '.householdId'
}

# run_reset <label> <sh|ps> <dataset before>: runs reset with stdin closed and
# a 600 s timeout, checks its own lines and the dataset line, and leaves the
# masked own lines in OWN.
run_reset() {
  local label="$1" script="$2" before="$3" out rc line new now
  set +e
  if [ "$script" = "sh" ]; then
    out="$(timeout 600 bash "$REPO_ROOT/demo/demo.sh" reset < /dev/null 2>&1)"
  else
    out="$(timeout 600 pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" reset < /dev/null 2>&1)"
  fi
  rc=$?
  set -e
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
else
  stack_mode
fi

echo "check-reset.sh $mode: all checks passed"
