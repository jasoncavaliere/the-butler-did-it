#!/usr/bin/env bash
# Checks the Fully Kiosk settings file for the hub tablet (#129):
# demo/tablet/fully-settings.json and its demo/tablet/README.md.
#
# Usage: bash demo/ci/check-fully-settings.sh
#
#   1. The file is valid JSON with an object at the top level (AC1).
#   2. The hub settings have their expected values, with __START_URL__ as the
#      start URL and __KIOSK_PIN__ as the kiosk PIN (AC1).
#   3. No real PIN or secret: no *Enc, password or Wi-Fi key, and every
#      kioskPin under demo/tablet is the placeholder (AC2).
#   4. Every key in the file appears in backticks in the README (AC3).
#   5. The README names both placeholders and Fully's Import Settings (AC4).
#   6. Both files are plain ASCII.
#
# Each failure prints a reason to stderr and exits 1. Needs bash, jq, git and
# GNU grep (for -P).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SETTINGS="$REPO_ROOT/demo/tablet/fully-settings.json"
README="$REPO_ROOT/demo/tablet/README.md"

fail() {
  echo "check-fully-settings: $*" >&2
  exit 1
}

[ -f "$SETTINGS" ] || fail "missing $SETTINGS"
[ -f "$README" ] || fail "missing $README"

# 1. Valid JSON, object at the top level.
jq -e 'type == "object"' "$SETTINGS" > /dev/null 2>&1 \
  || fail "fully-settings.json is not a JSON object"

# 2. Expected values. Booleans are JSON booleans; Fully stores numbers and
# times as strings.
expect() {
  local filter="$1" reason="$2"
  jq -e "$filter" "$SETTINGS" > /dev/null 2>&1 || fail "$reason ($filter)"
}
expect '.startURL == "__START_URL__"' 'startURL must be the __START_URL__ placeholder'
expect '.kioskPin == "__KIOSK_PIN__"' 'kioskPin must be the __KIOSK_PIN__ placeholder'
expect '.kioskMode == true' 'kioskMode must be true'
expect '.launchOnBoot == true' 'launchOnBoot must be true'
expect '.keepScreenOn == true' 'keepScreenOn must be true'
expect '.reloadOnWifiOn == true' 'reloadOnWifiOn (reload on network reconnect) must be true'
expect '.enablePullToRefresh == false' 'enablePullToRefresh must be false'
expect '.enableZoom == false' 'enableZoom must be false'
expect '.remoteAdmin == false' 'remoteAdmin must be false by default'
expect '.deleteWebstorageOnReload == false' 'deleteWebstorageOnReload must be false (it would wipe the offline week and write queue)'
expect '.deleteCacheOnReload == false' 'deleteCacheOnReload must be false'
expect '(.reloadPageFailure | type == "string") and ((.reloadPageFailure | tonumber) > 0)' 'reloadPageFailure must be a positive number of seconds, as a string'
expect '(.sleepSchedule | type == "string") and ((.sleepSchedule | fromjson | length) >= 1)' 'sleepSchedule must be a string holding a non-empty JSON array'

# 3. No real PIN or secret.
bad_keys="$(jq -r 'keys[] | select(test("Enc$") or test("password|wifiKey"; "i"))' "$SETTINGS")"
[ -z "$bad_keys" ] || fail "fully-settings.json must not hold secret keys: $bad_keys"
pins="$(git -C "$REPO_ROOT" grep -hP '"kioskPin(Enc)?"\s*:' -- demo/tablet || true)"
[ -n "$pins" ] || fail "no kioskPin found under demo/tablet (is the file committed or staged?)"
other_pins="$(printf '%s\n' "$pins" | grep -vP '^\s*"kioskPin"\s*:\s*"__KIOSK_PIN__",?\s*$' || true)"
[ -z "$other_pins" ] || fail "a kioskPin other than the __KIOSK_PIN__ placeholder is committed under demo/tablet: $other_pins"

# 4. Every key is documented in the README.
while IFS= read -r key; do
  grep -qF "\`$key\`" "$README" || fail "key '$key' is not listed in demo/tablet/README.md"
done < <(jq -r 'keys[]' "$SETTINGS")

# 5. The README covers the placeholders and the import.
for needle in __START_URL__ __KIOSK_PIN__ 'Import Settings'; do
  grep -qF "$needle" "$README" || fail "demo/tablet/README.md does not mention '$needle'"
done

# 6. Plain ASCII.
for f in "$SETTINGS" "$README"; do
  if LC_ALL=C grep -nP '[^\x00-\x7F]' "$f" >&2; then
    fail "$f has non-ASCII characters (lines above)"
  fi
done

echo "check-fully-settings: OK"
