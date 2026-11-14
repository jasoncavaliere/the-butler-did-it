#!/usr/bin/env bash
# Checks that a failed hub export build is rebuilt by the next up (#183),
# through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-export-failure.sh
#
# build:web runs expo export and then pwa-export.js, so a failure in the
# second step leaves a new Butler.UI/dist/index.html, the export's freshness
# marker. A stub npm reproduces that: `npm run build:web` writes
# dist/index.html and exits 1. After that failed up, the marker must be gone
# (AC1), and the next up must say the export is missing and build it again.
#   Case A: the export is older than its sources (the reported scenario).
#   Case B: the export is missing.
# Every run compares demo.sh with demo.ps1 and fails unless their output
# (stdout and stderr together), exit code and stub npm calls are identical
# (AC2). The build stamp up writes only after a successful build (#184),
# Butler.UI/dist/.demo-build-env, must be absent after each failed one. A stub docker that only logs and fails keeps a regression from
# starting a real stack; neither script may call it.
#
# Runs the real scripts against the real Butler.UI/ folder. An existing
# Butler.UI/dist is moved aside and put back on exit. Needs bash and pwsh
# (PowerShell 7); no Node, no Docker and no stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_DIR="$REPO_ROOT/Butler.UI"
DIST="$UI_DIR/dist"
MARKER="$DIST/index.html"
STAMP="$DIST/.demo-build-env"

L_STALE='Hub export is older than its sources; building Butler.UI/dist ...'
L_MISSING='Hub export is missing; building Butler.UI/dist ...'
L_FRESH='Hub export is up to date (Butler.UI/dist).'
L_FAILED='Hub export build failed.'
L_STUB='stub npm: pwa-export.js failed after expo export wrote dist/index.html'

WORK="$(mktemp -d)"
SAVED="$WORK/dist-saved"
cleanup() {
  rm -rf "$DIST"
  if [ -d "$SAVED" ]; then
    mv "$SAVED" "$DIST"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
if [ -e "$DIST" ]; then
  mv "$DIST" "$SAVED"
fi

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export NPM_STUB_LOG="$WORK/npm.log"
export DOCKER_STUB_LOG="$WORK/docker.log"
: > "$NPM_STUB_LOG"
: > "$DOCKER_STUB_LOG"

# A stub npm: logs its arguments. `ci` succeeds; `run build:web` does what a
# pwa-export.js failure does (a new dist/index.html, then a non-zero exit).
# Both scripts run it from Butler.UI/.
cat > "$STUB_DIR/npm" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\${NPM_STUB_LOG:-/dev/null}"
case "\$1" in
  ci)
    exit 0
    ;;
esac
if [ "\$*" = "run build:web" ]; then
  mkdir -p dist
  echo '<!doctype html><title>stub export</title>' > dist/index.html
  echo '$L_STUB' >&2
  exit 1
fi
echo "stub npm: unexpected arguments: \$*" >&2
exit 64
STUB
# A stub docker: both scripts need one on PATH, and neither may call it here.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:-/dev/null}"
echo "stub docker: must not be called: $*" >&2
exit 1
STUB
chmod +x "$STUB_DIR/npm" "$STUB_DIR/docker"

# up checks the PIN before anything else.
export BUTLER_DEMO_PIN=1234
export PATH="$STUB_DIR:$PATH"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Puts Butler.UI/dist in the state a case starts from.
setup_stale() {
  rm -rf "$DIST"
  mkdir -p "$DIST"
  echo '<!doctype html><title>old export</title>' > "$MARKER"
  touch -d '2000-01-01 00:00:00' "$MARKER"
  # A matching build stamp (#184): the failed rebuild must delete it too.
  printf 'EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_AUTH_PROVIDER=pin\n' > "$STAMP"
  touch -d '2000-01-01 00:00:00' "$STAMP"
}
setup_missing() {
  rm -rf "$DIST"
}

# run_up <script> <n>: runs `up` through demo.sh or demo.ps1 and saves its
# output, exit code, npm calls and whether the marker and the build stamp
# (#184) exist afterwards in $WORK/<script>.<n>.*.
run_up() {
  local script="$1" n="$2" rc
  : > "$NPM_STUB_LOG"
  set +e
  if [ "$script" = "sh" ]; then
    bash "$REPO_ROOT/demo/demo.sh" up > "$WORK/$script.$n.out" 2>&1
  else
    pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" up > "$WORK/$script.$n.out" 2>&1
  fi
  rc=$?
  set -e
  echo "$rc" > "$WORK/$script.$n.rc"
  cp "$NPM_STUB_LOG" "$WORK/$script.$n.npm"
  if [ -e "$MARKER" ]; then
    echo "present" > "$WORK/$script.$n.marker"
  else
    echo "gone" > "$WORK/$script.$n.marker"
  fi
  if [ -e "$STAMP" ]; then
    echo "present" > "$WORK/$script.$n.stamp"
  else
    echo "gone" > "$WORK/$script.$n.stamp"
  fi
}

same() {
  local label="$1" what="$2" a="$3" b="$4"
  if ! cmp -s "$a" "$b"; then
    diff "$a" "$b" || true
    fail "$label: demo.sh and demo.ps1 differ in $what"
  fi
}

# run_case <label> <setup>: from the same starting state, runs up twice
# through each script, requires identical results, and leaves the demo.sh
# results of the first and second up in OUT1/RC1/NPM1/MARKER1/STAMP1 and
# OUT2/RC2/NPM2/MARKER2/STAMP2.
run_case() {
  local label="$1" setup="$2" script n
  for script in sh ps; do
    "$setup"
    run_up "$script" 1
    run_up "$script" 2
  done
  for n in 1 2; do
    echo "== $label, up #$n: demo.sh exit=$(cat "$WORK/sh.$n.rc") demo.ps1 exit=$(cat "$WORK/ps.$n.rc")"
    cat "$WORK/sh.$n.out"
    same "$label, up #$n" "output" "$WORK/sh.$n.out" "$WORK/ps.$n.out"
    same "$label, up #$n" "exit code" "$WORK/sh.$n.rc" "$WORK/ps.$n.rc"
    same "$label, up #$n" "npm calls" "$WORK/sh.$n.npm" "$WORK/ps.$n.npm"
    same "$label, up #$n" "Butler.UI/dist/index.html after the run" "$WORK/sh.$n.marker" "$WORK/ps.$n.marker"
    same "$label, up #$n" "Butler.UI/dist/.demo-build-env after the run" "$WORK/sh.$n.stamp" "$WORK/ps.$n.stamp"
  done
  OUT1="$(cat "$WORK/sh.1.out")"; RC1="$(cat "$WORK/sh.1.rc")"
  NPM1="$(cat "$WORK/sh.1.npm")"; MARKER1="$(cat "$WORK/sh.1.marker")"
  OUT2="$(cat "$WORK/sh.2.out")"; RC2="$(cat "$WORK/sh.2.rc")"
  NPM2="$(cat "$WORK/sh.2.npm")"; MARKER2="$(cat "$WORK/sh.2.marker")"
  STAMP1="$(cat "$WORK/sh.1.stamp")"; STAMP2="$(cat "$WORK/sh.2.stamp")"
  [ ! -s "$DOCKER_STUB_LOG" ] || fail "$label: a script called docker: $(cat "$DOCKER_STUB_LOG")"
}

expect_line() { printf '%s\n' "$2" | grep -qxF -- "$3" || fail "$1: missing line '$3'"; }
expect_no() { if printf '%s\n' "$2" | grep -qF -- "$3"; then fail "$1: output must not contain '$3'"; fi; }

# expect_failed_build <label> <out> <rc> <npm> <marker> <state line> <stamp>
expect_failed_build() {
  local label="$1" out="$2" rc="$3" npm="$4" marker="$5" state="$6" stamp="$7"
  [ "$rc" -eq 1 ] || fail "$label: expected exit 1, got $rc"
  expect_line "$label" "$out" "$state"
  expect_line "$label" "$out" "$L_STUB"
  expect_line "$label" "$out" "$L_FAILED"
  expect_no "$label" "$out" "$L_FRESH"
  expect_no "$label" "$out" "Starting the demo stack"
  expect_line "$label" "$npm" "run build:web"
  [ "$marker" = "gone" ] || fail "$label: Butler.UI/dist/index.html is still there after the failed build"
  [ "$stamp" = "gone" ] || fail "$label: Butler.UI/dist/.demo-build-env exists after the failed build (#184)"
}

# Case A: a stale export whose rebuild fails (the reported scenario).
run_case "stale export, build fails" setup_stale
expect_failed_build "stale, up #1" "$OUT1" "$RC1" "$NPM1" "$MARKER1" "$L_STALE" "$STAMP1"
expect_no "stale, up #1" "$OUT1" "$L_MISSING"
# AC1: the next up rebuilds instead of reporting the export as up to date.
expect_failed_build "stale, up #2" "$OUT2" "$RC2" "$NPM2" "$MARKER2" "$L_MISSING" "$STAMP2"

# Case B: a missing export whose build fails.
run_case "missing export, build fails" setup_missing
expect_failed_build "missing, up #1" "$OUT1" "$RC1" "$NPM1" "$MARKER1" "$L_MISSING" "$STAMP1"
expect_failed_build "missing, up #2" "$OUT2" "$RC2" "$NPM2" "$MARKER2" "$L_MISSING" "$STAMP2"

echo "check-export-failure.sh: all checks passed"
