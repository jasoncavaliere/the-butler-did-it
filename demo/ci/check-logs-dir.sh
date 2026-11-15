#!/usr/bin/env bash
# Checks that up reports an unwritable demo/.data/logs on stdout (#193),
# through both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-logs-dir.sh
#
# The API container writes its log files to the bind-mounted demo/.data/logs.
# When up cannot create that folder or make it world-writable, it must print,
# on stdout, a warning that the API file log is off and the exact command that
# fixes it (AC1), and still start the stack:
#   Case C: demo/.data is read-only (mode 0555) and has no logs folder.
#   Case D: demo/.data and demo/.data/logs are owned by root (sudo).
# And it must print nothing extra when the folder is usable (AC2):
#   Case A: no demo/.data at all; up creates logs with mode 0777.
#   Case B: a user-owned logs folder with mode 0755; up makes it 0777.
#   Case E: a root-owned logs folder that is already 0777 (sudo).
# The printed fix must work:
#   Case F: case D, then the printed command run from the repo root; the
#           next up prints nothing extra.
# Every run compares demo.sh with demo.ps1 and fails unless their stdout,
# stderr, exit code and docker calls are byte-identical (AC3), stdout equals
# the expected text exactly, stderr is empty, the exit code is 0, compose up
# was called once and npm never was. demo/README.md must explain the fix
# (AC4).
#
# A fresh, stamped hub export is put in Butler.UI/dist so up never builds; a
# stub npm fails if called, and a stub docker only logs and succeeds, so no
# real stack starts. An existing Butler.UI/dist is moved aside, and an
# existing demo/.data is renamed to demo/.data-saved-by-check-logs-dir; both
# are put back on exit. Cases D-F need passwordless sudo; without it they are
# skipped locally and fail in GitHub Actions. Refuses to run as root (a
# read-only folder does not stop root). Needs bash, GNU touch and pwsh
# (PowerShell 7); no Node, no Docker and no stack.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "FAIL: run check-logs-dir.sh as a normal user, not root." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$REPO_ROOT/Butler.UI/dist"
DATA_DIR="$REPO_ROOT/demo/.data"
DATA_SAVED="$REPO_ROOT/demo/.data-saved-by-check-logs-dir"
LOGS_DIR="$DATA_DIR/logs"
README="$REPO_ROOT/demo/README.md"

HAVE_SUDO=0
if sudo -n true 2>/dev/null; then
  HAVE_SUDO=1
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "FAIL: cases D-F need passwordless sudo, which this runner does not have." >&2
  exit 1
fi

# The exact warning both scripts print. $(id -u) and $(id -g) are literal.
MESSAGE='WARNING: The API file log is off. up could not make demo/.data/logs writable for the API container.
demo/.data is probably owned by root from an earlier run. The stack still starts, without the API log files.
To fix it, run down, then this from the repo root, then up again:
  sudo chown -R "$(id -u):$(id -g)" demo/.data'
FIX_CMD="$(printf '%s\n' "$MESSAGE" | sed -n 4p)"
FIX_CMD="${FIX_CMD#  }"

L_FRESH='Hub export is up to date (Butler.UI/dist).'
L_STARTING='Starting the demo stack ...'
L_HEALTHY='Demo stack is up and healthy: http://localhost:8080'
L_COMPOSE_UP='up -d --build --wait --wait-timeout 300'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Removes demo/.data, even when an earlier case left it read-only or owned
# by root.
reset_data() {
  [ -e "$DATA_DIR" ] || return 0
  chmod -R u+rwx "$DATA_DIR" 2>/dev/null || true
  rm -rf "$DATA_DIR" 2>/dev/null || sudo -n rm -rf "$DATA_DIR" 2>/dev/null || true
  [ ! -e "$DATA_DIR" ] || fail "could not remove $DATA_DIR"
}

WORK="$(mktemp -d)"
DIST_SAVED="$WORK/dist-saved"
DATA_MOVED=0
cleanup() {
  set +e
  reset_data
  if [ "$DATA_MOVED" -eq 1 ]; then
    mv "$DATA_SAVED" "$DATA_DIR"
  fi
  rm -rf "$DIST"
  if [ -d "$DIST_SAVED" ]; then
    mv "$DIST_SAVED" "$DIST"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Never delete a developer's demo/.data (it may hold Azurite data): rename it
# aside, inside demo/, and put it back on exit.
if [ -e "$DATA_SAVED" ]; then
  fail "$DATA_SAVED exists (left by an interrupted run?); restore or remove it first."
fi
if [ -e "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$DATA_SAVED"
  DATA_MOVED=1
fi
if [ -e "$DIST" ]; then
  mv "$DIST" "$DIST_SAVED"
fi

# A fresh export with a valid stamp (#184), newer than index.html, so up
# reports it up to date and never calls npm.
mkdir -p "$DIST"
echo '<!doctype html><title>stub export</title>' > "$DIST/index.html"
printf 'EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_AUTH_PROVIDER=pin\n' > "$DIST/.demo-build-env"
touch -d "@$(( $(date +%s) + 60 ))" "$DIST/.demo-build-env"

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export NPM_STUB_LOG="$WORK/npm.log"
export DOCKER_STUB_LOG="$WORK/docker.log"
: > "$NPM_STUB_LOG"
: > "$DOCKER_STUB_LOG"

# A stub npm: logs its arguments and fails. up must not build here.
cat > "$STUB_DIR/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NPM_STUB_LOG:-/dev/null}"
echo "stub npm: up must not build the export in this check: $*" >&2
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

# The exact stdout of an up that can use the logs folder, and of one that
# cannot (the warning comes right before "Starting the demo stack ...").
QUIET="$WORK/quiet.expected"
LOUD="$WORK/loud.expected"
printf '%s\n' "$L_FRESH" "$L_STARTING" "$L_HEALTHY" > "$QUIET"
printf '%s\n' "$L_FRESH" "$MESSAGE" "$L_STARTING" "$L_HEALTHY" > "$LOUD"

# run_up <script> <tag>: runs `up` through demo.sh or demo.ps1 and saves its
# stdout, stderr, exit code, npm and docker calls in $WORK/<tag>.*.
run_up() {
  local script="$1" tag="$2" rc
  : > "$NPM_STUB_LOG"
  : > "$DOCKER_STUB_LOG"
  set +e
  if [ "$script" = "sh" ]; then
    bash "$REPO_ROOT/demo/demo.sh" up > "$WORK/$tag.out" 2> "$WORK/$tag.err"
  else
    pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" up > "$WORK/$tag.out" 2> "$WORK/$tag.err"
  fi
  rc=$?
  set -e
  echo "$rc" > "$WORK/$tag.rc"
  cp "$NPM_STUB_LOG" "$WORK/$tag.npm"
  cp "$DOCKER_STUB_LOG" "$WORK/$tag.docker"
}

same() {
  local label="$1" what="$2" a="$3" b="$4"
  if ! cmp -s "$a" "$b"; then
    diff "$a" "$b" || true
    fail "$label: $what differ"
  fi
}

# expect_run <label> <tag> <expected stdout file>: the run printed exactly the
# expected stdout and nothing on stderr, exited 0, called compose up once and
# never called npm.
expect_run() {
  local label="$1" tag="$2" expected="$3" docker
  same "$label" "the expected stdout and the actual stdout" "$expected" "$WORK/$tag.out"
  if [ -s "$WORK/$tag.err" ]; then
    cat "$WORK/$tag.err" >&2
    fail "$label: stderr must be empty"
  fi
  [ "$(cat "$WORK/$tag.rc")" -eq 0 ] || fail "$label: expected exit 0, got $(cat "$WORK/$tag.rc")"
  [ ! -s "$WORK/$tag.npm" ] || fail "$label: npm must not be called: $(cat "$WORK/$tag.npm")"
  docker="$(cat "$WORK/$tag.docker")"
  [ "$(printf '%s\n' "$docker" | grep -c .)" -eq 1 ] || fail "$label: expected one docker call, got: $docker"
  case "$docker" in
    *" $L_COMPOSE_UP") ;;
    *) fail "$label: the docker call is not compose up: $docker" ;;
  esac
}

# run_case <label> <setup> <expected stdout file> [<after>]: from the same
# starting state, runs up once through each script and checks both runs.
# <after>, if given, checks the logs folder each run left behind.
run_case() {
  local label="$1" setup="$2" expected="$3" after="${4:-}" script
  for script in sh ps; do
    reset_data
    "$setup"
    run_up "$script" "$script"
    if [ -n "$after" ]; then
      "$after" "$label, demo.$script"
    fi
  done
  echo "== $label: demo.sh exit=$(cat "$WORK/sh.rc") demo.ps1 exit=$(cat "$WORK/ps.rc")"
  cat "$WORK/sh.out"
  same "$label" "demo.sh and demo.ps1 stdout" "$WORK/sh.out" "$WORK/ps.out"
  same "$label" "demo.sh and demo.ps1 stderr" "$WORK/sh.err" "$WORK/ps.err"
  same "$label" "demo.sh and demo.ps1 exit codes" "$WORK/sh.rc" "$WORK/ps.rc"
  same "$label" "demo.sh and demo.ps1 docker calls" "$WORK/sh.docker" "$WORK/ps.docker"
  expect_run "$label, demo.sh" sh "$expected"
  expect_run "$label, demo.ps1" ps "$expected"
}

# Puts demo/.data in the state a case starts from (reset_data runs first).
setup_none() { :; }
setup_user_logs_0755() {
  mkdir -p "$LOGS_DIR"
  chmod 0755 "$LOGS_DIR"
}
setup_read_only_data() {
  mkdir -p "$DATA_DIR"
  chmod 0555 "$DATA_DIR"
}
setup_root_owned() {
  sudo -n mkdir -p "$LOGS_DIR"
}
setup_root_owned_open() {
  sudo -n mkdir -p "$LOGS_DIR"
  sudo -n chmod 0777 "$LOGS_DIR"
}
setup_root_owned_then_fixed() {
  setup_root_owned
  (cd "$REPO_ROOT" && bash -c "$FIX_CMD")
}

# Checks on the logs folder a run left behind.
logs_open() {
  [ -d "$LOGS_DIR" ] || fail "$1: demo/.data/logs was not created"
  [ -n "$(find "$LOGS_DIR" -maxdepth 0 -perm -0777)" ] || fail "$1: demo/.data/logs is not mode 0777: $(ls -ld "$LOGS_DIR")"
}
logs_absent() {
  [ ! -e "$LOGS_DIR" ] || fail "$1: demo/.data/logs must not exist"
}

# AC2: a usable logs folder prints nothing extra.
run_case "no demo/.data" setup_none "$QUIET" logs_open
run_case "existing user-owned logs dir (0755)" setup_user_logs_0755 "$QUIET" logs_open
# AC1: a read-only demo/.data prints the warning.
run_case "read-only demo/.data" setup_read_only_data "$LOUD" logs_absent

if [ "$HAVE_SUDO" -eq 1 ]; then
  run_case "root-owned demo/.data and logs" setup_root_owned "$LOUD"
  run_case "root-owned logs already 0777" setup_root_owned_open "$QUIET"
  run_case "root-owned, then the printed fix" setup_root_owned_then_fixed "$QUIET" logs_open
else
  echo "SKIP: cases D-F (root-owned demo/.data) need passwordless sudo."
fi

# AC4: demo/README.md explains the warning and gives the same fix command.
grep -qF -- "$FIX_CMD" "$README" || fail "demo/README.md must contain the fix command: $FIX_CMD"
grep -qF -- 'The API file log is off' "$README" || fail "demo/README.md must contain 'The API file log is off'"

echo "check-logs-dir.sh: all checks passed"
