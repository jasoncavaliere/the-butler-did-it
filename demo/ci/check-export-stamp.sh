#!/usr/bin/env bash
# Checks that up rebuilds a hub export it did not build with the demo
# settings (#184), through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-export-stamp.sh
#
# After each successful build:web, up writes Butler.UI/dist/.demo-build-env,
# a stamp holding the EXPO_PUBLIC_* values the hub was built with. An export
# without a matching stamp that is at least as new as dist/index.html (for
# example one built by hand without EXPO_PUBLIC_API_BASE_URL=/api) must be
# rebuilt by the next up (AC1):
#   Case A: no stamp.
#   Case B: a stamp for another API base (localhost:5108).
#   Case C: a valid stamp that is older than dist/index.html.
# And the export must not be rebuilt when the stamp matches:
#   Case D: a valid stamp, newer than dist/index.html.
#   Case F: the same stamp with CRLF line endings.
# The mtime check still comes first:
#   Case E: no stamp and an export older than its sources is reported stale.
# Every run compares demo.sh with demo.ps1 and fails unless their output
# (stdout and stderr together), exit code, stub npm and docker calls and the
# stamp's bytes are identical (AC2). The cross-script cases check that a
# stamp one script writes is up to date for the other.
#
# A stub npm builds a fake export (`run build:web` replaces dist with a new
# index.html and logs the EXPO_PUBLIC_* values it got); a stub docker only
# logs and succeeds, so no real stack starts. Runs the real scripts against
# the real Butler.UI/ folder. An existing Butler.UI/dist is moved aside and
# put back on exit. Needs bash, GNU touch and pwsh (PowerShell 7); no Node,
# no Docker and no stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_DIR="$REPO_ROOT/Butler.UI"
DIST="$UI_DIR/dist"
MARKER="$DIST/index.html"
STAMP="$DIST/.demo-build-env"
DATA_DIR="$REPO_ROOT/demo/.data"
LOGS_DIR="$DATA_DIR/logs"

L_STALE='Hub export is older than its sources; building Butler.UI/dist ...'
L_MISSING='Hub export is missing; building Butler.UI/dist ...'
L_UNSTAMPED='Hub export was not built with the demo settings; building Butler.UI/dist ...'
L_FRESH='Hub export is up to date (Butler.UI/dist).'
L_RECREATE='Recreating web to serve the new export ...'
L_HEALTHY='Demo stack is up and healthy: http://localhost:8080'
L_BUILD_ENV='EXPO_PUBLIC_API_BASE_URL=/api EXPO_PUBLIC_AUTH_PROVIDER=pin'

WORK="$(mktemp -d)"
SAVED="$WORK/dist-saved"
# up now reaches ensure_logs_dir, which creates demo/.data/logs. Remove only
# what this check created.
DATA_EXISTED=0
LOGS_EXISTED=0
[ -e "$DATA_DIR" ] && DATA_EXISTED=1
[ -e "$LOGS_DIR" ] && LOGS_EXISTED=1
cleanup() {
  rm -rf "$DIST"
  if [ -d "$SAVED" ]; then
    mv "$SAVED" "$DIST"
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
  mv "$DIST" "$SAVED"
fi

# The exact bytes up must write: LF only, no BOM, a final LF.
EXPECTED="$WORK/expected.stamp"
printf 'EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_AUTH_PROVIDER=pin\n' > "$EXPECTED"

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export NPM_STUB_LOG="$WORK/npm.log"
export DOCKER_STUB_LOG="$WORK/docker.log"
: > "$NPM_STUB_LOG"
: > "$DOCKER_STUB_LOG"

# A stub npm: logs its arguments. `ci` succeeds; `run build:web` also logs
# the EXPO_PUBLIC_* values it got, then replaces dist with a new index.html,
# as expo export does. Both scripts run it from Butler.UI/.
cat > "$STUB_DIR/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_STUB_LOG:-/dev/null}"
case "$1" in
  ci)
    exit 0
    ;;
esac
if [ "$*" = "run build:web" ]; then
  printf 'EXPO_PUBLIC_API_BASE_URL=%s EXPO_PUBLIC_AUTH_PROVIDER=%s\n' \
    "${EXPO_PUBLIC_API_BASE_URL-}" "${EXPO_PUBLIC_AUTH_PROVIDER-}" >> "${NPM_STUB_LOG:-/dev/null}"
  rm -rf dist
  mkdir -p dist
  echo '<!doctype html><title>stub export</title>' > dist/index.html
  exit 0
fi
echo "stub npm: unexpected arguments: $*" >&2
exit 64
STUB
# A stub docker: logs its arguments and succeeds, so up runs to the end
# without starting a real stack.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$STUB_DIR/npm" "$STUB_DIR/docker"

# up checks the PIN before anything else. A fixed SHA keeps the runs alike.
export BUTLER_DEMO_PIN=1234
export BUTLER_BUILD_SHA=0000000
export PATH="$STUB_DIR:$PATH"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Epoch seconds one minute from now, for a stamp newer than a fresh marker.
later() { echo "@$(( $(date +%s) + 60 ))"; }

new_export() {
  rm -rf "$DIST"
  mkdir -p "$DIST"
  echo '<!doctype html><title>hand-built export</title>' > "$MARKER"
}

# Puts Butler.UI/dist in the state a case starts from.
setup_missing() {
  rm -rf "$DIST"
}
setup_no_stamp() {
  new_export
}
setup_wrong_stamp() {
  new_export
  printf 'EXPO_PUBLIC_API_BASE_URL=http://localhost:5108\nEXPO_PUBLIC_AUTH_PROVIDER=pin\n' > "$STAMP"
  touch -d "$(later)" "$STAMP"
}
setup_old_stamp() {
  new_export
  cp "$EXPECTED" "$STAMP"
  touch -d '2001-01-01 00:00:00' "$STAMP"
}
setup_valid_stamp() {
  new_export
  cp "$EXPECTED" "$STAMP"
  touch -d "$(later)" "$STAMP"
}
setup_crlf_stamp() {
  new_export
  printf 'EXPO_PUBLIC_API_BASE_URL=/api\r\nEXPO_PUBLIC_AUTH_PROVIDER=pin\r\n' > "$STAMP"
  touch -d "$(later)" "$STAMP"
}
setup_stale_no_stamp() {
  new_export
  touch -d '2000-01-01 00:00:00' "$MARKER"
}

# run_up <script> <tag>: runs `up` through demo.sh or demo.ps1 and saves its
# output, exit code, npm and docker calls and the stamp's bytes (or "absent")
# in $WORK/<tag>.*.
run_up() {
  local script="$1" tag="$2" rc
  : > "$NPM_STUB_LOG"
  : > "$DOCKER_STUB_LOG"
  set +e
  if [ "$script" = "sh" ]; then
    bash "$REPO_ROOT/demo/demo.sh" up > "$WORK/$tag.out" 2>&1
  else
    pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" up > "$WORK/$tag.out" 2>&1
  fi
  rc=$?
  set -e
  echo "$rc" > "$WORK/$tag.rc"
  cp "$NPM_STUB_LOG" "$WORK/$tag.npm"
  cp "$DOCKER_STUB_LOG" "$WORK/$tag.docker"
  if [ -f "$STAMP" ]; then
    cp "$STAMP" "$WORK/$tag.stamp"
  else
    echo "absent" > "$WORK/$tag.stamp"
  fi
}

same() {
  local label="$1" what="$2" a="$3" b="$4"
  if ! cmp -s "$a" "$b"; then
    diff "$a" "$b" || true
    fail "$label: demo.sh and demo.ps1 differ in $what"
  fi
}

# load <tag>: puts a run's results in OUT/RC/NPM/DOCKER; STAMP_FILE is the
# saved copy of the stamp.
load() {
  OUT="$(cat "$WORK/$1.out")"; RC="$(cat "$WORK/$1.rc")"
  NPM="$(cat "$WORK/$1.npm")"; DOCKER="$(cat "$WORK/$1.docker")"
  STAMP_FILE="$WORK/$1.stamp"
}

# run_case <label> <setup>: from the same starting state, runs up twice
# through each script, requires identical results, and leaves the demo.sh
# results in $WORK/sh.1.* and $WORK/sh.2.*.
run_case() {
  local label="$1" setup="$2" script n
  for script in sh ps; do
    "$setup"
    run_up "$script" "$script.1"
    run_up "$script" "$script.2"
  done
  for n in 1 2; do
    echo "== $label, up #$n: demo.sh exit=$(cat "$WORK/sh.$n.rc") demo.ps1 exit=$(cat "$WORK/ps.$n.rc")"
    cat "$WORK/sh.$n.out"
    same "$label, up #$n" "output" "$WORK/sh.$n.out" "$WORK/ps.$n.out"
    same "$label, up #$n" "exit code" "$WORK/sh.$n.rc" "$WORK/ps.$n.rc"
    same "$label, up #$n" "npm calls" "$WORK/sh.$n.npm" "$WORK/ps.$n.npm"
    same "$label, up #$n" "docker calls" "$WORK/sh.$n.docker" "$WORK/ps.$n.docker"
    same "$label, up #$n" "the stamp's bytes" "$WORK/sh.$n.stamp" "$WORK/ps.$n.stamp"
  done
}

expect_line() { printf '%s\n' "$2" | grep -qxF -- "$3" || fail "$1: missing line '$3'"; }
expect_no() { if printf '%s\n' "$2" | grep -qF -- "$3"; then fail "$1: output must not contain '$3'"; fi; }

# expect_rebuilt <label> <state line>: the loaded run built the export with
# the demo settings, wrote the exact stamp and recreated web.
expect_rebuilt() {
  local label="$1" state="$2"
  [ "$RC" -eq 0 ] || fail "$label: expected exit 0, got $RC"
  expect_line "$label" "$OUT" "$state"
  expect_line "$label" "$OUT" "$L_RECREATE"
  expect_line "$label" "$OUT" "$L_HEALTHY"
  expect_no "$label" "$OUT" "$L_FRESH"
  expect_line "$label" "$NPM" "run build:web"
  expect_line "$label" "$NPM" "$L_BUILD_ENV"
  cmp -s "$EXPECTED" "$STAMP_FILE" || fail "$label: the stamp is not the expected bytes: $(od -c "$STAMP_FILE" | head -n 5)"
}

# expect_fresh <label>: the loaded run did not build and did not recreate web.
expect_fresh() {
  local label="$1"
  [ "$RC" -eq 0 ] || fail "$label: expected exit 0, got $RC"
  expect_line "$label" "$OUT" "$L_FRESH"
  expect_line "$label" "$OUT" "$L_HEALTHY"
  expect_no "$label" "$OUT" "building Butler.UI/dist"
  expect_no "$label" "$OUT" "$L_RECREATE"
  expect_no "$label" "$NPM" "build:web"
}

# A/B/C (AC1): the first up rebuilds with the demo settings, the second one
# finds the export up to date.
check_rebuilt_once() {
  local label="$1" setup="$2" state="$3"
  run_case "$label" "$setup"
  load sh.1
  expect_rebuilt "$label, up #1" "$state"
  local other
  for other in "$L_STALE" "$L_MISSING" "$L_UNSTAMPED"; do
    [ "$other" = "$state" ] || expect_no "$label, up #1" "$OUT" "$other"
  done
  load sh.2
  expect_fresh "$label, up #2"
  cmp -s "$EXPECTED" "$STAMP_FILE" || fail "$label, up #2: the stamp changed"
}

check_rebuilt_once "no stamp" setup_no_stamp "$L_UNSTAMPED"
check_rebuilt_once "stamp for localhost:5108" setup_wrong_stamp "$L_UNSTAMPED"
check_rebuilt_once "stamp older than the export" setup_old_stamp "$L_UNSTAMPED"

# D and F: a matching stamp is not rebuilt, and up leaves the stamp alone.
for spec in "valid stamp|setup_valid_stamp" "valid stamp with CRLF|setup_crlf_stamp"; do
  label="${spec%%|*}"
  run_case "$label" "${spec#*|}"
  for n in 1 2; do
    load "sh.$n"
    expect_fresh "$label, up #$n"
  done
done

# E: the mtime check comes before the stamp check.
check_rebuilt_once "stale export without a stamp" setup_stale_no_stamp "$L_STALE"

# Cross-script (AC2): the stamp one script writes is up to date for the other.
cross() {
  local first="$1" second="$2" label="export built by demo.$1, up through demo.$2"
  setup_missing
  run_up "$first" cross.1
  run_up "$second" cross.2
  echo "== $label: exit=$(cat "$WORK/cross.1.rc"), then exit=$(cat "$WORK/cross.2.rc")"
  cat "$WORK/cross.1.out" "$WORK/cross.2.out"
  load cross.1
  expect_rebuilt "$label, up #1" "$L_MISSING"
  load cross.2
  expect_fresh "$label, up #2"
}
cross sh ps1
cross ps1 sh

echo "check-export-stamp.sh: all checks passed"
