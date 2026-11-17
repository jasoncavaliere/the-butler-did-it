---
type: Checklist
title: On-Device Acceptance Checklist
description: "The checks a person runs on the real hub hardware after setup and before a demo: five kiosk checks on the Fire + Fully Kiosk demo device, the offline-epic (#31-#34) checks in Chrome only, and a blank results table."
tags: [hub, tablet, kiosk, acceptance, checklist, offline, chrome, fully kiosk]
category: Operations
lifecycle: Living
owner: agent-managed
related: [18-demo-video-script, 40-hub-tablet-kiosk-setup]
sources:
  - { id: issue-132, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/132, title: K6 - On-device acceptance checklist (run by a human on the real tablet) }
  - { id: issue-31, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/31, title: O1 - PWA manifest, service worker, and installability }
  - { id: issue-32, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/32, title: O2 - Last-known-week cache (glanceable offline) }
  - { id: issue-33, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/33, title: O3 - Local write queue + sync-on-reconnect }
  - { id: issue-34, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/34, title: O4 - Offline status UI (indicator + queued-writes surfaced) }
  - { id: issue-108, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/108, title: D15 - Tablets pick up new builds automatically (service worker update flow) }
  - { id: adr-0012, resource: ../adr/0012-hub-reference-validation-tablet.md, title: ADR-0012 - Hub demo device and offline-epic validation runtime }
  - { id: hub-tablet-kiosk-setup, resource: 40-hub-tablet-kiosk-setup.md, title: Hub Tablet Kiosk Setup runbook }
  - { id: demo-readme, resource: ../../demo/README.md, title: Butler demo stack README - Connecting a tablet, Organizer PIN, Reset the demo }
  - { id: demo-tablet-readme, resource: ../../demo/tablet/README.md, title: Fully Kiosk settings for the hub tablet }
  - { id: ui-architecture, resource: ../../Butler.UI/ARCHITECTURE.md, title: Butler.UI architecture notes - offline epic, updates, organizer auth }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-17T03:09:30Z }
---

# On-Device Acceptance Checklist

> - **Who it's for:** The organizer, or whoever runs the demo tablet
> - **Use this when:** You have set up a tablet with the runbook, and before each demo
> - **You'll end with:** A filled-in results table posted on #132

Run these checks on real hardware, not in an emulator. Set the tablet up first with the [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) runbook. Which device runs which checks is decided in [ADR-0012](../adr/0012-hub-reference-validation-tablet.md).

How to record results:

- Fill in the [results table](#results-table) at the end, one row per check per runtime.
- Post the filled table as a comment on [#132](https://github.com/jasoncavaliere/the-butler-did-it/issues/132).
- File a new bug issue for each failed check. Name the check id in the title.

Two notes on ids:

- Issues #31 to #34 do not number their acceptance criteria. Here, an AC id is the position in that issue's Acceptance Criteria list: AC1 is the first checkbox, AC2 the second, and so on.
- ADR-0012 says the hands-on pass is tracked in #165. That issue was closed and folded into #132, so results go on #132.

## Before you start

- The demo stack is up (`demo/demo.sh up`) and freshly reset (`demo/demo.sh reset`).
- `demo/demo.sh share` is running, and you know the HTTPS URL it printed. See [Connecting a tablet](../../demo/README.md#connecting-a-tablet). Never use `http://<lan-ip>:8080`: service workers need a secure origin.
- You have the organizer PIN (from `demo/.env`) and the kiosk PIN.
- The Fire is set up on the runbook's [Fire tablet path](40-hub-tablet-kiosk-setup.md#fire-tablet-path). It is paired: "Organizer sign in", then "Pair this tablet" (see [Organizer PIN](../../demo/README.md#organizer-pin)).
- A physical Play Store Android device runs stable Chrome 158 or later. Check the version at `chrome://version`. It runs Tailscale on the same tailnet, has the share URL open, and is paired.
- Desktop Chrome 158 or later has `http://localhost:8080` open, and is paired.
- Required for the Android device: USB debugging is on, and the device is plugged into the desktop. Open `chrome://inspect` on the desktop to get DevTools for the Android tab. Android Chrome has no DevTools of its own, and OE-4 to OE-7 read local storage there. The USB link keeps working in airplane mode.

**The maintenance menu.** Several checks use it. Hold the household name for 3 seconds, then enter the organizer PIN. The menu shows the API URL, an API ping, the dataset id, and the hub and API builds. Its actions are `Reload app`, `Clear local cache` and `Sign out organizer`. Each asks you to confirm.

## Demo device (Fire + Fully Kiosk)

These five checks run on the Fire only. They test the kiosk, not the offline epic.

### DD-1 Cold boot lands on Butler with no swipe

- **Runtime:** Fire + Fully Kiosk
- **Steps:**
  1. Hold the power button and shut the Fire down.
  2. Power it on. Touch nothing.
- **Expected:** Fully starts on its own, in kiosk mode, on the hub (`launchOnBoot`). The paired household's board shows. There is no lock-screen swipe and no Fully trial watermark.
- **If it fails:** Exit kiosk mode with the PIN ([Exit kiosk mode with the PIN](40-hub-tablet-kiosk-setup.md#exit-kiosk-mode-with-the-pin)). Check Launch on Boot and Enable Kiosk Mode against [Settings](../../demo/tablet/README.md#settings). Re-run step 6 of [Importing the settings](../../demo/tablet/README.md#importing-the-settings). If it still fails, file a bug that names DD-1.

### DD-2 Home and recents are blocked

- **Runtime:** Fire + Fully Kiosk
- **Steps:**
  1. Press Home. Then press Recents. If the Fire uses gesture navigation, use the home and recents swipes instead.
  2. Try to pull down the status bar.
  3. On the desktop, run `adb shell dumpsys device_policy` with the Fire on USB.
- **Expected:** Butler stays on screen through steps 1 and 2. In step 3, a Device Owner block that names `com.fullykiosk.emm` means Fully is the device owner. Write which lockdown applied in the Notes column: "device owner + Lock Task Mode" or "Fully Fire lockdown (Accessibility service + Home app swap)". ADR-0012 asks #132 to record this.
- **If it fails:** Re-check the runbook's [Fire tablet path](40-hub-tablet-kiosk-setup.md#fire-tablet-path), step 8 (the Accessibility service) and step 9 (the Home app swap, Fire OS 5 to 7). Without the swap, Home takes about 5 seconds to return to Fully on those versions. That counts as a fail here. File a bug that names DD-2.

### DD-3 Demo reset on the desktop clears the tablet

- **Runtime:** Fire + Fully Kiosk, with `demo/demo.sh` on the desktop
- **Steps:**
  1. On the desktop, run `demo/demo.sh reset`. Note the `Dataset: <old> -> <new>` line it prints.
  2. On the Fire, open the maintenance menu. Choose `Reload app` and confirm.
  3. After the reload, tap "Organizer sign in", enter the PIN, and tap "Pair this tablet". A reload always signs the organizer out, so this step is always needed.
  4. Open the maintenance menu again and read it.
- **Expected:**
  - An idle hub does not notice a reset until it reloads. It reads the API again only on its next load, so do not wait for the screen to change. A screen-on glance report runs at most once every 10 minutes, and it is not part of this check.
  - After the reload in step 2, the hub leaves the old board. The reset removed every device token, so the hub's first read is refused and the hub unpairs.
  - It then shows "The Parker Household", waiting for the organizer to sign in.
  - After step 3 the board shows. In step 4 the menu's Dataset row shows the new id from step 1. The sync chips show no "waiting to sync" count.
  - Source: "After a reset" in [Reset the demo](../../demo/README.md#reset-the-demo): "a paired hub unpairs itself on its next load".
- **If it fails:** In the maintenance menu, choose `Clear local cache`, then `Reload app`, and pair again. File a bug that names DD-3.

### DD-4 A new build arrives without touching the tablet

- **Runtime:** Fire + Fully Kiosk, with `demo/demo.sh` on the desktop
- **Steps:**
  1. Leave the hub idle: no name claimed for 45 seconds, and no "waiting to sync" chip.
  2. On the desktop, from the repo root, run `rm -f Butler.UI/dist/.demo-build-env && BUTLER_BUILD_SHA=dd4-check demo/demo.sh up`. Removing the stamp forces a rebuild. The new build id changes the bundle, so the service worker sees a new build. A rebuild with the same id and no UI change looks the same to the tablet.
  3. Wait for `up` to print `Demo ready`. Touch nothing on the Fire.
  4. Afterwards, restore the normal build: `rm -f Butler.UI/dist/.demo-build-env && demo/demo.sh up`. This is a second pass of the same check.
- **Expected:** Within about two minutes of `Demo ready`, the Fire reloads once by itself. The hub checks for a new build every 60 seconds, and it waits for the idle gate. The line "Updated to build dd4-check" shows for about 10 seconds. The hub stays paired. The maintenance menu shows hub and API build `dd4-check`. This is issue [#108](https://github.com/jasoncavaliere/the-butler-did-it/issues/108).
- **If it fails:** In the maintenance menu, choose `Reload app`. Run `demo/demo.sh logs` and look for `/sw.js` requests from the tablet. File a bug that names DD-4. Note that `up` runs the smoke step, so it needs the host .NET SDK.

### DD-5 Overnight dim and morning wake

- **Runtime:** Fire + Fully Kiosk
- **Steps:**
  1. Leave the Fire on its charger overnight with the imported schedule: sleep at 22:00, wake at 06:00 (`sleepSchedule` in [Settings](../../demo/tablet/README.md#settings)).
  2. Look at it at about 22:05, and again at about 06:05.
  3. Optional same-day rehearsal: in Power Settings > Schedule Wakeup and Sleep, set sleep a few minutes ahead. Put 22:00 and 06:00 back afterwards. Only the overnight run counts as a pass.
- **Expected:** At 22:05 the screen is off. At 06:05 it is on. It shows the hub with today's date in the header, the `Online` chip, and no error card.
- **If it fails:** Check the days in Power Settings. `dayOfWeek` 8 is not documented by Fully (see step 6 of [Importing the settings](../../demo/tablet/README.md#importing-the-settings)). Check Keep Screen On. If the hub shows an error after waking, wait 5 minutes for the watchdog reload (#109), or use `Reload app` in the maintenance menu. File a bug that names DD-5.

## Offline epic (Chrome)

**A result here counts only in Chrome, never on the Fire.** Use Chrome on the stable channel, version 158 or later. Run it on a physical Play Store Android device and on desktop Chrome. The Fire runs Amazon's own forked WebView, so a pass there never counts. This is ADR-0012's [Validation runtime and browser floor](../adr/0012-hub-reference-validation-tablet.md#validation-runtime-and-browser-floor) and [Validation bar](../adr/0012-hub-reference-validation-tablet.md#validation-bar). The reasons are findings [F2](11-hub-hardware-findings.md#f2-the-offline-epic-makes-the-browser-engine-a-first-class-requirement) and [F3](11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target). Only the Android device is hardware validation. Desktop Chrome is required too, but it is not hardware validation.

How to run each check:

- If you ran DD-3, or any `demo/demo.sh reset`, the reset cleared every hub pairing. Before OE-1, pair the Android and desktop hubs again. In each, open the maintenance menu and choose `Reload app`. Then tap "Organizer sign in", enter the PIN, and tap "Pair this tablet".
- Run it in both runtimes, and record a row for each.
- On Android, "DevTools" means the Android tab's DevTools, opened from `chrome://inspect` on the desktop.
- Going offline on Android: turn on airplane mode. This also drops Tailscale. After you reconnect, wait for Tailscale to come back.
- Going offline on the desktop: DevTools > Network > throttling > Offline. Also tick Offline in DevTools > Application > Service Workers, so the worker's own fetches fail too. Untick both to go back online.
- The demo household id is `demo-household`.
- A chore tap needs a claimed name, and a claim needs the API. So claim the name while online. Then go offline without a reload, and tap within 45 seconds of the claim.
- The hub drops the claim 45 seconds after it was made (a chore tap does not restart that timer), and on any reload. With no claim, a chore tap does nothing. If the name tile no longer looks claimed, go back online, claim again, and go offline again.

Shared recovery, used by every check below when it fails:

1. Confirm Chrome is 158 or later, and the origin is the HTTPS share URL or `localhost`.
2. Re-check OE-2. A worker that is not running explains most offline failures.
3. Clear the site's data, pair again, and retry once.
4. If it still fails, file a bug that names the check id and the #31-#34 AC id.

### OE-1 Manifest and install

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #31 AC1, #31 AC4
- **Steps:**
  1. Desktop: open DevTools > Application > Manifest.
  2. Desktop: look at the address bar for the install button.
  3. Android: open the Chrome menu. Install the app, then open it.
- **Expected:** The manifest shows name, short_name, 192 and 512 px icons (including maskable ones), display `standalone` with display_override `fullscreen`, a start_url, and theme and background colours. No installability errors. The desktop address bar offers Install. The Android menu offers Install app, and the installed app opens full screen.
- **If it fails:** Use the shared recovery list above.

### OE-2 Service worker is active

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #31 AC2
- **Steps:**
  1. Desktop: open DevTools > Application > Service Workers.
  2. Android: open `chrome://serviceworker-internals`, or use `chrome://inspect` from the desktop.
- **Expected:** `sw.js` is activated and running for the hub's origin.
- **If it fails:** Use the shared recovery list above. Check first that the origin is HTTPS or `localhost`.

### OE-3 The app shell loads offline

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #31 AC3
- **Steps:**
  1. Load the hub once while online.
  2. Go offline.
  3. Reload the page.
- **Expected:** The hub renders. Chrome's own offline page does not show.
- **If it fails:** Use the shared recovery list above.

### OE-4 The last-known week shows offline

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #32 AC1, #32 AC2, #32 AC3
- **Steps:**
  1. Load the hub while online.
  2. In DevTools > Application > Local storage, find `butler.glance.v1.demo-household`. Check it has a `cachedAtIso` value.
  3. Go offline and reload.
- **Expected:** The name tiles and today's board render. The line `Showing last-known - saved N minutes ago` shows (or `moments ago`). The chip reads `Offline`.
- **If it fails:** Use the shared recovery list above.

### OE-5 Reconnect refreshes the board

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #32 AC4
- **Steps:**
  1. Start from the end of OE-4.
  2. Go back online. Do not reload.
- **Expected:** The last-known line clears. The chip reads `Online`. The `cachedAtIso` value in local storage is newer than before.
- **If it fails:** Use the shared recovery list above.

### OE-6 An offline tap is queued and survives a reload

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #33 AC1, #34 AC2
- **Steps:**
  1. Start online, with no "waiting to sync" chip. Claim a name.
  2. Go offline without a reload. Within 45 seconds of the claim, tap one of that person's open chores.
  3. Reload while still offline.
  4. Go back online. Wait for `All synced.` before you start OE-7.
- **Expected:** The row flips to done at once. The chips read `Offline` and `N waiting to sync`, with N at least 1. After the reload, the row is still done and N is still at least 1. The reload drops the claim, which is expected. In DevTools, local storage `butler.writeq.v1.demo-household` holds a pending entry of kind `chore-complete` for the tapped chore. It may also hold a pending entry of kind `hub-glance`, so N may be 2. That is expected: the hub reports a glance on load and on each return to view, at most once per 10 minutes, and queues it while offline. After step 4, `All synced.` shows and the waiting chip goes.
- **If it fails:** Use the shared recovery list above.

### OE-7 Replay runs in order, once, then confirms

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #33 AC3, #33 AC5 (removed only after the API confirms), #34 AC3
- **Steps:**
  1. Start online, with no "waiting to sync" chip. Pick two open chores, A and B, for one person. Do not pick the OE-6 chore.
  2. On the desktop, run `demo/demo.sh logs` to watch Caddy's access log.
  3. Claim that person's name. Go offline without a reload. Within 45 seconds of the claim, tap chore A, then chore B.
  4. Go back online.
  5. Reload twice.
- **Expected:**
  - Caddy logs `POST /api/households/demo-household/assignments/<week>/<A>/complete` before the same request for B. Each appears once.
  - `All synced.` shows for about 4 seconds, then goes.
  - The queue entries leave local storage only after the sync.
  - The fairness counts rise by exactly two, and do not change on reload.
- **If it fails:** Use the shared recovery list above.

### OE-8 The indicator tracks connectivity and never covers the glance

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #34 AC1, #34 AC5
- **Steps:**
  1. Size the window to the tablet's landscape size (on Android, hold the device in landscape).
  2. Go offline and back online a few times.
- **Expected:** The chip switches between `Online` and `Offline` each time. The chips sit in the header beside the date. They never cover the name tiles or the board.
- **If it fails:** Use the shared recovery list above.

### OE-9 A write that cannot sync is shown, not dropped

- **Runtime:** Android Chrome (Play Store) and desktop Chrome, stable 158 or later
- **Validates:** #33 AC6, #34 AC4
- **Steps:**
  1. Start online. Claim a name.
  2. Go offline without a reload. Within 45 seconds of the claim, tap one of that person's open chores.
  3. Move the device clock forward to next Monday. On Android, open Settings > Date and time and turn off automatic time. On the desktop, change the OS clock.
  4. Go back online.
  5. Sign in as the organizer.
  6. Check the Expected result below. Then always do this cleanup, pass or fail. Set the clock back to automatic. Then choose `Clear local cache` in the maintenance menu. On the desktop, the API container uses the same clock, so also run `demo/demo.sh reset`. The reset unpairs every hub, so pair the Fire, the Android device and desktop Chrome again, as in DD-3 steps 2 and 3. For that reason, run OE-9 on the desktop last.
  7. Natural variant: queue the tap offline on a Sunday, and reconnect after Monday 00:00 UTC. The week is counted in UTC. Afterwards, still choose `Clear local cache`. The clock and reset parts of step 6 do not apply.
- **Expected:** The chip `1 change did not go through` shows, and it does not clear by itself. The signed-in organizer sees the row `Marking a chore done: The week ended before this could sync, so it was not applied.`
- **If it fails:** Use the shared recovery list above. Do not stop the API to force a failure instead: the hub holds every replay while the API is down, so nothing fails. Do the step 6 cleanup either way.

### AC coverage

Every acceptance criterion of #31 to #34, and where it is checked. "CI only" means `npm run ci:verify` or a unit test covers it, and no on-device check is needed.

| Issue | AC | What it asks | Checked by |
| --- | --- | --- | --- |
| #31 | AC1 | A valid web app manifest | OE-1 |
| #31 | AC2 | A registered service worker | OE-2 |
| #31 | AC3 | The app shell loads with the network off | OE-3 |
| #31 | AC4 | The app stays installable | OE-1 |
| #31 | AC5 | The export holds the manifest and worker | CI only |
| #31 | AC6 | A build test asserts the export | CI only |
| #31 | AC7 | `npm run ci:verify` passes | CI only |
| #32 | AC1 | A successful load is cached with a freshness stamp | OE-4 |
| #32 | AC2 | The board renders from cache when offline | OE-4 |
| #32 | AC3 | A "showing last-known" line is visible | OE-4 |
| #32 | AC4 | Reconnect refreshes the cache and clears the line | OE-5 |
| #32 | AC5 | Read cache only, never another household's data | CI only (`glanceCache.test.ts`) |
| #32 | AC6 | `npm run ci:verify` passes | CI only |
| #33 | AC1 | An offline tap is queued durably and shown at once | OE-6 |
| #33 | AC2 | Cart adds may share the queue | CI only (the cart add was deferred; `GroceryCart.tsx` does not queue) |
| #33 | AC3 | Replay runs in queue order | OE-7 |
| #33 | AC4 | Replay is idempotent | CI only (dedupe key: `writeQueue.test.ts` "replay-idempotent" and "draining twice"; `CompleteChoreEndpointTests.cs` `Double_complete_is_idempotent`) |
| #33 | AC5 | Retry with backoff; removed only after confirm | OE-7 (removed after confirm); CI only for backoff timing (`writeQueue.test.ts`) |
| #33 | AC6 | A write that fails is kept and surfaced | OE-9 |
| #33 | AC7 | `npm run ci:verify` passes | CI only |
| #34 | AC1 | The indicator tracks online and offline | OE-8 |
| #34 | AC2 | The indicator shows a pending count | OE-6 |
| #34 | AC3 | Sync clears pending and confirms briefly | OE-7 |
| #34 | AC4 | A failed write is visible to the organizer | OE-9 |
| #34 | AC5 | The indicator does not cover the glance | OE-8 |
| #34 | AC6 | `npm run ci:verify` passes | CI only |

## Sources

1. [Issue #132 - K6 - On-device acceptance checklist (run by a human on the real tablet)](https://github.com/jasoncavaliere/the-butler-did-it/issues/132)
2. [Issue #31 - O1 - PWA manifest, service worker, and installability](https://github.com/jasoncavaliere/the-butler-did-it/issues/31)
3. [Issue #32 - O2 - Last-known-week cache (glanceable offline)](https://github.com/jasoncavaliere/the-butler-did-it/issues/32)
4. [Issue #33 - O3 - Local write queue + sync-on-reconnect](https://github.com/jasoncavaliere/the-butler-did-it/issues/33)
5. [Issue #34 - O4 - Offline status UI (indicator + queued-writes surfaced)](https://github.com/jasoncavaliere/the-butler-did-it/issues/34)
6. [Issue #108 - D15 - Tablets pick up new builds automatically (service worker update flow)](https://github.com/jasoncavaliere/the-butler-did-it/issues/108)
7. [ADR-0012 - Hub demo device and offline-epic validation runtime](../adr/0012-hub-reference-validation-tablet.md)
8. [Hub Tablet Kiosk Setup runbook](40-hub-tablet-kiosk-setup.md)
9. [Butler demo stack README - Connecting a tablet, Organizer PIN, Reset the demo](../../demo/README.md)
10. [Fully Kiosk settings for the hub tablet](../../demo/tablet/README.md)
11. [Butler.UI architecture notes - offline epic, updates, organizer auth](../../Butler.UI/ARCHITECTURE.md)

## Related

- [Demo Video Script and Shot List](18-demo-video-script.md) - the demo video shoot; run this checklist on the tablet before the shoot day.
- [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) - the runbook that sets up the tablet these checks run on, and its recovery steps.

## Results table

Add one row per check per runtime. Post the filled table as a comment on [#132](https://github.com/jasoncavaliere/the-butler-did-it/issues/132), and file a bug for each fail.

| Device model | OS version | Browser or WebView version | Kiosk app and version | Date | Check id | Pass/fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
