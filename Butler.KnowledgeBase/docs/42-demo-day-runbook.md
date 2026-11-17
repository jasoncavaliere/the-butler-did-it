---
type: Runbook
title: Demo-Day Runbook
description: "The checklist for a live Butler demo: the night-before commands, the on-site network fallbacks (Tailscale, phone hotspot, adb reverse), a talk track in the demo video's beat order, the reset between demos, and what to do when something breaks."
tags: [demo, demo day, runbook, checklist, tablet, tailscale, reset, troubleshooting]
category: Operations
lifecycle: Living
owner: agent-managed
related: [13-customer-interview-guide, 18-demo-video-script, 40-hub-tablet-kiosk-setup, 41-on-device-acceptance-checklist]
sources:
  - { id: issue-138, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/138, title: S5 - Demo-day runbook }
  - { id: issue-101, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/101, title: D8 - demo share - HTTPS URL for the tablet via Tailscale as a QR code }
  - { id: issue-102, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/102, title: D9 - demo CLI skeleton for Windows and Linux or macOS }
  - { id: issue-127, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/127, title: K1 - Runbook - hub tablet kiosk setup }
  - { id: issue-135, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/135, title: S2 - 90-second demo video script and shot list }
  - { id: demo-readme, resource: ../../demo/README.md, title: Butler demo stack README - Demo CLI, Organizer PIN, Connecting a tablet, Reset the demo, Verify the demo }
  - { id: demo-tablet-readme, resource: ../../demo/tablet/README.md, title: Fully Kiosk settings for the hub tablet }
  - { id: demo-video-script, resource: 18-demo-video-script.md, title: Demo Video Script and Shot List - the beat order }
  - { id: hub-tablet-kiosk-setup, resource: 40-hub-tablet-kiosk-setup.md, title: Hub Tablet Kiosk Setup runbook }
  - { id: on-device-acceptance-checklist, resource: 41-on-device-acceptance-checklist.md, title: On-Device Acceptance Checklist - DD-3 and OE-2 }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-17T04:28:38Z }
---

# Demo-Day Runbook

> - **Who it's for:** Whoever runs a live Butler demo on the hub tablet
> - **Use this when:** The night before a demo, on site, and between demos
> - **You'll end with:** A demo that starts from a clean, paired hub, and a known fix for each common failure

This is the checklist for a live demo of Butler on the [hub](90-glossary.md#the-hub) tablet, written for [issue #138](https://github.com/jasoncavaliere/the-butler-did-it/issues/138). It assumes the tablet is already set up with the [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) runbook and has passed the [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md). **This runbook has not had a full dry run on the real tablet yet**: the owner runs one after merge, and each gap becomes a follow-up issue.

Every command runs on the desktop that hosts the demo stack, from the repo root. On Windows, use `pwsh demo/demo.ps1` with the same subcommand in place of `demo/demo.sh`. The full CLI is in [Demo CLI](../../demo/README.md#demo-cli). Never write the organizer PIN, the kiosk PIN, a tailnet host name or a LAN IP in this page or in your notes.

## The night before

1. Check that `demo/.env` sets the organizer PIN without printing it: `grep -c BUTLER_DEMO_PIN demo/.env` should print `1`. If it prints `0`, set one as in [Organizer PIN](../../demo/README.md#organizer-pin).
2. Start the stack: `demo/demo.sh up`. Wait for the line that starts `Demo ready: hub http://localhost:8080`.
3. Reset to the seeded demo household, which the suite starts from: `demo/demo.sh reset`. Then test the whole demo path headless: `demo/demo.sh verify`. Expect `Demo verified: the browser suite passed and the stack was reset.` It ALWAYS ends with a reset, which unpairs every hub, so run it before you pair the tablet ([Verify the demo](../../demo/README.md#verify-the-demo)).
4. Check the stack: `demo/demo.sh status`. Every service should be `running` and `healthy`, and the last line reads `Dataset: <id>`.
5. Share the hub on your tailnet: `demo/demo.sh share`. It prints `Hub on your tailnet: https://<host>.<tailnet>.ts.net`. The tablet's Fully start URL is already that URL.
6. Re-pair the tablet: follow the tablet steps in [Reset between demos](#reset-between-demos), as in DD-3 of the [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md#dd-3-demo-reset-on-the-desktop-clears-the-tablet) and [Before each take](18-demo-video-script.md#before-each-take).
7. Charge the tablet overnight with its charge cap left on ([Battery charge cap](40-hub-tablet-kiosk-setup.md#battery-charge-cap)). Pack its charger.
8. Pack the USB cable for `adb` and the phone you will use as a hotspot.
9. Optional: save the phone hotspot's Wi-Fi on the tablet now, so on site you only switch networks. Changing Wi-Fi means leaving kiosk mode: see [Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin).
10. Know both PINs, the organizer PIN and the kiosk PIN, but never write them down.
11. Note the Fully sleep window, 22:00-06:00 (`sleepSchedule` in [Settings](../../demo/tablet/README.md#settings)). Inside it the tablet screen is off, so do not plan a demo there.

## On site: network plan

The hub needs a secure origin for its service worker: HTTPS, or `http://localhost`. **Never use `http://<lan-ip>:8080`**: the page loads, but the hub stops working the moment the tablet goes offline ([Connecting a tablet](../../demo/README.md#connecting-a-tablet)). Try these in order, and move to the next one only when the current one fails.

### 1. Tailscale over the customer Wi-Fi

This is the default (#101). Put the desktop and the tablet on the customer Wi-Fi. To join a new Wi-Fi on the tablet, exit kiosk mode as in [Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin).

```bash
demo/demo.sh share      # prints https://<host>.<tailnet>.ts.net and a QR code
tailscale status        # the tablet is listed and not offline
```

The Fully start URL is already the share URL, so the hub just loads. The maintenance menu's `API ping` should read `OK`. See [Tailscale (default)](../../demo/README.md#tailscale-default).

### 2. Phone hotspot

Use this when the customer Wi-Fi blocks Tailscale or needs a captive-portal login. Put the tablet on the phone hotspot (and the desktop too, if its own network also fails). The URL stays the same, because Tailscale works across networks.

```bash
tailscale status        # both devices listed and not offline
tailscale serve status  # still shows the proxy to port 8080
demo/demo.sh share      # only if serve status shows nothing
```

### 3. adb reverse over USB

The last resort, for an Android or Fire tablet only (an iPad has no `adb`). It needs no network at all.

```bash
adb devices                     # the tablet is listed as device
adb reverse tcp:8080 tcp:8080
adb reverse --list              # shows tcp:8080 tcp:8080
```

- On the tablet, the hub is now `http://localhost:8080`. That is a **new origin**, so its pairing, cache and queue start empty. Change the Fully start URL to it (exit kiosk mode as in [Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin)), then pair the tablet as in [Reset between demos](#reset-between-demos).
- Beats 8 and 9 of the talk track cannot be shown: turning off Wi-Fi does not cut a USB link. Skip them and say so.
- The mapping drops when the cable or adb disconnects. Run `adb reverse tcp:8080 tcp:8080` again.
- Clean up afterwards with `adb reverse --remove tcp:8080`, and put the share URL back as the Fully start URL. See [adb reverse (Android, USB)](../../demo/README.md#adb-reverse-android-usb).

At the end of the day, run `demo/demo.sh unshare`.

## Talk track

The beats follow the same order as the [demo video script](18-demo-video-script.md#script), and each is named by that script's on-screen text. Use the video's voiceover as your words, or say it your own way.

1. **Butler. The household hub.** The tablet on the wall, paired and signed out.
2. **One tablet. The whole family. No logins.** The four name tiles: Maria, Dan, Ava and Leo.
3. **Tap your name.** Tap Maria. In the seeded week she has no chores, so her board shows "All caught up."
4. **Tap a chore. Done.** Tap Dan, then one of his Open chores within 45 s of the tap. Tap it again to reopen it.
5. **Fair, at a glance.** The "Contribution balance" bars.
6. **Add it to the cart.** Tap Maria, type `oat milk` in the cart field, and show "H-E-B Oat Milk" in the cart.
7. **A parent confirms the order.** Tap "Organizer sign in" and enter the PIN with the keypad turned away from the room. Confirm the cart. Say it goes to a practice store, not a real H-E-B order.
8. **Still there when the Wi-Fi drops.** While still online, open the maintenance menu (its PIN check needs the API). Off to the side, run `adb shell svc wifi disable`, then choose `Reload app`. Show "Showing last-known - saved ..." and the `Offline` chip.
9. **Syncs when the network is back.** Run `adb shell svc wifi enable`, wait for Tailscale, and tap Dan. Turn Wi-Fi off without a reload, tap one of his Open chores, and show "1 waiting to sync". Turn Wi-Fi on and show "All synced."
10. **Butler. Join the pilot.** Name the product and the pilot ask.

After beat 10, go straight into the [Customer Interview Guide](13-customer-interview-guide.md) while the demo is fresh. Beats 8 and 9 need the tablet on the USB cable for the Wi-Fi toggles, as in [During the take](18-demo-video-script.md#during-the-take). If the tablet is a Fire and beat 8 does not show the last-known board, skip beats 8 and 9.

## Reset between demos

The demo confirms the cart and changes chores, so reset before every demo. On the desktop:

```bash
demo/demo.sh reset         # or: pwsh demo/demo.ps1 reset
```

Expect `Dataset: <old> -> <new>` at the end. The reset unpairs the tablet and signs the organizer out ([Reset the demo](../../demo/README.md#reset-the-demo)). Then, on the tablet:

1. Open the maintenance menu: hold the household name for 3 seconds, then enter the organizer PIN.
2. Choose `Reload app` and confirm. The hub unpairs and shows "The Parker Household", waiting for the organizer.
3. Tap "Organizer sign in", enter the PIN, and tap "Pair this tablet".
4. Check that the board shows The Parker Household with four name tiles: Maria, Dan, Ava and Leo.
5. Open the maintenance menu again. Check that `Dataset` matches the new id from the reset, and `API ping` reads `OK`.
6. Check the header chips: `Online`, and no "waiting to sync" chip.
7. Sign the organizer out with "Sign out" in the organizer bar.

If any check fails, use DD-3's recovery in the [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md#dd-3-demo-reset-on-the-desktop-clears-the-tablet): `Clear local cache`, then `Reload app`, and pair again.

## If something breaks

Run every check on the desktop off the projector, so no PIN or host name shows on screen.

| Problem | Symptom | How to confirm | Recovery |
| --- | --- | --- | --- |
| **Tablet cannot reach desktop** | Fully shows a load error, or the hub shows the `Offline` chip while the tablet's Wi-Fi is up | `demo/demo.sh status` shows every service healthy, and `curl -fsS http://localhost:8080/api/health` answers. Then `tailscale status` shows the tablet offline, or `tailscale serve status` shows nothing | Run `demo/demo.sh share`. If the tablet is still offline in `tailscale status`, move to the next step of the [network plan](#on-site-network-plan) |
| **Service worker missing** | The hub works online, but an offline reload shows the browser's own offline page instead of the last-known board | The origin is the share URL or `http://localhost:8080`, never a LAN IP. `node demo/ci/check-precache.cjs http://localhost:8080/sw.js` exits 0 for a real worker. In Chrome, use [OE-2](41-on-device-acceptance-checklist.md#oe-2-service-worker-is-active) | Rebuild the export: `rm -f Butler.UI/dist/.demo-build-env && demo/demo.sh up`. Then on the tablet choose `Reload app`. If the origin is wrong, fix the Fully start URL ([Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin)) |
| **Stale data** | Last demo's confirmed cart or done chores still show, or the "Showing last-known - saved ..." banner stays up while online | The maintenance menu's `Dataset` differs from the `Dataset:` line of `demo/demo.sh status` | Run `demo/demo.sh reset`, then the tablet steps in [Reset between demos](#reset-between-demos). If it persists, choose `Clear local cache`, then `Reload app`, and pair again |
| **Organizer PIN forgotten** | The PIN pad says "That PIN is not right.", or "Too many tries. Try again in a minute." after 5 wrong tries | Off the projector, run `grep BUTLER_DEMO_PIN demo/.env` and `printenv BUTLER_DEMO_PIN`. A PIN exported in the shell that ran `up` wins over `demo/.env` | Wait 60 s if locked, then enter the PIN that won. To change it, rewrite `demo/.env` ([Organizer PIN](../../demo/README.md#organizer-pin)), run `unset BUTLER_DEMO_PIN`, then `demo/demo.sh down` and `demo/demo.sh up`. The kiosk PIN is separate: see [Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin) |
| **API down** | The `Offline` chip shows while the network is fine, sign-in says "Sign-in failed. Please try again.", and the maintenance menu will not open (its PIN check needs the API) | `demo/demo.sh status` shows `api` not healthy or "Stack is not running.", `curl -fsS http://localhost:8080/api/health` fails, and `demo/demo.sh logs --api` shows the error | Run `demo/demo.sh down`, then `demo/demo.sh up`, and wait for `Demo ready`. A bare `up` does not restart an `api` container that is running but unhealthy; `down` keeps the demo data in `demo/.data`. The restart signs the organizer out, so sign in again. The hub stays paired. See [Logs](../../demo/README.md#logs) |

## Sources

1. [Issue #138 - S5 - Demo-day runbook](https://github.com/jasoncavaliere/the-butler-did-it/issues/138)
2. [Issue #101 - D8 - demo share - HTTPS URL for the tablet via Tailscale as a QR code](https://github.com/jasoncavaliere/the-butler-did-it/issues/101)
3. [Issue #102 - D9 - demo CLI skeleton for Windows and Linux or macOS](https://github.com/jasoncavaliere/the-butler-did-it/issues/102)
4. [Issue #127 - K1 - Runbook - hub tablet kiosk setup](https://github.com/jasoncavaliere/the-butler-did-it/issues/127)
5. [Issue #135 - S2 - 90-second demo video script and shot list](https://github.com/jasoncavaliere/the-butler-did-it/issues/135)
6. [Butler demo stack README - Demo CLI, Organizer PIN, Connecting a tablet, Reset the demo, Verify the demo](../../demo/README.md)
7. [Fully Kiosk settings for the hub tablet](../../demo/tablet/README.md)
8. [Demo Video Script and Shot List - the beat order](18-demo-video-script.md)
9. [Hub Tablet Kiosk Setup runbook](40-hub-tablet-kiosk-setup.md)
10. [On-Device Acceptance Checklist - DD-3 and OE-2](41-on-device-acceptance-checklist.md)

## Related

- [Customer Interview Guide](13-customer-interview-guide.md) - the questions to ask right after beat 10.
- [Demo Video Script and Shot List](18-demo-video-script.md) - the script whose beat order the talk track follows.
- [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) - how the tablet was set up, and how to exit kiosk mode on site.
- [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md) - the checks to pass before demo day, including the DD-3 reset check.
