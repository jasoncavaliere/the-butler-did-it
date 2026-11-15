#!/usr/bin/env bash
# Checks the docker compose logs call that `demo logs` makes (#190), through
# both demo/demo.sh and demo/demo.ps1.
#
# Usage: bash demo/ci/check-logs-args.sh
#
# Naming a compose service (for example `demo logs -f azurite`) must show
# only the services named: the default `api web` (or `api` with --api) is
# added only when no service is named. A name counts only when it equals a
# service in demo/docker-compose.yml exactly (case-sensitive), so flag values
# such as 10m or 100 never count. Any extra argument still turns off the
# default --follow --tail 100.
#
# Every case runs both scripts and fails unless their output (stdout and
# stderr together), exit code and docker calls are identical, there is
# exactly one docker call, and it ends with the expected `logs ...` tail.
# The last cases name each service parsed from demo/docker-compose.yml, so
# a service added there but not to COMPOSE_SERVICES / $ComposeServices fails.
#
# A stub docker only logs its arguments and succeeds, so no real stack is
# needed. Needs bash and pwsh (PowerShell 7); no Docker and no stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_YML="$REPO_ROOT/demo/docker-compose.yml"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
export DOCKER_STUB_LOG="$WORK/docker.log"
: > "$DOCKER_STUB_LOG"

# A stub docker: logs its arguments and succeeds.
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$STUB_DIR/docker"
export PATH="$STUB_DIR:$PATH"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# run_logs <sh|ps> <tag> [args...]: runs `logs` through demo.sh or demo.ps1
# and saves its output, exit code and docker calls in $WORK/<tag>.*.
run_logs() {
  local script="$1" tag="$2" rc
  shift 2
  : > "$DOCKER_STUB_LOG"
  set +e
  if [ "$script" = "sh" ]; then
    bash "$REPO_ROOT/demo/demo.sh" logs "$@" > "$WORK/$tag.out" 2>&1
  else
    pwsh -NoProfile -File "$REPO_ROOT/demo/demo.ps1" logs "$@" > "$WORK/$tag.out" 2>&1
  fi
  rc=$?
  set -e
  echo "$rc" > "$WORK/$tag.rc"
  cp "$DOCKER_STUB_LOG" "$WORK/$tag.docker"
}

same() {
  local label="$1" what="$2" a="$3" b="$4"
  if ! cmp -s "$a" "$b"; then
    diff "$a" "$b" || true
    fail "$label: demo.sh and demo.ps1 differ in $what"
  fi
}

# check <expected tail> [args...]: `demo logs <args>` through both scripts
# makes one docker call whose arguments after the compose file are exactly
# <expected tail>.
check() {
  local expected="$1" label calls got
  shift
  label="logs${*:+ $*}"
  run_logs sh sh "$@"
  run_logs ps ps "$@"
  echo "== $label: demo.sh exit=$(cat "$WORK/sh.rc") demo.ps1 exit=$(cat "$WORK/ps.rc")"
  cat "$WORK/sh.docker"
  same "$label" "output" "$WORK/sh.out" "$WORK/ps.out"
  same "$label" "exit code" "$WORK/sh.rc" "$WORK/ps.rc"
  same "$label" "docker calls" "$WORK/sh.docker" "$WORK/ps.docker"
  [ "$(cat "$WORK/sh.rc")" -eq 0 ] || fail "$label: expected exit 0, got $(cat "$WORK/sh.rc")"
  calls="$(wc -l < "$WORK/sh.docker" | tr -d ' ')"
  [ "$calls" -eq 1 ] || fail "$label: expected one docker call, got $calls"
  got="$(sed 's/^.*docker-compose\.yml //' "$WORK/sh.docker")"
  [ "$got" = "$expected" ] || fail "$label: expected '$expected', got '$got'"
}

# Defaults (AC2): no service named.
check "logs --follow --tail 100 api web"
check "logs --follow --tail 100 api" --api
check "logs --no-color --since 10m api web" --no-color --since 10m
check "logs --no-color --since 10m api" --api --no-color --since 10m
# Service names are case-sensitive, as in docker compose.
check "logs Azurite api web" Azurite

# A named service narrows the call (AC1, AC5).
check "logs -f azurite" -f azurite
check "logs azurite" azurite
check "logs -f azurite api" -f azurite api
check "logs --tail 50 web" --tail 50 web
# Explicit names win over --api, which only changes the default.
check "logs azurite" --api azurite

# Drift guard: every service in docker-compose.yml narrows the call.
services="$(awk '/^services:/{s=1;next} s&&/^[^ #]/{s=0} s&&/^  [a-z][a-z0-9_-]*:$/{sub(/:$/,"",$1);print $1}' "$COMPOSE_YML")"
count="$(printf '%s\n' "$services" | grep -c . || true)"
[ "$count" -ge 3 ] || fail "expected at least 3 services in demo/docker-compose.yml, found $count: $services"
for s in $services; do
  check "logs $s" "$s"
done

echo "check-logs-args.sh: all checks passed"
