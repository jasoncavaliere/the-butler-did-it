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
UI_DIR="$REPO_ROOT/Butler.UI"

HUB_URL="http://localhost:8080"
DATASET_URL="$HUB_URL/api/api/system/dataset"
WAIT_TIMEOUT=300

# Subcommand registry, in usage order: one "name|description" per line.
# To add a subcommand: add a line here and a cmd_<name> function below (and
# the same entry and handler in demo.ps1, plus a row in demo/README.md).
COMMANDS="up|Build the hub export if needed, start the stack and wait until it is healthy
down|Stop the stack (data in demo/.data/azurite is kept)
status|Show container health, the hub URL and the dataset id
logs|Show the stack logs (extra arguments go to docker compose logs)"

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

# Prints "missing", "stale" or "fresh" for the hub export in Butler.UI/dist.
export_state() {
  local marker="$UI_DIR/dist/index.html"
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
  else
    echo "fresh"
  fi
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
  # Expo inlines EXPO_PUBLIC_* at bundle time; /api keeps the hub same-origin.
  (cd "$UI_DIR" && EXPO_PUBLIC_API_BASE_URL=/api npm run build:web) || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Hub export build failed." >&2
    return "$rc"
  fi
}

cmd_up() {
  local state rebuilt=0 rc=0
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
  esac

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

cmd_down() {
  echo "Stopping the demo stack (data in demo/.data/azurite is kept) ..."
  # Never -v: the Azurite data must survive.
  compose down || return $?
  echo "Demo stack stopped."
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
  local dataset=""
  if command -v curl >/dev/null 2>&1; then
    dataset="$(curl -fsS --max-time 3 "$DATASET_URL" 2>/dev/null \
      | sed -n 's/.*"datasetId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || dataset=""
  fi
  echo "Dataset: ${dataset:-unavailable}"
}

cmd_logs() {
  compose logs "$@"
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
