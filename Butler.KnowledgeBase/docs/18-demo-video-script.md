---
type: Guide
title: Demo Video Script and Shot List
description: "The 90-second demo video for the landing page, posts, and follow-up emails: a timed script, a shot list mapped to each step of the demo-path browser suite (#121), and a recording checklist."
tags: [demo, video, script, shot list, recording, go to market, landing page, hub]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 13-customer-interview-guide, 16-pilot-one-pager, 41-on-device-acceptance-checklist]
sources:
  - { id: issue-135, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/135, title: S2 - 90-second demo video script and shot list }
  - { id: issue-121, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/121, title: P12 - Browser test of the full demo path against the local stack }
  - { id: demo-path-suite, resource: ../../demo/e2e/tests/demo-path.spec.ts, title: The demo-path Playwright suite (nine test steps) }
  - { id: demo-e2e-hub, resource: ../../demo/e2e/hub.ts, title: Demo-path suite helpers - VIEWPORT, MEMBERS, HOUSEHOLD_NAME }
  - { id: demo-readme, resource: ../../demo/README.md, title: Butler demo stack README - Reset the demo, Verify the demo, Connecting a tablet }
  - { id: adr-0001, resource: ../adr/0001-brand-mood-and-voice.md, title: ADR-0001 - Brand mood and voice }
  - { id: adr-0012, resource: ../adr/0012-hub-reference-validation-tablet.md, title: ADR-0012 - Hub demo device and offline-epic validation runtime }
  - { id: fully-settings, resource: ../../demo/tablet/README.md, title: Fully Kiosk settings for the hub tablet }
  - { id: adb-screenrecord, resource: https://developer.android.com/tools/adb#screenrecord, title: Android Debug Bridge - Record a video (screenrecord) }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-17T04:11:18Z }
---

# Demo Video Script and Shot List

> - **Who it's for:** The owner, recording the Butler demo video
> - **Use this when:** You are about to record or re-record the 90-second video
> - **You'll end with:** A cut of 90 seconds or less in which every shot maps to a demo-path suite step

This is the 90-second demo video for the landing page, posts, and follow-up emails. The landing page holds a clip slot for it (`Butler.Site/index.html`, the `DEMO CLIP SLOT`). The video shows the demo path on the real hub tablet, in the same order a presenter walks it.

The source of truth is the demo-path browser suite in `demo/e2e/` ([#121](https://github.com/jasoncavaliere/the-butler-did-it/issues/121)). Every shot below names the suite step it shows. If the suite gains, drops, or renames a step, update the shot list and the step coverage table to match. Recording and editing the video is an owner step.

The voice is the calm concierge from [ADR-0001](../adr/0001-brand-mood-and-voice.md): warm, understated, never scolding, and never gamified. The voiceover runs at about 2.5 words a second or less.

## Script

One row per beat. Start is the sum of the earlier durations.

| Beat | Start | Duration (s) | On-screen text | Voiceover | Shots |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 | 5 | Butler. The household hub. | "This is Butler, the calm hub on our kitchen wall." | SH1 |
| 2 | 0:05 | 7 | One tablet. The whole family. No logins. | "The whole Parker family is right there. No apps, no logins, just names." | SH1, SH2 |
| 3 | 0:12 | 9 | Tap your name. | "Maria taps her name, and the hub is hers. Fair assignment gave her a lighter week, so she is all caught up." | SH3 |
| 4 | 0:21 | 11 | Tap a chore. Done. | "Dan taps his name, then a chore. Done. Tap it again and it reopens, no harm done." | SH4 |
| 5 | 0:32 | 9 | Fair, at a glance. | "The balance shows who has been carrying the load, so nobody has to keep score." | SH5 |
| 6 | 0:41 | 10 | Add it to the cart. | "Out of oat milk? Maria types it in, and the hub finds the right product for the cart." | SH6 |
| 7 | 0:51 | 11 | A parent confirms the order. | "A parent signs in with a PIN, checks the cart, and confirms. In the demo, the order goes to a practice store." | SH7a, SH7b, SH7c |
| 8 | 1:02 | 12 | Still there when the Wi-Fi drops. | "If the Wi-Fi drops, the board stays up. It shows the last-known week and says how fresh it is." | SH8 |
| 9 | 1:14 | 10 | Syncs when the network is back. | "A chore done offline waits its turn, then syncs the moment the network is back." | SH9 |
| 10 | 1:24 | 4 | Butler. Join the pilot. | "Butler. Ready when you are." | graphic, no shot |

Total: 88 s (limit 90 s).

Notes on the copy:

- Beat 3: in the seeded week, fair assignment gives Maria no chores, so her board shows "All caught up." The chore in beat 4 is Dan's. Do not script Maria ticking off a chore.
- Beat 7: the store is a practice store, not a real H-E-B order (see the [Pilot One-Pager](16-pilot-one-pager.md#privacy)). Keep that line in.
- Beat 10: the end card names the product and the pilot ask. It gives no web address.

## Shot list

Every shot names exactly one suite step: the exact test title in `demo/e2e/tests/demo-path.spec.ts`. Title and end cards are graphics, not shots, so they are not listed here.

| Shot | Suite step | Framing | Action on the tablet | Must be on screen | Beat |
| --- | --- | --- | --- | --- | --- |
| SH1 | S1 `setup: the hub opens the Parker household and the organizer pairs it` | Wide on the tablet on the kitchen wall, then a slow push in | None on camera. The suite signs the organizer in, pairs the tablet, and signs out; for the video that happens before the roll (see [Before each take](#before-each-take)), so the shot shows the paired, signed-out board. | "The Parker Household" and four name tiles: Maria, Dan, Ava, Leo | 1, 2 |
| SH2 | S2 `hub: the browser viewport is 1280x800` | Full-frame screen capture, 1280x800 landscape, not scaled or letterboxed | None. Hold on the board. | The whole hub layout, edge to edge | 2 |
| SH3 | S3 `hub: tapping a name shows that participant as claimed` | Over the shoulder on the hand, then cut to the screen capture | Tap Maria. | Maria's tile filled with her claim colour, the today panel reading "Maria's day", and the empty board: "All caught up." | 3 |
| SH4 | S4 `chores: tapping an Open chore marks it Done, tapping again reopens it` | Close on the hand and the chore row | Tap Dan, then one of his Open chores within 45 s (the claim drops 45 s after the tap). It shows Done. Tap it again and it shows Open. Film the reopen; the cut may drop it. | The chore mark changing from Open to Done | 4 |
| SH5 | S5 `fairness: the contribution balance renders its bars` | Screen capture, then a slow zoom on the bars in the edit | None. Hold on the fairness view. | The "Contribution balance" heading and its bars | 5 |
| SH6 | S6 `grocery: a typed item appears in the cart` | Close on the hands typing, then the screen capture | Tap Maria (the add is credited to the active participant). Type `oat milk` in the cart field and submit. Type it; do not use the mic. | "H-E-B Oat Milk" in the cart | 6 |
| SH7a | S7 `organizer: PIN sign-in, confirm the cart, see the receipt` | Tight on the face or a wide shot, never on the keypad | Tap "Organizer sign in" and enter the PIN. Frame or cut it so no digit can be read. | The organizer signed in | 7 |
| SH7b | S7 `organizer: PIN sign-in, confirm the cart, see the receipt` | Screen capture | Tap "Confirm order" in the organizer bar. It brings the cart's confirm button into view. Tap that button. | The cart with H-E-B Oat Milk and its confirm button | 7 |
| SH7c | S7 `organizer: PIN sign-in, confirm the cart, see the receipt` | Screen capture | Hold on the receipt, then tap "Back to the hub". | The "Order confirmed" receipt listing H-E-B Oat Milk, then the week shown as confirmed | 7 |
| SH8 | S8 `offline: a reload shows the last-known board` | Wide on the tablet, then the screen capture | While still online, open the maintenance menu (hold the household name for 3 s, enter the PIN; cut the PIN entry): its PIN check needs the API, so it cannot open offline. Off camera, turn the tablet's Wi-Fi off with `adb shell svc wifi disable`, then choose `Reload app`. | The board, the banner "Showing last-known - saved N minutes ago" (or "moments ago"), and the chip "Offline" | 8 |
| SH9 | S9 `offline: a chore completed offline syncs on reconnect` | Screen capture, with a close insert on the sync chips | Turn Wi-Fi back on: the banner clears and the chip reads "Online". Tap Dan while online. Turn Wi-Fi off without a reload, then tap one of his Open chores within 45 s. It shows Done. Turn Wi-Fi on again. | The chip "1 waiting to sync", then "All synced.", and the chore still Done after the reload | 9 |

### Step coverage

Every step of the suite has at least one shot.

| Suite step | Spec line | Shots |
| --- | --- | --- |
| S1 `setup: the hub opens the Parker household and the organizer pairs it` | `demo-path.spec.ts:57` | SH1 |
| S2 `hub: the browser viewport is 1280x800` | `demo-path.spec.ts:82` | SH2 |
| S3 `hub: tapping a name shows that participant as claimed` | `demo-path.spec.ts:88` | SH3 |
| S4 `chores: tapping an Open chore marks it Done, tapping again reopens it` | `demo-path.spec.ts:108` | SH4 |
| S5 `fairness: the contribution balance renders its bars` | `demo-path.spec.ts:129` | SH5 |
| S6 `grocery: a typed item appears in the cart` | `demo-path.spec.ts:141` | SH6 |
| S7 `organizer: PIN sign-in, confirm the cart, see the receipt` | `demo-path.spec.ts:156` | SH7a, SH7b, SH7c |
| S8 `offline: a reload shows the last-known board` | `demo-path.spec.ts:179` | SH8 |
| S9 `offline: a chore completed offline syncs on reconnect` | `demo-path.spec.ts:199` | SH9 |

## Recording checklist

### Before each take

- Run `demo/demo.sh reset` (or `pwsh demo/demo.ps1 reset`) before each take, every take. Check that it prints `Dataset: <old> -> <new>`. Why: SH7 confirms the week's cart and SH4 and SH9 change chores, so a second take would start from a changed state. See [Reset the demo](../../demo/README.md#reset-the-demo).
- A reset unpairs the tablet and signs the organizer out. Re-pair the tablet before you roll, as in DD-3 of the [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md#dd-3-demo-reset-on-the-desktop-clears-the-tablet):
  1. Open the maintenance menu: hold the household name for 3 seconds, then enter the organizer PIN.
  2. Choose `Reload app` and confirm.
  3. Tap "Organizer sign in", enter the PIN, and tap "Pair this tablet".
  4. Sign the organizer out.
- Check that the board shows The Parker Household with four name tiles and no "waiting to sync" chip.
- Run the [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md) once before the shoot day.

### Recording settings

| Setting | Value |
| --- | --- |
| Tablet viewport | 1280x800, landscape (the suite's `VIEWPORT`). Do not scale or letterbox it. |
| Screen recording | `adb shell screenrecord --size 1280x800 /sdcard/take-01.mp4`, then `adb pull` it. Frame rate: screenrecord has no frame-rate option, so the clip keeps the device's own rate; the edit timeline conforms it to 30 fps. It stops after 180 s by default, which covers a full take ([adb screenrecord](https://developer.android.com/tools/adb#screenrecord)). |
| Camera | 1920x1080 at 30 fps, with exposure and focus locked on the screen. |
| Edit timeline | 1920x1080 at 30 fps. Conform the screen capture to 30 fps. |

### Lighting

- Put a soft key light about 45 degrees off the screen axis, so the glass shows no reflection.
- Keep windows out of the frame, and out of the line opposite the screen.
- Use daylight-balanced bulbs (about 5000-5600 K), all the same colour temperature.
- Fix the tablet brightness at about 75%, with auto-brightness off.
- Hang a dark or matte backdrop behind the camera position.
- Shoot a test frame and check it for glare before take 1.

### During the take

- Record outside the Fully sleep window, 22:00-06:00 (`sleepSchedule` in [Fully Kiosk settings](../../demo/tablet/README.md#settings)).
- Connect the tablet over the Tailscale share (`demo/demo.sh share`, see [Connecting a tablet](../../demo/README.md#connecting-a-tablet)), not `adb reverse`. The offline beats need the tablet to really lose the network.
- The status bar is blocked in kiosk mode, so an off-camera operator toggles Wi-Fi with `adb shell svc wifi disable` and `adb shell svc wifi enable` over the USB cable. Rehearse it.
- Fully's `reloadOnWifiOn` reloads the hub when Wi-Fi comes back. Expect that reload in SH9.
- Wait for Tailscale to reconnect before you expect the sync.
- Cut every PIN entry. Never show the organizer PIN or the kiosk PIN on camera, and never write either one down here.
- Fallback: the Fire runs Amazon's own WebView, and [ADR-0012](../adr/0012-hub-reference-validation-tablet.md) validates the offline epic only in Chrome. If a rehearsal on the Fire does not show the last-known board offline, record SH8 and SH9 in Chrome on a Play Store Android device, or in desktop Chrome sized to 1280x800. Note the swap in the edit.

## Sources

1. [Issue #135 - S2 - 90-second demo video script and shot list](https://github.com/jasoncavaliere/the-butler-did-it/issues/135)
2. [Issue #121 - P12 - Browser test of the full demo path against the local stack](https://github.com/jasoncavaliere/the-butler-did-it/issues/121)
3. [The demo-path Playwright suite (nine test steps)](../../demo/e2e/tests/demo-path.spec.ts)
4. [Demo-path suite helpers - VIEWPORT, MEMBERS, HOUSEHOLD_NAME](../../demo/e2e/hub.ts)
5. [Butler demo stack README - Reset the demo, Verify the demo, Connecting a tablet](../../demo/README.md)
6. [ADR-0001 - Brand mood and voice](../adr/0001-brand-mood-and-voice.md)
7. [ADR-0012 - Hub demo device and offline-epic validation runtime](../adr/0012-hub-reference-validation-tablet.md)
8. [Fully Kiosk settings for the hub tablet](../../demo/tablet/README.md)
9. [Android Debug Bridge - Record a video (screenrecord)](https://developer.android.com/tools/adb#screenrecord)

## Related

- [Product Vision](10-product-vision.md) - the v1 scope this video shows, and nothing beyond it.
- [Customer Interview Guide](13-customer-interview-guide.md) - the questions to ask after a prospect has seen the demo or this video.
- [Pilot One-Pager](16-pilot-one-pager.md) - the pilot offer this video's end card points to.
- [On-Device Acceptance Checklist](41-on-device-acceptance-checklist.md) - the checks to run on the tablet before the shoot day.
