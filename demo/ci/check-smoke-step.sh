#!/usr/bin/env bash
# Checks the smoke step that up runs once the stack is healthy (#103),
# through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-smoke-step.sh
#
# up runs the smoke suite with the host .NET SDK from Butler.API/, with
# BUTLER_SMOKE_BASE_URL=http://localhost:8080/api/, the Azurite string on
# 127.0.0.1:10012 and the demo PIN in its environment, filtered to the
# Liveness and Endpoints categories (never Demo):
#   pass      - the suite passes: up prints the Demo ready line last and
#               exits 0 (AC1, AC2, AC4, AC5, AC8b).
#   fail      - the suite fails: up prints "Smoke check failed: <name>" on
#               stderr once per failed test, in order, then the not-ready
#               line, never Demo ready, and exits 1 (AC6).
#   nosdk     - dotnet --list-sdks prints nothing: up prints the SDK message
#               and exits 1 before npm or docker run (AC7).
#   unhealthy - compose up fails: up never runs the smoke suite.
# Every case compares demo.sh with demo.ps1 and fails unless their stdout,
# stderr, exit code and the stub calls (dotnet and docker, in order, with the
# working directory and environment dotnet test got) are identical.
#
# A fresh, stamped hub export is put in Butler.UI/dist so up never builds; a
# stub npm fails if called, a stub docker only logs (and fails compose up in
# the unhealthy case), and a stub dotnet prints test output captured from a
# real VSTest run. No real stack, SDK or test run is needed. An existing
# Butler.UI/dist is moved aside and put back on exit. Needs bash, GNU touch
# and pwsh (PowerShell 7).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="$(cd "$REPO_ROOT/Butler.API" && pwd -P)"
DIST="$REPO_ROOT/Butler.UI/dist"
DATA_DIR="$REPO_ROOT/demo/.data"
LOGS_DIR="$DATA_DIR/logs"
README="$REPO_ROOT/demo/README.md"

L_FRESH='Hub export is up to date (Butler.UI/dist).'
L_STARTING='Starting the demo stack ...'
L_HEALTHY='Demo stack is up and healthy: http://localhost:8080'
L_UNHEALTHY='Demo stack did not become healthy. Run the logs command to see why.'
L_RUNNING='Running the smoke suite against http://localhost:8080/api/ ...'
L_READY='Demo ready: hub http://localhost:8080 | API http://localhost:8080/api/health | Swagger http://localhost:5108/swagger'
L_NOT_READY='Demo is not ready: the smoke suite failed. Run the logs command to see why.'
L_NO_SDK='The .NET SDK is required for the smoke step that up runs, and none was found. Install the .NET 10 SDK, then run up again. See demo/README.md.'
L_COMPOSE_UP='up -d --build --wait --wait-timeout 300'
SMOKE_CONN='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10012/devstoreaccount1;'
# The #193 file-log warning: a root-owned demo/.data on a developer machine
# prints it, so the exact-stdout checks ignore it (check-logs-dir.sh covers it).
LOGS_WARNING='WARNING: The API file log is off. up could not make demo/.data/logs writable for the API container.
demo/.data is probably owned by root from an earlier run. The stack still starts, without the API log files.
To fix it, run down, then this from the repo root, then up again:
  sudo chown -R "$(id -u):$(id -g)" demo/.data'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

WORK="$(mktemp -d)"
DIST_SAVED="$WORK/dist-saved"
# up reaches ensure_logs_dir, which creates demo/.data/logs. Remove only what
# this check created.
DATA_EXISTED=0
LOGS_EXISTED=0
[ -e "$DATA_DIR" ] && DATA_EXISTED=1
[ -e "$LOGS_DIR" ] && LOGS_EXISTED=1
cleanup() {
  set +e
  rm -rf "$DIST"
  if [ -d "$DIST_SAVED" ]; then
    mv "$DIST_SAVED" "$DIST"
  fi
  if [ "$DATA_EXISTED" -eq 0 ]; then
    rm -rf "$DATA_DIR"
  elif [ "$LOGS_EXISTED" -eq 0 ]; then
    rm -rf "$LOGS_DIR"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
if [ -e "$DIST" ]; then
  mv "$DIST" "$DIST_SAVED"
fi

# A fresh export with a valid stamp (#184), newer than index.html, so up
# reports it up to date and never calls npm.
mkdir -p "$DIST"
echo '<!doctype html><title>stub export</title>' > "$DIST/index.html"
printf 'EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_AUTH_PROVIDER=pin\nEXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household\n' > "$DIST/.demo-build-env"
touch -d "@$(( $(date +%s) + 60 ))" "$DIST/.demo-build-env"

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export CALL_LOG="$WORK/calls.log"
export NPM_STUB_LOG="$WORK/npm.log"
: > "$CALL_LOG"
: > "$NPM_STUB_LOG"

# A stub npm: logs its arguments and fails. up must not build here.
cat > "$STUB_DIR/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_STUB_LOG:-/dev/null}"
echo "stub npm: up must not build the export in this check: $*" >&2
exit 64
STUB
# A stub docker: logs its arguments to the shared call log and succeeds,
# except compose up when STUB_DOCKER_MODE=unhealthy.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "${CALL_LOG:-/dev/null}"
if [ "${STUB_DOCKER_MODE:-}" = "unhealthy" ]; then
  case " $* " in
    *" up "*) exit 1 ;;
  esac
fi
exit 0
STUB
# A stub dotnet. Anything but --list-sdks and test goes to the real dotnet,
# if there is one: a pwsh installed as a .NET global tool starts through
# `dotnet pwsh.dll`. --list-sdks prints one SDK unless STUB_DOTNET_MODE=nosdk.
# test logs its arguments, working directory and smoke environment, then
# prints output captured from a real VSTest run (MSBUILDTERMINALLOGGER=off,
# console;verbosity=normal): passing in pass mode; in fail mode, failing,
# with one Failed line repeated (up names it once) and exit 1.
export REAL_DOTNET="$(command -v dotnet || true)"
cat > "$STUB_DIR/dotnet" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  --list-sdks | test) ;;
  *) [ -n "${REAL_DOTNET:-}" ] && exec "$REAL_DOTNET" "$@" ;;
esac
log="${CALL_LOG:-/dev/null}"
printf 'dotnet %s\n' "$*" >> "$log"
if [ "${1:-}" = "--list-sdks" ]; then
  [ "${STUB_DOTNET_MODE:-}" = "nosdk" ] || echo '10.0.100 [/usr/share/dotnet/sdk]'
  exit 0
fi
if [ "${1:-}" != "test" ]; then
  echo "stub dotnet: unexpected arguments: $*" >&2
  exit 64
fi
{
  printf '  cwd=%s\n' "$(pwd -P)"
  printf '  BUTLER_SMOKE_BASE_URL=%s\n' "${BUTLER_SMOKE_BASE_URL-<unset>}"
  printf '  BUTLER_SMOKE_STORAGE_CONNECTION_STRING=%s\n' "${BUTLER_SMOKE_STORAGE_CONNECTION_STRING-<unset>}"
  printf '  BUTLER_SMOKE_ORGANIZER_PIN=%s\n' "${BUTLER_SMOKE_ORGANIZER_PIN-<unset>}"
  printf '  MSBUILDTERMINALLOGGER=%s\n' "${MSBUILDTERMINALLOGGER-<unset>}"
  printf '  DOTNET_NOLOGO=%s\n' "${DOTNET_NOLOGO-<unset>}"
} >> "$log"
echo 'Test run for /src/Butler.Api.SmokeTests/bin/Debug/net10.0/Butler.Api.SmokeTests.dll (.NETCoreApp,Version=v10.0)'
echo 'A total of 1 test files matched the specified pattern.'
if [ "${STUB_DOTNET_MODE:-}" = "fail" ]; then
  cat <<'OUT'
[xUnit.net 00:00:00.21]     Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity [FAIL]
[xUnit.net 00:00:00.21]       System.Net.Http.HttpRequestException : Connection refused (127.0.0.1:9)
  Failed Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity [31 ms]
  Error Message:
   System.Net.Http.HttpRequestException : Connection refused (127.0.0.1:9)
---- System.Net.Sockets.SocketException : Connection refused
  Stack Trace:
--- End of stack trace from previous location ---
----- Inner Stack Trace -----
  Failed Butler.Api.SmokeTests.LivenessSmokeTests.Get_health_returns_200_with_status_ok [2 ms]
  Error Message:
   System.Net.Http.HttpRequestException : Connection refused (127.0.0.1:9)
---- System.Net.Sockets.SocketException : Connection refused
  Passed Butler.Api.SmokeTests.RoomsHttpRoundTripSmokeTests.Get_room_returns_200_with_its_etag [40 ms]
  Failed Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity [31 ms]

Test Run Failed.
Total tests: 3
     Passed: 1
     Failed: 2
 Total time: 0.6772 Seconds
OUT
  exit 1
fi
cat <<'OUT'
  Passed Butler.Api.SmokeTests.LivenessSmokeTests.Get_health_returns_200_with_status_ok [12 ms]
  Passed Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity [3 ms]

Test Run Successful.
Total tests: 2
     Passed: 2
 Total time: 0.5120 Seconds
OUT
exit 0
STUB
chmod +x "$STUB_DIR/npm" "$STUB_DIR/docker" "$STUB_DIR/dotnet"

# up checks the PIN before anything else. A fixed SHA keeps the runs alike.
# TMPDIR is watched: demo.sh must remove its smoke log on every path.
export BUTLER_DEMO_PIN=1234
export BUTLER_BUILD_SHA=0000000
export TMPDIR="$WORK/tmp"
mkdir -p "$TMPDIR"
export PATH="$STUB_DIR:$PATH"
unset BUTLER_SMOKE_BASE_URL BUTLER_SMOKE_STORAGE_CONNECTION_STRING BUTLER_SMOKE_ORGANIZER_PIN MSBUILDTERMINALLOGGER DOTNET_NOLOGO

# run_up <script> <tag>: runs `up` through demo.sh or demo.ps1 and saves its
# stdout, stderr, exit code and calls in $WORK/<tag>.*.
run_up() {
  local script="$1" tag="$2" rc
  : > "$CALL_LOG"
  : > "$NPM_STUB_LOG"
  set +e
  if [ "$script" = "sh" ]; then
    bash "$REPO_ROOT/demo/demo.sh" up > "$WORK/$tag.out" 2> "$WORK/$tag.err"
  else
    pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" up > "$WORK/$tag.out" 2> "$WORK/$tag.err"
  fi
  rc=$?
  set -e
  echo "$rc" > "$WORK/$tag.rc"
  cp "$CALL_LOG" "$WORK/$tag.calls"
  cp "$NPM_STUB_LOG" "$WORK/$tag.npm"
  if [ -n "$(ls -A "$TMPDIR")" ]; then
    fail "demo.$script up left files in TMPDIR: $(ls -A "$TMPDIR")"
  fi
}

same() {
  local label="$1" what="$2" a="$3" b="$4"
  if ! cmp -s "$a" "$b"; then
    diff "$a" "$b" || true
    fail "$label: demo.sh and demo.ps1 differ in $what"
  fi
}

# expect_file <label> <what> <expected text> <file>: the file holds exactly
# the expected lines (the #193 warning ignored).
expect_file() {
  local label="$1" what="$2" expected="$3" file="$4" actual
  actual="$(grep -vxF -e "$(printf '%s\n' "$LOGS_WARNING" | sed -n 1p)" \
    -e "$(printf '%s\n' "$LOGS_WARNING" | sed -n 2p)" \
    -e "$(printf '%s\n' "$LOGS_WARNING" | sed -n 3p)" \
    -e "$(printf '%s\n' "$LOGS_WARNING" | sed -n 4p)" "$file" || true)"
  if [ "$actual" != "$expected" ]; then
    diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") || true
    fail "$label: unexpected $what"
  fi
}

# run_case <label> <dotnet mode> <docker mode>: runs up once through each
# script with the same stubs and requires identical results; leaves the
# demo.sh results in OUT/ERR/RC/CALLS/NPM.
run_case() {
  local label="$1" script
  export STUB_DOTNET_MODE="$2" STUB_DOCKER_MODE="$3"
  for script in sh ps; do
    run_up "$script" "$script"
  done
  echo "== $label: demo.sh exit=$(cat "$WORK/sh.rc") demo.ps1 exit=$(cat "$WORK/ps.rc")"
  cat "$WORK/sh.out"
  cat "$WORK/sh.err"
  same "$label" "stdout" "$WORK/sh.out" "$WORK/ps.out"
  same "$label" "stderr" "$WORK/sh.err" "$WORK/ps.err"
  same "$label" "exit codes" "$WORK/sh.rc" "$WORK/ps.rc"
  same "$label" "dotnet and docker calls" "$WORK/sh.calls" "$WORK/ps.calls"
  RC="$(cat "$WORK/sh.rc")"
  CALLS="$(cat "$WORK/sh.calls")"
  [ ! -s "$WORK/sh.npm" ] && [ ! -s "$WORK/ps.npm" ] || fail "$label: npm must not be called"
  if grep -qF '1234' "$WORK/sh.out" "$WORK/sh.err"; then
    fail "$label: up printed the PIN"
  fi
}

# The calls up makes when the stack comes up and the smoke step runs.
SMOKE_CALLS="$(printf '%s\n' \
  'dotnet --list-sdks' \
  "docker compose -f $REPO_ROOT/demo/docker-compose.yml $L_COMPOSE_UP" \
  'dotnet test src/Butler.Api.SmokeTests/Butler.Api.SmokeTests.csproj --filter Category=Liveness|Category=Endpoints --logger console;verbosity=normal' \
  "  cwd=$API_DIR" \
  '  BUTLER_SMOKE_BASE_URL=http://localhost:8080/api/' \
  "  BUTLER_SMOKE_STORAGE_CONNECTION_STRING=$SMOKE_CONN" \
  '  BUTLER_SMOKE_ORGANIZER_PIN=1234' \
  '  MSBUILDTERMINALLOGGER=off' \
  '  DOTNET_NOLOGO=1')"

# pass (AC1, AC2, AC4, AC5, AC8b): one dotnet test, after compose up, from
# Butler.API/, with the smoke environment; Demo ready is the last line.
run_case "smoke suite passes" pass ""
[ "$RC" -eq 0 ] || fail "pass: expected exit 0, got $RC"
[ "$CALLS" = "$SMOKE_CALLS" ] || { diff <(printf '%s\n' "$SMOKE_CALLS") <(printf '%s\n' "$CALLS") || true; fail "pass: unexpected calls"; }
case "$CALLS" in
  *Demo*) fail "pass: the filter must not include the Demo category" ;;
esac
expect_file "pass" "stdout" "$(printf '%s\n' "$L_FRESH" "$L_STARTING" "$L_HEALTHY" "$L_RUNNING" \
  'Test run for /src/Butler.Api.SmokeTests/bin/Debug/net10.0/Butler.Api.SmokeTests.dll (.NETCoreApp,Version=v10.0)' \
  'A total of 1 test files matched the specified pattern.' \
  '  Passed Butler.Api.SmokeTests.LivenessSmokeTests.Get_health_returns_200_with_status_ok [12 ms]' \
  '  Passed Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity [3 ms]' \
  '' \
  'Test Run Successful.' \
  'Total tests: 2' \
  '     Passed: 2' \
  ' Total time: 0.5120 Seconds' \
  "$L_READY")" "$WORK/sh.out"
[ "$(tail -n 1 "$WORK/sh.out")" = "$L_READY" ] || fail "pass: the last stdout line is not the Demo ready line"
[ ! -s "$WORK/sh.err" ] || fail "pass: stderr must be empty"

# fail (AC6): each failed test named once, in order, then the not-ready line.
run_case "smoke suite fails" fail ""
[ "$RC" -eq 1 ] || fail "fail: expected exit 1, got $RC"
[ "$CALLS" = "$SMOKE_CALLS" ] || fail "fail: unexpected calls: $CALLS"
expect_file "fail" "stderr" "$(printf '%s\n' \
  'Smoke check failed: Butler.Api.SmokeTests.LivenessSmokeTests.Get_ping_returns_200_with_service_identity' \
  'Smoke check failed: Butler.Api.SmokeTests.LivenessSmokeTests.Get_health_returns_200_with_status_ok' \
  "$L_NOT_READY")" "$WORK/sh.err"
if grep -qF 'Demo ready' "$WORK/sh.out"; then
  fail "fail: up printed Demo ready after a failed smoke check"
fi
[ "$(tail -n 1 "$WORK/sh.out")" = ' Total time: 0.6772 Seconds' ] || fail "fail: the test output did not stream to stdout"

# nosdk (AC7): the SDK message and exit 1 before docker or npm run.
run_case "no .NET SDK" nosdk ""
[ "$RC" -eq 1 ] || fail "nosdk: expected exit 1, got $RC"
[ "$CALLS" = 'dotnet --list-sdks' ] || fail "nosdk: expected only 'dotnet --list-sdks', got: $CALLS"
[ ! -s "$WORK/sh.out" ] || fail "nosdk: stdout must be empty"
expect_file "nosdk" "stderr" "$L_NO_SDK" "$WORK/sh.err"

# unhealthy: compose up fails, so the smoke suite never runs.
run_case "stack not healthy" pass unhealthy
[ "$RC" -ne 0 ] || fail "unhealthy: expected a non-zero exit"
case "$CALLS" in
  *"dotnet test"*) fail "unhealthy: the smoke suite ran: $CALLS" ;;
esac
expect_file "unhealthy" "stderr" "$L_UNHEALTHY" "$WORK/sh.err"
expect_file "unhealthy" "stdout" "$(printf '%s\n' "$L_FRESH" "$L_STARTING")" "$WORK/sh.out"

# AC8: demo/README.md documents the smoke step and its prerequisite.
for text in '.NET 10 SDK' "$L_READY" "$L_NO_SDK" 'Smoke check failed: ' '127.0.0.1:10012'; do
  grep -qF -- "$text" "$README" || fail "demo/README.md must contain: $text"
done

echo "check-smoke-step.sh: all checks passed"
