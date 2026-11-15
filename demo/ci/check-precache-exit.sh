#!/usr/bin/env bash
# Checks the exit codes of demo/ci/check-precache.cjs (#259), so demo-ci can
# tell a real rejection from a crash.
#
# Usage: bash demo/ci/check-precache-exit.sh
#
# The checker exits 0 when the precache list is real, 1 only when it rejects
# the worker (and prints "<source> is not a build:web service worker:" on
# stderr), and 2 on bad usage or any error. A rejection counts only when the
# exit code is exactly 1 AND stderr carries that message: Node also exits 1
# for a crash in the checker itself (a top-level throw or a syntax error).
#
# Cases:
#   reject      - Butler.UI/public/sw.js, the placeholder worker a bare
#                 expo export copies, is rejected (AC1).
#   usage       - no argument exits 2 (AC2).
#   missing     - a file that does not exist exits 2 (AC2).
#   bad require - a copy of the checker whose pwa-export.js path does not
#                 exist exits 2 (AC2).
#   guard       - stub checkers that exit 2, 0, 3 with the message, or crash
#                 with exit 1 and no message, do not count as a rejection;
#                 one that prints the message and exits 1 does (AC2).
#
# Needs bash and node; no Docker and no stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$REPO_ROOT/demo/ci/check-precache.cjs"
BARE_WORKER="$REPO_ROOT/Butler.UI/public/sw.js"
MARKER='is not a build:web service worker'

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# run <checker> <tag> [args...]: runs the checker with node, saves stdout and
# stderr in $WORK/<tag>.out and $WORK/<tag>.err, and sets rc to its exit code.
rc=0
run() {
  local checker="$1" tag="$2"
  shift 2
  set +e
  node "$checker" "$@" > "$WORK/$tag.out" 2> "$WORK/$tag.err"
  rc=$?
  set -e
  echo "== $tag: exit $rc"
  cat "$WORK/$tag.err" >&2
}

# is_rejection <checker> <tag> <source>: true only when the checker exits
# exactly 1 and its stderr carries the rejection message.
is_rejection() {
  run "$1" "$2" "$3"
  [ "$rc" -eq 1 ] && grep -qF "$MARKER" "$WORK/$2.err"
}

# expect_rc <expected> <checker> <tag> [args...]
expect_rc() {
  local expected="$1"
  shift
  run "$@"
  [ "$rc" -eq "$expected" ] || fail "$2: expected exit $expected, got $rc"
}

# reject (AC1): the placeholder worker is a real rejection.
if is_rejection "$CHECKER" reject "$BARE_WORKER"; then
  echo "rejects the bare-export worker: ok"
else
  fail "check-precache did not reject the bare-export worker (Butler.UI/public/sw.js): exit $rc, expected 1 with '$MARKER'"
fi

# usage (AC2): no argument.
expect_rc 2 "$CHECKER" usage

# missing file (AC2): an unreadable file is an error, not a rejection.
expect_rc 2 "$CHECKER" missing "$WORK/no-such-sw.js"
is_rejection "$CHECKER" missing-guard "$WORK/no-such-sw.js" && fail "missing-guard: a missing file counted as a rejection"

# bad require (AC2): a copy whose ../../Butler.UI/scripts/pwa-export.js does
# not exist.
mkdir -p "$WORK/a/b"
cp "$CHECKER" "$WORK/a/b/check-precache.cjs"
expect_rc 2 "$WORK/a/b/check-precache.cjs" bad-require "$BARE_WORKER"
is_rejection "$WORK/a/b/check-precache.cjs" bad-require-guard "$BARE_WORKER" \
  && fail "bad-require-guard: a failed require counted as a rejection"

# guard (AC2): stub checkers. Only exit 1 with the message is a rejection.
cat > "$WORK/stub-exit2.cjs" <<'STUB'
console.error('check-precache: some error');
process.exit(2);
STUB
cat > "$WORK/stub-throw.cjs" <<'STUB'
throw new Error('boom');
STUB
cat > "$WORK/stub-exit0.cjs" <<'STUB'
process.exit(0);
STUB
cat > "$WORK/stub-marker-exit3.cjs" <<'STUB'
console.error('check-precache: x is not a build:web service worker:');
process.exit(3);
STUB
cat > "$WORK/stub-marker-exit1.cjs" <<'STUB'
console.error('check-precache: x is not a build:web service worker:');
process.exit(1);
STUB

for stub in exit2 throw exit0 marker-exit3; do
  is_rejection "$WORK/stub-$stub.cjs" "guard-$stub" x && fail "guard-$stub: counted as a rejection (exit $rc)"
  echo "guard-$stub: not a rejection: ok"
done
# The throw stub must exit 1 with no message, which is why rc alone is not enough.
run "$WORK/stub-throw.cjs" guard-throw-rc x
[ "$rc" -eq 1 ] || fail "guard-throw-rc: expected Node to exit 1 on a top-level throw, got $rc"

is_rejection "$WORK/stub-marker-exit1.cjs" guard-marker-exit1 x \
  || fail "guard-marker-exit1: exit 1 with the message did not count as a rejection (exit $rc)"
echo "guard-marker-exit1: a rejection: ok"

echo "check-precache-exit.sh: all checks passed"
