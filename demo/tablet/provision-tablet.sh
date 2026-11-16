#!/usr/bin/env bash
# Provisions a factory-reset Android hub tablet over adb (#128): installs the
# Fully Kiosk Browser EMM APK, makes Fully the device owner, pushes the Butler
# Fully settings file (#129) with the start URL filled in, and keeps the screen
# on while plugged in. Then it prints the steps left to do on the tablet.
#
# Usage: demo/tablet/provision-tablet.sh [--apk <path>] [--url <url>] [--dry-run]
#   --apk      The Fully EMM APK (default: demo/tablet/fully-emm.apk).
#   --url      The hub URL the tablet opens (default: the URL demo share prints).
#   --dry-run  Print every adb command and run none.
#
# demo/tablet/provision-tablet.ps1 is the PowerShell 7 twin. Both scripts
# accept the same flags, run the same adb commands in the same order and print
# the same text, so keep every fixed string below byte-identical to the one in
# provision-tablet.ps1. demo/ci/check-provision-tablet.sh checks both against a
# fake adb. See demo/tablet/README.md.
#
# Every check runs before the first change. The pushed copy of the settings
# file has no kiosk PIN line: the PIN is set by hand on the tablet.
#
# Works with macOS's bash 3.2: no associative arrays, no mapfile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_SRC="$SCRIPT_DIR/fully-settings.json"
DEVICE_PATH="/sdcard/Download/fully-settings.json"
OWNER_PACKAGE="com.fullykiosk.emm"
OWNER_COMPONENT="com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver"
USAGE="Usage: provision-tablet [--apk <path>] [--url <url>] [--dry-run]"

apk="$SCRIPT_DIR/fully-emm.apk"
url=""
url_given=0
dry_run=0

usage_error() {
  echo "$1" >&2
  echo "$USAGE" >&2
  exit 2
}

# Phase 1: arguments.
while [ $# -gt 0 ]; do
  case "$1" in
    --apk)
      [ $# -ge 2 ] || usage_error "--apk needs a value."
      apk="$2"
      shift 2
      ;;
    --url)
      [ $# -ge 2 ] || usage_error "--url needs a value."
      url="$2"
      url_given=1
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      echo "$USAGE"
      exit 0
      ;;
    *)
      usage_error "Unknown argument: $1"
      ;;
  esac
done

# Prints the path of the tailscale CLI, or returns 1 (as in demo/demo.sh).
find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  local mac="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  if [ -x "$mac" ]; then
    echo "$mac"
    return 0
  fi
  return 1
}

# Sets share_url to the URL demo share prints (https:// + CertDomains[0]), or
# share_reason to why it is not available. Runs only tailscale status --json,
# never tailscale serve: the lookup is copied from cmd_share in demo/demo.sh.
share_url=""
share_reason=""
lookup_share_url() {
  local ts json flat state name
  if ! ts="$(find_tailscale)"; then
    share_reason="Tailscale is not installed"
    return 0
  fi
  json="$("$ts" status --json 2>/dev/null)" || json=""
  # No jq: flatten the JSON and pick the two top-level fields out of it.
  flat="$(printf '%s' "$json" | tr -d ' \t\r\n')" || flat=""
  state="$(printf '%s' "$flat" | grep -o '"BackendState":"[^"]*"' | head -n 1 | sed 's/^"BackendState":"//; s/"$//')" || state=""
  [ -z "$state" ] && state="unavailable"
  if [ "$state" != "Running" ]; then
    share_reason="Tailscale backend state: $state"
    return 0
  fi
  # CertDomains, not Self.DNSName: DNSName also appears under every peer.
  name="$(printf '%s' "$flat" | grep -o '"CertDomains":\["[^"]*"' | head -n 1 | sed 's/^"CertDomains":\["//; s/"$//')" || name=""
  if [ -z "$name" ]; then
    share_reason="Tailscale reports no HTTPS name"
    return 0
  fi
  share_url="https://$name"
}

# Phase 2: local checks. Nothing on the tablet is touched yet.
if [ ! -f "$apk" ]; then
  echo "Fully APK not found: $apk" >&2
  echo "Download the Fully Kiosk Browser EMM APK (package com.fullykiosk.emm) from https://www.fully-kiosk.com/docs/en/getting-started/downloads and save it as demo/tablet/fully-emm.apk, or pass its path with --apk." >&2
  exit 1
fi

if [ "$url_given" -eq 0 ]; then
  lookup_share_url
  if [ -z "$share_url" ]; then
    echo "No --url given, and the demo share URL is not available ($share_reason). Run demo/demo.sh share first, or pass --url <hub url>." >&2
    exit 1
  fi
  url="$share_url"
fi

# The character check also keeps the sed replacement below safe (no &, |, \).
url_re='^https?://[A-Za-z0-9._~:/-]+$'
if ! [[ "$url" =~ $url_re ]]; then
  echo "--url must be an http:// or https:// URL made of letters, digits and . _ ~ : / - only (got: $url)." >&2
  exit 2
fi
echo "Start URL: $url"

# The filled copy lives only in this temp dir, which is removed on exit.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SETTINGS_COPY="$TMP_DIR/fully-settings.json"
sed -e '/^[[:space:]]*"kioskPin"[[:space:]]*:/d' -e "s|__START_URL__|$url|" "$SETTINGS_SRC" > "$SETTINGS_COPY"
if grep -qF '__START_URL__' "$SETTINGS_COPY"; then
  echo "Could not fill in the start URL in fully-settings.json." >&2
  exit 1
fi

# Phase 3: adb itself (not needed for a dry run).
if [ "$dry_run" -eq 0 ] && ! command -v adb >/dev/null 2>&1; then
  echo "adb was not found. Install Android platform-tools from https://developer.android.com/tools/releases/platform-tools and put adb on your PATH." >&2
  exit 1
fi

# Every adb call is announced on stdout first; a dry run only announces it.
announce() { echo "> adb $*"; }

# capture <args...>: runs adb, leaves its output (stdout and stderr, without
# carriage returns) in CAP_OUT and its exit code in CAP_RC.
CAP_OUT=""
CAP_RC=0
capture() {
  CAP_RC=0
  CAP_OUT="$(adb "$@" 2>&1)" || CAP_RC=$?
  CAP_OUT="$(printf '%s' "$CAP_OUT" | tr -d '\r')"
}

# Phase 4: read-only queries.
announce devices
if [ "$dry_run" -eq 0 ]; then
  capture devices
  if [ "$CAP_RC" -ne 0 ]; then
    echo "adb devices failed (exit $CAP_RC). Nothing was changed." >&2
    exit 1
  fi
  devices="$(printf '%s\n' "$CAP_OUT" | awk '{ sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") } $0 == "" { next } /^List of devices attached/ { next } /^\*/ { next } { print }')"
  if [ -z "$devices" ]; then
    count=0
  else
    count="$(printf '%s\n' "$devices" | wc -l | tr -d ' ')"
  fi
  if [ "$count" -eq 0 ]; then
    echo "No Android device is connected. Plug in the tablet, turn on USB debugging, accept the prompt on the tablet, then check 'adb devices'." >&2
    exit 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "More than one Android device is connected ($count). Unplug every device except the hub tablet, then run this again." >&2
    exit 1
  fi
  state="$(printf '%s\n' "$devices" | awk '{ print $2 }')"
  if [ "$state" != "device" ]; then
    echo "The tablet is connected but adb reports it as '$state', not 'device'. Accept the USB debugging prompt on the tablet (or reconnect the cable), then run this again." >&2
    exit 1
  fi
fi

announce shell dumpsys account
if [ "$dry_run" -eq 0 ]; then
  capture shell dumpsys account
  # One "Accounts: N" line per Android user.
  counts="$(printf '%s\n' "$CAP_OUT" | sed -n 's/^[[:space:]]*Accounts:[[:space:]]*\([0-9][0-9]*\).*$/\1/p')"
  if [ -z "$counts" ]; then
    echo "Could not read the tablet's accounts (no 'Accounts:' line in adb shell dumpsys account). Nothing was changed." >&2
    exit 1
  fi
  accounts=0
  for n in $counts; do
    accounts=$((accounts + 10#$n))
  done
  if [ "$accounts" -gt 0 ]; then
    echo "The tablet has $accounts account(s) on it (adb shell dumpsys account). Device owner can only be set when no account exists: factory reset the tablet, skip every account sign-in, then run this again." >&2
    exit 1
  fi
fi

owner_set=0
announce shell dumpsys device_policy
if [ "$dry_run" -eq 0 ]; then
  capture shell dumpsys device_policy
  # Match only the package= line inside the "Device Owner:" block: a Fully
  # that is only a device admin is listed elsewhere in the dump too (#323).
  # The block ends at a blank line or a line indented no deeper than its header.
  if printf '%s\n' "$CAP_OUT" | awk -v pkg="$OWNER_PACKAGE" '
    { match($0, /^[ \t]*/); ind = RLENGTH; t = $0; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t) }
    in_owner && (t == "" || ind <= hind) { in_owner = 0 }
    t == "Device Owner:" { in_owner = 1; hind = ind; next }
    in_owner && t == ("package=" pkg) { found = 1 }
    END { exit(found ? 0 : 1) }
  '; then
    owner_set=1
  fi
fi

# Phase 5: changes.
announce install -r "$apk"
if [ "$dry_run" -eq 0 ]; then
  rc=0
  adb install -r "$apk" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "adb install failed (exit $rc). Nothing else was changed." >&2
    exit "$rc"
  fi
fi

if [ "$owner_set" -eq 1 ]; then
  echo "Fully is already the device owner; skipping set-device-owner."
else
  announce shell dpm set-device-owner "$OWNER_COMPONENT"
  if [ "$dry_run" -eq 0 ]; then
    capture shell dpm set-device-owner "$OWNER_COMPONENT"
    [ -n "$CAP_OUT" ] && printf '%s\n' "$CAP_OUT"
    # Older adb returns 0 from adb shell even when dpm fails, so require Success.
    case "$CAP_OUT" in
      *Success*) ok=1 ;;
      *) ok=0 ;;
    esac
    if [ "$CAP_RC" -ne 0 ] || [ "$ok" -eq 0 ]; then
      echo "set-device-owner failed (see above). The usual causes are an account on the tablet or another device owner: factory reset the tablet and run this again." >&2
      exit 1
    fi
  fi
fi

announce push "$SETTINGS_COPY" "$DEVICE_PATH"
if [ "$dry_run" -eq 0 ]; then
  rc=0
  adb push "$SETTINGS_COPY" "$DEVICE_PATH" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "adb push failed (exit $rc)." >&2
    exit "$rc"
  fi
fi

announce shell settings put global stay_on_while_plugged_in 7
if [ "$dry_run" -eq 0 ]; then
  rc=0
  adb shell settings put global stay_on_while_plugged_in 7 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "Could not set stay_on_while_plugged_in (exit $rc)." >&2
    exit "$rc"
  fi
fi

if [ "$dry_run" -eq 1 ]; then
  echo "Dry run: no adb command was run."
  exit 0
fi

# Phase 6: what is left to do by hand.
echo "Done. Remaining manual steps on the tablet:"
echo "  1. Open Fully, grant the permissions it asks for, and activate the PLUS license. On Android 13 or later, if a setting is blocked as restricted: App info for Fully > three-dot menu > Allow restricted settings."
echo "  2. If you connect over Tailscale, install it now: the device owner is set, so adding an account is safe from here on."
echo "  3. In Fully: Other Settings > Import Settings from File > Download/fully-settings.json."
echo "  4. Set your kiosk PIN in Kiosk Mode > Kiosk Mode PIN. This script never pushes a PIN; do not reuse the organizer PIN."
echo "  5. Turn on kiosk mode and, when Fully asks, make it the default Home app."
echo "  6. Restart the tablet: it should open on the hub. Then pair it (Pair this tablet, after the organizer signs in)."
echo "See demo/tablet/README.md."
