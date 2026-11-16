# Fully Kiosk settings for the hub tablet

`fully-settings.json` is the reviewed Fully Kiosk Browser settings file for
the Butler hub (#129). Importing it makes every hub tablet behave the same:
it boots straight into the hub, stays on during the day, sleeps overnight,
recovers on its own after a network drop or a page error, and cannot be
swiped or zoomed out of the board.

It is a partial settings file: it holds only the settings the hub needs, and
Fully keeps its own defaults for everything else. It has two placeholders that
you fill in on your own machine, never in the repo:

- `__START_URL__` is the value of `startURL`: the hub URL the tablet opens.
- `__KIOSK_PIN__` is the value of `kioskPin`: the PIN that unlocks kiosk mode.

On a factory-reset Android tablet, the provisioning script (#128) installs
Fully, makes it the device owner and pushes this file with the start URL
filled in: see [Provisioning script](#provisioning-script). The runbook for
the whole tablet setup is #127, and checking the result on a real device is
tracked in #132.

## Provisioning script

`provision-tablet.sh` (bash) and `provision-tablet.ps1` (PowerShell 7) are
twins: they take the same flags, run the same adb commands in the same order
and print the same text.

1. **Get the Fully EMM APK.** Download the EMM edition of Fully Kiosk Browser
   (package `com.fullykiosk.emm`, not the Play Store build) from
   https://www.fully-kiosk.com/docs/en/getting-started/downloads and save it
   as `demo/tablet/fully-emm.apk`, or pass its path with `--apk`. Git ignores
   every `*.apk`, so the APK is never committed.
2. **Connect the tablet** over USB with USB debugging on, and accept the
   debugging prompt on the tablet. For the first run it must be factory reset
   with no account added: Android only lets an app become device owner when
   the tablet has no account.
3. **Run the script** from the repo root:

   ```bash
   bash demo/tablet/provision-tablet.sh --url https://<host>.<tailnet>.ts.net
   ```

   PowerShell:

   ```powershell
   pwsh demo/tablet/provision-tablet.ps1 --url https://<host>.<tailnet>.ts.net
   ```

   Without `--url`, the start URL is the one `demo/demo.sh share` prints
   (`https://` plus the machine's Tailscale HTTPS name); the script only reads
   `tailscale status --json` and does not turn sharing on. Add `--dry-run` to
   print every adb command without running any.

Before it changes anything, the script stops with a message (and a non-zero
exit code) if the APK is missing (it prints the download page), the start URL
is unknown or has characters other than letters, digits and `. _ ~ : / -`,
`adb` is not on your PATH, no device or more than one device is connected,
the tablet has not accepted USB debugging, `adb shell dumpsys account` cannot
be read, or it shows an account while Fully is not yet the device owner. The
script reads `adb shell dumpsys device_policy` first, so an account only stops
a tablet where Fully still has to become device owner.

Then it runs, in order:

1. `adb install -r <apk>`
2. `adb shell dpm set-device-owner com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver`,
   skipped when the `Device Owner:` section of `adb shell dumpsys device_policy`
   names Fully (`package=com.fullykiosk.emm`). Fully being only a device admin
   does not count. If this fails, the script stops here.
3. `adb push` of a filled copy of this file to
   `/sdcard/Download/fully-settings.json`. The copy has `__START_URL__`
   replaced by the start URL, and the `kioskPin` line (the `__KIOSK_PIN__`
   placeholder) removed, so the script never pushes a PIN. The copy lives in a
   temp folder that is deleted when the script ends.
4. `adb shell settings put global stay_on_while_plugged_in 7` (the screen stays
   on while the tablet charges).

It then prints the steps left to do on the tablet: activate the license and
grant permissions, install Tailscale if you use it, Import Settings from File
in Fully (step 5 of [Importing the settings](#importing-the-settings)), set
the kiosk PIN by hand in Kiosk Mode > Kiosk Mode PIN, turn on kiosk mode, and
restart and pair the tablet. After the import, delete the pushed copy with
`adb shell rm /sdcard/Download/fully-settings.json`.

A re-run after you install Tailscale (or add any account) still works: once
the `Device Owner:` section of `adb shell dumpsys device_policy` names Fully,
an account no longer stops the script. It reinstalls the APK, skips
set-device-owner and pushes the settings again. If Fully is not the device
owner, an account still means a factory reset.

The manual steps in [Importing the settings](#importing-the-settings) remain
the way to load this file without the script, for example on a tablet that
already has an account and where Fully is not the device owner.
`bash demo/ci/check-provision-tablet.sh` checks both scripts against a fake
adb; demo-ci runs it.

## Requirements

- An Android tablet with Fully Kiosk Browser installed.
- A Fully PLUS license for the tablet. Kiosk mode, remote administration and
  the wakeup and sleep schedule are PLUS features: without a license they do
  not take effect and Fully shows a watermark.
- `adb` on the desktop and USB debugging enabled on the tablet (the same setup
  as [adb reverse](../README.md#adb-reverse-android-usb)), to copy the file
  over. Any other way of getting the file to the tablet's Download folder
  works too.

## Settings

Every key in `fully-settings.json`, with where to find it in Fully's settings
(labels can move a little between Fully versions) and why the hub sets it.
Booleans are JSON `true`/`false`; Fully stores numbers and times as strings.

| Key | Value | Fully menu | Why |
| --- | --- | --- | --- |
| `startURL` | `__START_URL__` | Web Content Settings > Start URL | The hub URL. Filled in at import time (see step 1), because it differs per desktop and tailnet. |
| `kioskMode` | `true` | Kiosk Mode (PLUS) > Enable Kiosk Mode | Locks the tablet to the hub: no home button, status bar or app switching for the family. |
| `kioskPin` | `__KIOSK_PIN__` | Kiosk Mode (PLUS) > Kiosk Mode PIN | The PIN that leaves kiosk mode. Filled in at import time (see step 2) so no real PIN is ever committed. |
| `launchOnBoot` | `true` | Device Management > Launch on Boot | After a power cut or a restart the tablet comes back to the hub with nobody touching it. |
| `keepScreenOn` | `true` | Device Management > Keep Screen On | The hub is an always-on board; the screen must not time out during the day. |
| `sleepSchedule` | `[{"sleepTime":"22:00","wakeupTime":"06:00","dayOfWeek":8}]` | Power Settings (PLUS) > Schedule Wakeup and Sleep | The overnight dim: the screen turns off at 22:00 and back on at 06:00. `dayOfWeek` 8 is read as every day; Fully does not document the number, so confirm it after import (step 6). The value is a string that contains JSON. |
| `reloadOnWifiOn` | `true` | Web Auto Reload > Auto Reload on Network Reconnect | Reloads the hub when Wi-Fi comes back, so a page that failed to load while the network was down (a router restart, or a boot before Wi-Fi joined) recovers by itself. |
| `reloadPageFailure` | `"15"` | Web Auto Reload > Auto Reload after Page Error | Retries 15 seconds after a page load error instead of leaving an error page on the board. |
| `enablePullToRefresh` | `false` | Web Browsing Settings > Enable Pull to Refresh | A swipe down on the chore board must not reload the page. |
| `enableZoom` | `false` | Web Zoom and Scaling > Enable Zoom | A pinch or double tap must not zoom the board out of its layout. |
| `remoteAdmin` | `false` | Remote Administration (PLUS) > Enable Remote Administration | Off by default: nothing on the network can control the tablet unless you turn it on yourself. |
| `deleteWebstorageOnReload` | `false` | Web Auto Reload > Delete Webstorage on Auto Reload | Safety pin. The hub keeps its offline last-known week and its queue of unsent writes in web storage (`Butler.UI/src/offline/`), and its hub pairing too (`butler.hubPairing.v1`, #188); clearing it on every reload would lose all three and unpair the tablet. |
| `deleteCacheOnReload` | `false` | Web Auto Reload > Delete Cache on Auto Reload | Safety pin. Keeps the cached hub files, so a reload while offline still shows the board. |

The file deliberately leaves out a screensaver (it would cover the board during
the day; the overnight dim is the sleep schedule) and Auto Reload on Internet
Reconnect (Fully checks for the internet by pinging 8.8.8.8, which a
tailnet-only or offline demo does not need).

Import only adds or changes the settings in the file. On a tablet that has run
Fully before, reset it first (Other Settings > Reset Settings) so old settings
do not linger.

## Importing the settings

Do this on the desktop from the repo root, with the tablet connected over USB.

1. **Pick the start URL.** This replaces `__START_URL__` (the `startURL`
   value). Use the HTTPS URL that `demo/demo.sh share` prints
   (`https://<host>.<tailnet>.ts.net`), or `http://localhost:8080` if the
   tablet stays on a USB cable with `adb reverse tcp:8080 tcp:8080` (the
   mapping drops when the cable or adb disconnects). Never use
   `http://<lan-ip>:8080`: the service worker does not register there and the
   hub stops working offline. See
   [Connecting a tablet](../README.md#connecting-a-tablet).
2. **Pick the kiosk PIN.** This replaces `__KIOSK_PIN__` (the `kioskPin`
   value). Choose digits only you know, and not the organizer PIN in
   `demo/.env`: the kiosk PIN unlocks the tablet, the organizer PIN unlocks
   the household. Like the organizer PIN, it is never committed.
3. **Fill in both placeholders in a copy outside the repo.** Never edit
   `demo/tablet/fully-settings.json` itself. With bash:

   ```bash
   mkdir -p ~/butler-tablet
   sed -e 's|__START_URL__|https://<host>.<tailnet>.ts.net|' \
       -e 's|__KIOSK_PIN__|<your kiosk pin>|' \
       demo/tablet/fully-settings.json > ~/butler-tablet/fully-settings.json
   ```

   PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME/butler-tablet" | Out-Null
   (Get-Content demo/tablet/fully-settings.json -Raw).Replace('__START_URL__', 'https://<host>.<tailnet>.ts.net').Replace('__KIOSK_PIN__', '<your kiosk pin>') |
     Set-Content -NoNewline "$HOME/butler-tablet/fully-settings.json"
   ```

4. **Copy the filled file to the tablet:**

   ```bash
   adb push ~/butler-tablet/fully-settings.json /sdcard/Download/fully-settings.json
   ```

5. **Import it in Fully.** On the tablet, open Fully and its settings (swipe
   in from the left edge, then Settings). On a reused tablet, run Other
   Settings > Reset Settings first. Then open Other Settings >
   Import Settings from File and pick `Download/fully-settings.json`. Allow
   file access if Android asks.
6. **Check the result** in Fully's settings:
   - Web Content Settings > Start URL is your URL from step 1.
   - Kiosk Mode > Enable Kiosk Mode is on, and Kiosk Mode PIN is set.
   - Power Settings > Schedule Wakeup and Sleep shows sleep at 22:00 and
     wakeup at 06:00 on every day of the week. If it shows other days, fix
     the days by hand.
   - Remote Administration > Enable Remote Administration is off.
7. **Restart the tablet.** Fully should start on its own, in kiosk mode, on
   the hub.
8. **Delete the filled copies**, which hold your real PIN:

   ```bash
   rm ~/butler-tablet/fully-settings.json
   adb shell rm /sdcard/Download/fully-settings.json
   ```

   PowerShell: `Remove-Item "$HOME/butler-tablet/fully-settings.json"`, then
   the same `adb shell rm` line.

If the kiosk PIN does not take (Kiosk Mode PIN is empty after import, or your
PIN does not unlock the tablet), set it by hand in Kiosk Mode > Kiosk Mode
PIN. Newer Fully versions store the PIN encrypted, but they accept a plain
`kioskPin` on import.

## Changing a setting

1. Change the value in `fully-settings.json`, or add the key. Keep the keys
   sorted, the 2-space indent and plain ASCII. To find a key's name, export
   the settings from a test tablet (Other Settings > Export Settings to File)
   to a folder outside the repo and look it up there. Never copy an export
   into the repo: it holds the encrypted PIN (`*Enc` keys) and can hold Wi-Fi
   and other passwords.
2. Add or update the key's row in the Settings table above, with the reason
   it is set.
3. If you changed one of the values the check pins, update its expected
   value in `demo/ci/check-fully-settings.sh` in the same change.
4. Run `bash demo/ci/check-fully-settings.sh`. demo-ci runs it too: it fails
   if a pinned value is wrong, the file holds anything but the two
   placeholders for the URL and PIN, any `*Enc`, password or Wi-Fi key, a key
   that is not in this README, or a non-ASCII character.
