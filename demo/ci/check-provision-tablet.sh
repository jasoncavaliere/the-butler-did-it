#!/usr/bin/env bash
# Checks the hub tablet provisioning scripts (#128),
# demo/tablet/provision-tablet.sh and demo/tablet/provision-tablet.ps1,
# against a fake adb and a fake tailscale.
#
# Usage: bash demo/ci/check-provision-tablet.sh
#
# Covers the usage error, every pre-check abort (missing APK (AC5), no device
# (AC2), two devices (AC3), an unauthorized device, an account on the tablet
# (AC4), unreadable accounts, no share URL, a bad --url), the dry-run command
# list (AC9), a full run and the pushed settings copy (AC6, AC7), the
# device-owner skip (AC10), Fully as a device admin but not the device owner
# and another app as the device owner (#323), a failed set-device-owner, the
# demo share URL default (AC8) and the APK ignore rule (AC11).
#
# Every case runs both scripts and fails unless their output (stdout and
# stderr together), exit code and fake adb calls are identical (AC1), and the
# two pushed settings copies are byte-identical.
# Needs bash, pwsh (PowerShell 7), jq and git. No real adb or tailscale.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SETTINGS_SRC="$REPO_ROOT/demo/tablet/fully-settings.json"
HUB_URL="https://hub.example.ts.net"
SHARE_URL="https://demo-desktop.example-tailnet.ts.net"
COMPONENT="com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver"

USAGE='Usage: provision-tablet [--apk <path>] [--url <url>] [--dry-run]'
M_APK2='Download the Fully Kiosk Browser EMM APK (package com.fullykiosk.emm) from https://www.fully-kiosk.com/docs/en/getting-started/downloads and save it as demo/tablet/fully-emm.apk, or pass its path with --apk.'
M_NODEV="No Android device is connected. Plug in the tablet, turn on USB debugging, accept the prompt on the tablet, then check 'adb devices'."
M_MANY2='More than one Android device is connected (2). Unplug every device except the hub tablet, then run this again.'
M_STATE="The tablet is connected but adb reports it as 'unauthorized', not 'device'. Accept the USB debugging prompt on the tablet (or reconnect the cable), then run this again."
M_ACCT1='The tablet has 1 account(s) on it (adb shell dumpsys account). Device owner can only be set when no account exists: factory reset the tablet, skip every account sign-in, then run this again.'
M_ACCT_UNKNOWN="Could not read the tablet's accounts (no 'Accounts:' line in adb shell dumpsys account). Nothing was changed."
M_DPM='set-device-owner failed (see above). The usual causes are an account on the tablet or another device owner: factory reset the tablet and run this again.'
M_OWNER='Fully is already the device owner; skipping set-device-owner.'
M_DRY='Dry run: no adb command was run.'
M_DONE='Done. Remaining manual steps on the tablet:'
M_NOSHARE='No --url given, and the demo share URL is not available (Tailscale backend state: NeedsLogin). Run demo/demo.sh share first, or pass --url <hub url>.'
M_BADURL='--url must be an http:// or https:// URL made of letters, digits and . _ ~ : / - only (got: https://a&b).'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
APK="$WORK/fully-emm.apk"
: > "$APK"
export ADB_STUB_LOG="$WORK/adb.log"
export TS_STUB_LOG="$WORK/tailscale.log"
export ADB_STUB_PUSH_COPY="$WORK/pushed.json"
: > "$ADB_STUB_LOG"
: > "$TS_STUB_LOG"

# A fake adb: logs its arguments, answers the calls the scripts should make,
# and fails on anything else. Driven by ADB_STUB_DEVICES, ADB_STUB_ACCOUNTS (a
# number, or garbage for no Accounts line), ADB_STUB_OWNER (yes: Fully is the
# device owner and a device admin; admin: Fully is only a device admin; other:
# another app is the device owner and Fully is only a device admin) and
# ADB_STUB_DPM_FAIL=yes.
cat > "$STUB_DIR/adb" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${ADB_STUB_LOG:-/dev/null}"
tab="$(printf '\t')"
case "$*" in
  "devices")
    echo "List of devices attached"
    if [ "${ADB_STUB_DEVICES+set}" = set ]; then
      [ -n "$ADB_STUB_DEVICES" ] && printf '%s\n' "$ADB_STUB_DEVICES"
    else
      echo "emulator-5554${tab}device"
    fi
    echo ""
    ;;
  "shell dumpsys account")
    n="${ADB_STUB_ACCOUNTS:-0}"
    [ "$n" = garbage ] && exit 0
    echo "User UserInfo{0:Owner:c13}:"
    echo "  Accounts: $n"
    if [ "$n" -gt 0 ]; then
      echo "    Account {name=a@example.com, type=com.google}"
    fi
    ;;
  "shell dumpsys device_policy")
    echo "Current Device Policy Manager state:"
    case "${ADB_STUB_OWNER:-}" in
      yes)
        echo "  Device Owner: "
        echo "    admin=ComponentInfo{com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver}"
        echo "    name=Fully Kiosk Browser"
        echo "    package=com.fullykiosk.emm"
        echo "    isOrganizationOwnedDevice=true"
        echo "    User ID: 0"
        echo ""
        ;;
      other)
        echo "  Device Owner: "
        echo "    admin=ComponentInfo{com.example.mdm/com.example.mdm.AdminReceiver}"
        echo "    name=Example MDM"
        echo "    package=com.example.mdm"
        echo "    isOrganizationOwnedDevice=true"
        echo "    User ID: 0"
        echo ""
        ;;
    esac
    echo "  Enabled Device Admins (User 0, provisioningState: 0):"
    case "${ADB_STUB_OWNER:-}" in
      yes|admin|other)
        echo "    com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver:"
        echo "      uid=10153"
        echo "      testOnlyAdmin=false"
        ;;
    esac
    ;;
  "install -r "*)
    echo "Performing Streamed Install"
    echo "Success"
    ;;
  "shell dpm set-device-owner com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver")
    if [ "${ADB_STUB_DPM_FAIL:-}" = yes ]; then
      # Old adb: the shell command fails but adb still exits 0.
      echo "java.lang.IllegalStateException: Not allowed to set the device owner because there are already some accounts on the device"
      exit 0
    fi
    echo "Success: Device owner set to package ComponentInfo{com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver}"
    ;;
  "push "*" /sdcard/Download/fully-settings.json")
    [ $# -eq 3 ] || { echo "stub adb: bad push: $*" >&2; exit 64; }
    cp "$2" "${ADB_STUB_PUSH_COPY:?}"
    ;;
  "shell settings put global stay_on_while_plugged_in 7")
    ;;
  *)
    echo "stub adb: unexpected arguments: $*" >&2
    exit 64
    ;;
esac
STUB
chmod +x "$STUB_DIR/adb"

# A fake tailscale, as in demo/ci/check-share.sh: status --json shaped like
# the real one, and nothing else (the scripts must never call serve).
cat > "$STUB_DIR/tailscale" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${TS_STUB_LOG:-/dev/null}"
state="${TS_STUB_STATE:-Running}"
case "$*" in
  "status --json")
    if [ "$state" = "Running" ]; then
      certs='[
    "demo-desktop.example-tailnet.ts.net"
  ]'
    else
      certs='null'
    fi
    cat <<JSON
{
  "Version": "1.76.6-stub",
  "BackendState": "$state",
  "Self": {
    "HostName": "demo-desktop",
    "DNSName": "demo-desktop.example-tailnet.ts.net.",
    "Online": true
  },
  "CertDomains": $certs,
  "Peer": {
    "nodekey:0123456789abcdef": {
      "HostName": "other-box",
      "DNSName": "other-box.example-tailnet.ts.net.",
      "Online": true
    }
  }
}
JSON
    ;;
  *)
    echo "stub tailscale: unexpected arguments: $*" >&2
    exit 64
    ;;
esac
STUB
chmod +x "$STUB_DIR/tailscale"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# The two scripts use different temp dirs for the settings copy.
normalise() { sed 's#^\(> adb push \|push \).*/fully-settings\.json #\1<settings> #'; }

# run_both <label> <args...>: runs provision-tablet.sh and provision-tablet.ps1
# with the same args and environment, requires identical output, exit code,
# fake adb log and pushed copy, and leaves them in OUT, RC, LOG and PUSHED (the
# pushed copy's path, or empty when nothing was pushed).
run_both() {
  local label="$1" sh_out sh_rc sh_log ps_out ps_rc ps_log
  shift
  : > "$ADB_STUB_LOG"
  : > "$TS_STUB_LOG"
  rm -f "$ADB_STUB_PUSH_COPY" "$WORK/pushed.sh.json" "$WORK/ts.sh.log"
  set +e
  sh_out="$(bash "$REPO_ROOT/demo/tablet/provision-tablet.sh" "$@" 2>&1 | normalise)"
  sh_rc=${PIPESTATUS[0]}
  set -e
  sh_log="$(normalise < "$ADB_STUB_LOG")"
  cp "$TS_STUB_LOG" "$WORK/ts.sh.log"
  [ -f "$ADB_STUB_PUSH_COPY" ] && mv "$ADB_STUB_PUSH_COPY" "$WORK/pushed.sh.json"
  : > "$ADB_STUB_LOG"
  : > "$TS_STUB_LOG"
  set +e
  ps_out="$(pwsh -NoProfile -File "$REPO_ROOT/demo/tablet/provision-tablet.ps1" "$@" 2>&1 | normalise)"
  ps_rc=${PIPESTATUS[0]}
  set -e
  ps_log="$(normalise < "$ADB_STUB_LOG")"
  echo "== $label: provision-tablet.sh exit=$sh_rc provision-tablet.ps1 exit=$ps_rc"
  printf '%s\n' "$sh_out"
  if [ "$sh_out" != "$ps_out" ]; then
    diff <(printf '%s\n' "$sh_out") <(printf '%s\n' "$ps_out") || true
    fail "$label: provision-tablet.sh and provision-tablet.ps1 print different output"
  fi
  [ "$sh_rc" -eq "$ps_rc" ] || fail "$label: exit codes differ ($sh_rc vs $ps_rc)"
  if [ "$sh_log" != "$ps_log" ]; then
    diff <(printf '%s\n' "$sh_log") <(printf '%s\n' "$ps_log") || true
    fail "$label: provision-tablet.sh and provision-tablet.ps1 make different adb calls"
  fi
  cmp -s "$WORK/ts.sh.log" "$TS_STUB_LOG" || fail "$label: the scripts make different tailscale calls"
  PUSHED=""
  if [ -f "$WORK/pushed.sh.json" ] || [ -f "$ADB_STUB_PUSH_COPY" ]; then
    [ -f "$WORK/pushed.sh.json" ] && [ -f "$ADB_STUB_PUSH_COPY" ] \
      || fail "$label: only one of the scripts pushed the settings file"
    cmp "$WORK/pushed.sh.json" "$ADB_STUB_PUSH_COPY" \
      || fail "$label: the two scripts pushed different settings copies"
    PUSHED="$ADB_STUB_PUSH_COPY"
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
    fail "$1: unexpected adb calls"
  fi
}
expect_line() { printf '%s\n' "$OUT" | grep -qxF -- "$2" || fail "$1: missing line '$2'"; }
expect_no() { if printf '%s\n' "$OUT" | grep -qF -- "$2"; then fail "$1: output must not contain '$2'"; fi; }
expect_nothing_pushed() { [ -z "$PUSHED" ] || fail "$1: the settings file must not be pushed"; }

# Runs both scripts with the fake adb and tailscale first on PATH.
with_stub() { PATH="$STUB_DIR:$PATH" run_both "$@"; }

# The seven adb commands of a full run, in order (fake adb log form).
ALL_CALLS="$(printf '%s\n' \
  'devices' \
  'shell dumpsys account' \
  'shell dumpsys device_policy' \
  "install -r $APK" \
  "shell dpm set-device-owner $COMPONENT" \
  'push <settings> /sdcard/Download/fully-settings.json' \
  'shell settings put global stay_on_while_plugged_in 7')"
QUERIES2="$(printf '%s\n' 'devices' 'shell dumpsys account')"

# Checks the pushed copy: valid JSON, startURL = $2, no kiosk PIN key, and
# every other key equal to the committed settings file.
expect_pushed() {
  local label="$1" want="$2"
  [ -n "$PUSHED" ] || fail "$label: nothing was pushed"
  jq -e . "$PUSHED" > /dev/null || fail "$label: the pushed copy is not valid JSON"
  jq -e --arg u "$want" '.startURL == $u' "$PUSHED" > /dev/null \
    || fail "$label: the pushed startURL is not $want"
  jq -e 'has("kioskPin") | not' "$PUSHED" > /dev/null \
    || fail "$label: the pushed copy must not hold a kiosk PIN"
  [ "$(jq -S 'del(.startURL, .kioskPin)' "$PUSHED")" = "$(jq -S 'del(.startURL, .kioskPin)' "$SETTINGS_SRC")" ] \
    || fail "$label: the pushed copy changes keys other than startURL and the kiosk PIN"
  if grep -qF '__' "$PUSHED"; then fail "$label: the pushed copy still holds a placeholder"; fi
}

expect_manual_steps() {
  expect_line "$1" "$M_DONE"
  expect_line "$1" "  3. In Fully: Other Settings > Import Settings from File > Download/fully-settings.json."
  printf '%s\n' "$OUT" | grep -qF 'Kiosk Mode PIN' || fail "$1: the kiosk PIN step is missing"
  expect_line "$1" "See demo/tablet/README.md."
}

# usage
with_stub "usage" --bogus
expect_rc "usage" 2
expect_out "usage" "$(printf '%s\n' 'Unknown argument: --bogus' "$USAGE")"
expect_log "usage" ""
with_stub "usage (missing value)" --apk
expect_rc "usage (missing value)" 2
expect_line "usage (missing value)" "$USAGE"
expect_log "usage (missing value)" ""
with_stub "help" --help
expect_rc "help" 0
expect_out "help" "$USAGE"

# AC5 missing APK
with_stub "AC5 missing APK" --apk "$WORK/nope.apk" --url "$HUB_URL"
expect_rc "AC5 missing APK" 1
expect_out "AC5 missing APK" "$(printf '%s\n' "Fully APK not found: $WORK/nope.apk" "$M_APK2")"
expect_log "AC5 missing APK" ""

# AC2 no device
ADB_STUB_DEVICES="" with_stub "AC2 no device" --apk "$APK" --url "$HUB_URL"
expect_rc "AC2 no device" 1
expect_line "AC2 no device" "$M_NODEV"
expect_log "AC2 no device" "devices"
expect_nothing_pushed "AC2 no device"

# AC3 two devices
ADB_STUB_DEVICES="$(printf 'emulator-5554\tdevice\nR52N\tdevice')" with_stub "AC3 two devices" --apk "$APK" --url "$HUB_URL"
expect_rc "AC3 two devices" 1
expect_line "AC3 two devices" "$M_MANY2"
expect_log "AC3 two devices" "devices"

# unauthorized
ADB_STUB_DEVICES="$(printf 'R52N\tunauthorized')" with_stub "unauthorized" --apk "$APK" --url "$HUB_URL"
expect_rc "unauthorized" 1
expect_line "unauthorized" "$M_STATE"
expect_log "unauthorized" "devices"

# AC4 account present (and still with Fully already the device owner)
ADB_STUB_ACCOUNTS=1 with_stub "AC4 account present" --apk "$APK" --url "$HUB_URL"
expect_rc "AC4 account present" 1
expect_line "AC4 account present" "$M_ACCT1"
expect_log "AC4 account present" "$QUERIES2"
expect_nothing_pushed "AC4 account present"
ADB_STUB_ACCOUNTS=1 ADB_STUB_OWNER=yes with_stub "AC4 account present (owner set)" --apk "$APK" --url "$HUB_URL"
expect_rc "AC4 account present (owner set)" 1
expect_line "AC4 account present (owner set)" "$M_ACCT1"
expect_log "AC4 account present (owner set)" "$QUERIES2"

# AC4 unreadable accounts
ADB_STUB_ACCOUNTS=garbage with_stub "AC4 unreadable accounts" --apk "$APK" --url "$HUB_URL"
expect_rc "AC4 unreadable accounts" 1
expect_line "AC4 unreadable accounts" "$M_ACCT_UNKNOWN"
expect_log "AC4 unreadable accounts" "$QUERIES2"

# AC9 dry run: every adb command printed, none run.
with_stub "AC9 dry run" --apk "$APK" --url "$HUB_URL" --dry-run
expect_rc "AC9 dry run" 0
expect_log "AC9 dry run" ""
expect_nothing_pushed "AC9 dry run"
dry_cmds="$(printf '%s\n' "$OUT" | sed -n 's/^> adb //p')"
if [ "$dry_cmds" != "$ALL_CALLS" ]; then
  diff <(printf '%s\n' "$ALL_CALLS") <(printf '%s\n' "$dry_cmds") || true
  fail "AC9 dry run: unexpected adb command list"
fi
expect_out "AC9 dry run" "$(printf '%s\n' "Start URL: $HUB_URL" "$(printf '%s\n' "$ALL_CALLS" | sed 's/^/> adb /')" "$M_DRY")"

# AC6 AC7 full run
with_stub "AC6 AC7 full run" --apk "$APK" --url "$HUB_URL"
expect_rc "AC6 AC7 full run" 0
expect_log "AC6 AC7 full run" "$ALL_CALLS"
expect_line "AC6 AC7 full run" "Start URL: $HUB_URL"
expect_pushed "AC6 AC7 full run" "$HUB_URL"
expect_manual_steps "AC6 AC7 full run"
expect_no "AC6 AC7 full run" "$M_OWNER"
# Each change is announced right before it runs.
printf '%s\n' "$OUT" | grep -qxF "> adb shell dpm set-device-owner $COMPONENT" \
  || fail "AC6 AC7 full run: the dpm command is not announced"

# AC10 owner already set
ADB_STUB_OWNER=yes with_stub "AC10 owner already set" --apk "$APK" --url "$HUB_URL"
expect_rc "AC10 owner already set" 0
expect_log "AC10 owner already set" "$(printf '%s\n' "$ALL_CALLS" | grep -v 'dpm set-device-owner')"
expect_line "AC10 owner already set" "$M_OWNER"
expect_pushed "AC10 owner already set" "$HUB_URL"
expect_manual_steps "AC10 owner already set"

# #323 AC1: Fully is a device admin but not the device owner, so set-device-owner still runs.
ADB_STUB_OWNER=admin with_stub "#323 AC1 admin, not owner" --apk "$APK" --url "$HUB_URL"
expect_rc "#323 AC1 admin, not owner" 0
expect_log "#323 AC1 admin, not owner" "$ALL_CALLS"
expect_no "#323 AC1 admin, not owner" "$M_OWNER"
printf '%s\n' "$OUT" | grep -qxF "> adb shell dpm set-device-owner $COMPONENT" \
  || fail "#323 AC1 admin, not owner: the dpm command is not announced"
expect_pushed "#323 AC1 admin, not owner" "$HUB_URL"
expect_manual_steps "#323 AC1 admin, not owner"

# #323: another app is the device owner (Fully is only an admin), so the
# script does not skip set-device-owner; dpm itself then reports the conflict.
ADB_STUB_OWNER=other with_stub "#323 another app is device owner" --apk "$APK" --url "$HUB_URL"
expect_rc "#323 another app is device owner" 0
expect_log "#323 another app is device owner" "$ALL_CALLS"
expect_no "#323 another app is device owner" "$M_OWNER"

# dpm fails (adb exits 0, no Success): stop before the push.
ADB_STUB_DPM_FAIL=yes with_stub "dpm fails" --apk "$APK" --url "$HUB_URL"
expect_rc "dpm fails" 1
expect_line "dpm fails" "$M_DPM"
expect_log "dpm fails" "$(printf '%s\n' "$ALL_CALLS" | sed -n '1,5p')"
expect_nothing_pushed "dpm fails"
expect_no "dpm fails" "$M_DONE"

# AC8 default URL: the URL demo share prints, from tailscale status --json only.
with_stub "AC8 default URL" --apk "$APK"
expect_rc "AC8 default URL" 0
expect_line "AC8 default URL" "Start URL: $SHARE_URL"
expect_log "AC8 default URL" "$ALL_CALLS"
expect_pushed "AC8 default URL" "$SHARE_URL"
[ "$(cat "$TS_STUB_LOG")" = "status --json" ] || fail "AC8 default URL: tailscale calls were $(cat "$TS_STUB_LOG")"
expect_no "AC8 default URL" "other-box"

# AC8 no share URL
TS_STUB_STATE=NeedsLogin with_stub "AC8 no share URL" --apk "$APK"
expect_rc "AC8 no share URL" 1
expect_out "AC8 no share URL" "$M_NOSHARE"
expect_log "AC8 no share URL" ""

# bad URL
with_stub "bad URL" --apk "$APK" --url 'https://a&b'
expect_rc "bad URL" 2
expect_out "bad URL" "$M_BADURL"
expect_log "bad URL" ""

# AC11 apk ignored
git -C "$REPO_ROOT" check-ignore -q demo/tablet/fully-emm.apk \
  || fail "AC11: demo/tablet/fully-emm.apk is not git-ignored"
git -C "$REPO_ROOT" check-ignore -q demo/tablet/Fully-Kiosk-Browser-EMM-1.57.apk \
  || fail "AC11: demo/tablet/Fully-Kiosk-Browser-EMM-1.57.apk is not git-ignored"
if git -C "$REPO_ROOT" ls-files -- '*.apk' | grep -q .; then
  fail "AC11: an APK is committed"
fi
echo "== AC11 apk ignored: ok"

echo "check-provision-tablet.sh: all checks passed"
