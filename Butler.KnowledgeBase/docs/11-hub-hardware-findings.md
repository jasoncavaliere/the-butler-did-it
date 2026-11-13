---
type: Research Note
title: Hub Hardware Findings - Tablet and Kiosk Boot
description: "Research findings (2026-08-13, not a ratified decision) on which tablet the hub runs on and how it boots into Butler: a stock Android tablet in device-owner kiosk mode, not a custom OS."
tags: [hub, hardware, tablet, kiosk, device owner, byo-tablet, offline, research]
category: Product & Strategy
lifecycle: Record
owner: agent-managed
related: [10-product-vision]
sources:
  - { id: issue-83, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/83, title: Spike - hub tablet and kiosk boot findings }
  - { id: xda-fire-unlock, resource: https://xdaforums.com/t/unlock-fire-tablet-8-hd-10th-generation-bootloader-is-it-possible.4653382/, title: Fire tablet bootloader unlock status (XDA) }
  - { id: aftvnews-vega, resource: https://www.aftvnews.com/amazon-confirms-all-future-fire-tv-sticks-will-run-vega-os-no-more-android-or-sideloading-on-new-models/, title: Amazon confirms Vega OS ends Android sideloading (AFTVnews) }
  - { id: homeshift-tablets, resource: https://joinhomeshift.com/home-assistant-tablet, title: Best wall tablets for HA dashboards 2026 (HomeShift) }
  - { id: ha-fully-kiosk, resource: https://www.home-assistant.io/integrations/fully_kiosk/, title: Fully Kiosk Browser integration (Home Assistant) }
  - { id: spicehometech-fire, resource: https://spicehometech.com/how-to/setup-install/fire-tablet-home-assistant-kiosk/, title: Fire tablet HA kiosk walkthrough }
  - { id: whalesdev-lineageos, resource: https://whalesdev.com/best-tablets-for-lineageos/, title: Tablets with LineageOS support 2026 (WhalesDev) }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T21:49:47Z }
---

# Hub Hardware Findings - Tablet and Kiosk Boot

> **In one line:** Butler v1 does not need a flashed or custom OS - it needs a mainstream Android tablet running a current Chromium, locked into Android device-owner kiosk mode and pointed at the Static Web App URL.

These findings were gathered on **2026-08-13** for [issue #83](https://github.com/jasoncavaliere/the-butler-did-it/issues/83) [7]. They are **research, not a ratified decision**: the reference device is ratified by its own ADR in [#163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163), not here. Hardware availability, pricing, and unlock or ROM status all drift, so **re-verify F3 and F4 before purchasing**. This note is a Record: when the findings change, supersede it with a new dated note rather than editing it. Everything below is consistent with the vision's [shared hub](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app) and its [BYO-tablet](90-glossary.md#byo-tablet) hardware decision; if anything, it reinforces them.

## Why this came up

The vision's hardware decision is BYO-tablet: Butler "ships as a web app and installable PWA that runs on any Android tablet or iPad a family already owns (roughly $100 to $150 if they buy one)" (see "Hardware and offline decision (v1)" under [The product: a shared hub, not a phone app](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app)). The v1 [hub](90-glossary.md#the-hub) is the Expo web export deployed as an Azure Static Web App and installed as a PWA ([Epic 60 - Offline PWA](../brd/60-epic-offline-pwa.md)).

The original framing was "find a cheap tablet, flash the OS, boot into the app." The investigation says that framing solves the wrong layer.

## Findings

### F1. Flashing a custom OS is the wrong layer for v1

Butler is a PWA. "Boot into my application" on Android is a **launcher + lock-task-mode** problem, not an OS-image problem. Replacing the OS with LineageOS buys a de-Googled device and nothing else that matters to Butler [6].

It also has a real product cost: **a flashed niche ROM validates a configuration zero customers will run.** The vision's whole hardware bet is BYO - the hub has to be proven on the stock device a family already owns.

### F2. The offline epic makes the browser engine a first-class requirement

The offline epic tickets #31, #32, #33 and #34 ([O1](../brd/tickets/O1-pwa-manifest-service-worker-and-installability.md), [O2](../brd/tickets/O2-last-known-week-cache-glanceable-offline.md), [O3](../brd/tickets/O3-local-write-queue-sync-on-reconnect.md), [O4](../brd/tickets/O4-offline-status-ui-indicator-queued-writes.md)) ride on **service workers, browser install criteria, and browser storage**. Those are browser-engine behaviours, not app behaviours. Validating them on an old or forked Chromium produces misleading results in both directions - a false pass and a false fail are equally likely.

This is the single strongest constraint on hardware choice, and it is why the Fire tablet (F3) cannot be the sign-off device.

### F3. The spare Fire Kids tablet: usable as a prop, not as a target

Two independent findings:

1. **No bootloader unlock exists for 2020-or-newer Fire tablets.** Unlock, TWRP, and custom-ROM paths exist only for older Fire 7 generations. For a Fire HD 8 (10th gen) / HD 10 (11th gen) or later, custom ROMs are *unavailable*, not merely difficult [1].
2. **Amazon is leaving Android.** Vega OS (Linux-based, no Android framework, **no sideloading at all**) already ships on 2026 Fire TV hardware and is confirmed for all future Fire TV Sticks [2]. Tablets are not converted yet, but the direction is set - Fire is not a platform to build a hardware plan on.

**Reclaiming it needs no flashing** (about 30 minutes) [5]:

- Deregister the Kids profile -> factory reset -> set up as an adult device -> enable USB debugging.
- Run `adb shell pm disable-user --user 0 <pkg>` over the Amazon bloat (`disable-user`, not `uninstall`, so a factory reset recovers it).
- Sideload the Fully Kiosk Browser APK (Fire OS permits unknown sources) -> point it at the SWA URL -> enable kiosk + launch-on-boot.

**Hard caveat:** Fire OS 8 is Android 11 with Amazon's own forked WebView. Per F2, a Fire tablet must **never** be the device that signs off #31-#34 - a service-worker or install-criteria result there describes Amazon's WebView, not Butler. It is good for exactly one thing: answering *"does the board read well from across the kitchen"* (which feeds #42's glanceability decisions and the #16 [hub shell](../brd/tickets/T2-hub-shell-and-always-on-today-layout.md)).

### F4. Recommended purchase: Lenovo Tab M11 (~$150) or Samsung Galaxy Tab A9+ (~$180)

Both are the Home Assistant community's reference wall-panel picks [3] - the closest existing analogue to Butler's deployment shape (always-on, wall-mounted, kiosked web dashboard, family-accessible). Selection criteria, mapped to Butler:

| Requirement | Why it matters for Butler |
| --- | --- |
| **LCD, not OLED** | The always-on glanceable board is a static layout - OLED burn-in is the failure mode. Both are LCD. |
| **Play Store -> real Chrome** | Honest PWA install prompt, service worker, and storage behaviour for #31-#34 (see F2) |
| **Long OS support** (A9+ ~4 years) | The vision calls the hub's physical position the moat; it has to keep receiving security updates |
| **USB-C, side-mounted** | Permanent power via a right-angle cable behind a wall mount |
| **Battery charge cap** | Samsung "Protect battery" (85%), Lenovo charging protection - see F6 |
| **~$150-180** | Inside the vision's stated "$100 to $150 if they buy one" band, so the test device represents the customer |

Rough split: **A9+** for the longest support runway; **M11** for ambient auto-dim in a dim kitchen. Prices and support windows are as of 2026-08-13.

### F5. The mechanism: device-owner kiosk mode

**Path A (recommended).** Order matters - **the device-owner step fails if any account exists on the device**, and it is a one-shot command that needs a factory reset to retry [4].

1. Unbox -> run setup -> **skip the Google account entirely**. Wi-Fi only.
2. Developer Options -> USB debugging. Verify with `adb devices`.
3. **Sideload** the Fully Kiosk APK from `fully-kiosk.com`. (A Play Store install works functionally, but adding the Play account blocks step 4 - sideload first, add the account later if wanted.)
4. Promote to device owner: `adb shell dpm set-device-owner de.ondevice.fullykiosk/.DeviceOwnerReceiver` - **confirm the exact component against Fully's current device-owner docs before running it.**
5. Fully config: start URL = the SWA URL; Kiosk Mode on with a PIN; **Launch on Boot** on; screensaver/dim schedule for overnight; auto-reload on connection recovery.
6. Set Fully as the default HOME launcher. **Device owner is what makes that stick and blocks the home/recents escape hatches** - a kids-in-the-kitchen requirement given [tap-to-claim](90-glossary.md#tap-to-claim) trusts whoever is standing at the hub (vision risk: "the hub trusts whoever is standing at it", see [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them)).
7. Verify: power-cycle -> lands on Butler with no swipe. Then pull Wi-Fi -> the last-known week still renders. That second check is #32's acceptance criterion ([O2](../brd/tickets/O2-last-known-week-cache-glanceable-offline.md)) executed on real hardware.

**Path B (flash LineageOS)** - only if de-Googling is itself the goal. It requires an *active, current* XDA maintainer thread for the exact model number (Samsung Snapdragon US variants are frequently locked outright), an unlock, a custom recovery, and a ROM sideload [6]. Cost: a weekend, plus owning the OS supply chain for the kitchen wall. **Recommendation: skip for v1.**

### F6. Operational finding: the battery is the thing that kills wall tablets

A tablet held at 100% on a charger 24/7 typically swells its battery in **12-18 months** and pops the screen off the mount (figure from the #83 research write-up [7]). This is the most common failure mode of the exact deployment Butler is designing for, and it is a **product** finding, not just a lab one - it will happen to customers who mount a BYO tablet on advice from Butler.

Mitigations: cap charging in device settings (F4), or duty-cycle the charger on a smart plug. Whether Butler's eventual setup guidance says anything about this is the question for [#166](https://github.com/jasoncavaliere/the-butler-did-it/issues/166).

### F7. Adjacent option: a real Android APK

`Butler.UI` is already Expo React Native, so `eas build --platform android` can produce a native APK. Native app + Android lock-task mode gives a true "boots into my application" with no kiosk browser in the middle.

This is a **genuine option the stack already supports**, but it is a scope expansion past the web-first v1 line in `CLAUDE.md` (see [What we are NOT building in v1](10-product-vision.md#what-we-are-not-building-in-v1)), and it would not change the hardware choice. Recorded here so it is not rediscovered later; **not proposed for v1.**

Status: deferred - not proposed for v1; no issue filed.

## What this note does not do

- It does not ratify a decision or write an ADR. The reference-device ADR is [#163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163).
- It does not buy hardware or change any product code.
- It does not amend the vision's BYO-tablet decision (F1-F7 are consistent with it; if anything they reinforce it).

## Follow-up spikes

These were written from the findings above and are tracked as their own issues:

- [#163 Hub reference-device decision + ADR](https://github.com/jasoncavaliere/the-butler-did-it/issues/163) - ratify a reference validation device (F4) and record it, so #31-#34 and #16 have a named hardware target instead of "a tablet."
- [#164 Kiosk provisioning runbook](https://github.com/jasoncavaliere/the-butler-did-it/issues/164) - turn F5 into a repeatable, tested runbook (kiosk app choice included; Fully is the reference but not the only option), covering the one-shot device-owner ordering trap.
- [#165 Offline epic validation on real hardware](https://github.com/jasoncavaliere/the-butler-did-it/issues/165) - a hardware acceptance pass for #31-#34 on the reference device, since F2 says the emulator or desktop-Chrome result is not sufficient evidence.
- [#166 BYO-tablet setup guidance for families](https://github.com/jasoncavaliere/the-butler-did-it/issues/166) - what Butler tells a customer about mounting, charging (F6), and locking down the tablet they already own. Product surface, not just internal ops.
- **Native Android shell (F7): deferred.** Parked as an explicit deferred option; no issue is filed. Revisit only if the web-first v1 line in the vision changes.

## Sources

1. [Fire tablet bootloader unlock status (XDA)](https://xdaforums.com/t/unlock-fire-tablet-8-hd-10th-generation-bootloader-is-it-possible.4653382/)
2. [Amazon confirms Vega OS ends Android sideloading (AFTVnews)](https://www.aftvnews.com/amazon-confirms-all-future-fire-tv-sticks-will-run-vega-os-no-more-android-or-sideloading-on-new-models/)
3. [Best wall tablets for HA dashboards 2026 (HomeShift)](https://joinhomeshift.com/home-assistant-tablet)
4. [Fully Kiosk Browser integration (Home Assistant)](https://www.home-assistant.io/integrations/fully_kiosk/)
5. [Fire tablet HA kiosk walkthrough (SpiceHomeTech)](https://spicehometech.com/how-to/setup-install/fire-tablet-home-assistant-kiosk/)
6. [Tablets with LineageOS support 2026 (WhalesDev)](https://whalesdev.com/best-tablets-for-lineageos/)
7. [Issue #83 - hub tablet and kiosk boot research findings, 2026-08-13](https://github.com/jasoncavaliere/the-butler-did-it/issues/83)

## Related

- [Product Vision](10-product-vision.md) - the BYO-tablet hardware and offline decision these findings test and reinforce.
