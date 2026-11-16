---
type: Runbook
title: Hub Tablet Kiosk Setup
description: "How to turn a tablet into the Butler hub, step by step: stock Android with Fully Kiosk EMM as device owner, a reclaimed Fire tablet, or an iPad with Guided Access, plus connecting it to the demo desktop, keeping it awake, capping its charge, and getting back out."
tags: [hub, tablet, kiosk, device owner, fully kiosk, fire tablet, guided access, runbook]
category: Operations
lifecycle: Living
owner: agent-managed
related: [11-hub-hardware-findings, 17-byo-tablet-setup-guidance]
sources:
  - { id: issue-127, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/127, title: Runbook - hub tablet kiosk setup }
  - { id: hub-hardware-findings, resource: 11-hub-hardware-findings.md, title: Hub Hardware Findings - F1, F2, F3, F5 and F6 }
  - { id: byo-tablet-setup-guidance, resource: 17-byo-tablet-setup-guidance.md, title: BYO-Tablet Setup Guidance - power, battery and lockdown }
  - { id: demo-readme, resource: ../../demo/README.md, title: Butler demo stack README - Connecting a tablet and Organizer PIN }
  - { id: demo-tablet-readme, resource: ../../demo/tablet/README.md, title: Fully Kiosk settings for the hub tablet }
  - { id: fully-faq-fire, resource: https://www.fully-kiosk.com/docs/en/faq/fire, title: Fully Kiosk - Fire tablet FAQ }
  - { id: fully-device-provisioning, resource: https://www.fully-kiosk.com/docs/en/management/device-provisioning, title: Fully Kiosk - Device provisioning }
  - { id: fully-device-owner, resource: https://www.fully-kiosk.com/docs/en/configuration/device-owner, title: Fully Kiosk - Device Owner Settings }
  - { id: fully-faq-exit, resource: https://www.fully-kiosk.com/docs/en/faq/exit, title: Fully Kiosk - How to exit kiosk mode }
  - { id: fully-kiosk-mode, resource: https://www.fully-kiosk.com/docs/en/features/kiosk-mode, title: Fully Kiosk - Kiosk Mode }
  - { id: fully-downloads, resource: https://www.fully-kiosk.com/docs/en/getting-started/downloads, title: Fully Kiosk - Downloads (Regular and EMM editions) }
  - { id: fully-plus-license, resource: https://www.fully-kiosk.com/docs/en/legal/fully-plus-license, title: Fully Kiosk - Fully PLUS License }
  - { id: apple-guided-access, resource: https://support.apple.com/en-us/111795, title: Apple - Use Guided Access on iPhone and iPad }
  - { id: samsung-protect-battery-in, resource: https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones, title: Samsung - Protect battery feature (India support) }
  - { id: samsung-battery-protection-us, resource: https://www.samsung.com/us/support/troubleshoot/TSG10013504/, title: Samsung - Battery protection on Galaxy phones and tablets (US support) }
  - { id: lenovo-tab-m11-guide, resource: https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf, title: Lenovo Tab M11 User Guide - Battery section }
  - { id: spicehometech-fire, resource: https://spicehometech.com/how-to/setup-install/fire-tablet-home-assistant-kiosk/, title: Fire tablet HA kiosk walkthrough (SpiceHomeTech) }
  - { id: xda-fire-unlock, resource: https://xdaforums.com/t/unlock-fire-tablet-8-hd-10th-generation-bootloader-is-it-possible.4653382/, title: Fire tablet bootloader unlock status (XDA) }
  - { id: whalesdev-lineageos, resource: https://whalesdev.com/best-tablets-for-lineageos/, title: Tablets with LineageOS support 2026 (WhalesDev) }
  - { id: lineageos-devices, resource: https://wiki.lineageos.org/devices/, title: LineageOS - Devices wiki }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-16T16:59:27Z }
---

# Hub Tablet Kiosk Setup

> - **Who it's for:** Whoever prepares a tablet for a demo or pilot
> - **Use this when:** You have a tablet that no account has touched yet
> - **You'll end with:** A tablet locked to Butler in kiosk mode

Lock a tablet to Butler before any account touches it: Fully Kiosk EMM as device owner on stock Android, Fully's Fire method on a Fire tablet, or Guided Access on an iPad. This runbook turns a tablet into the Butler [hub](90-glossary.md#the-hub) for a demo or a pilot. It was written for [issue #127](https://github.com/jasoncavaliere/the-butler-did-it/issues/127) from findings F3, F5 and F6 in the [Hub Hardware Findings](11-hub-hardware-findings.md). The family-facing summary of the same lockdown is the [BYO-Tablet Setup Guidance](17-byo-tablet-setup-guidance.md#locking-it-down). **These steps have not been run on a device yet**: the on-device checklist is [#132](https://github.com/jasoncavaliere/the-butler-did-it/issues/132), and the reference device is decided in [#163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163). The Fully docs cited below were re-read on 2026-11-16.

## Pick a path

| Path | Device | How strong the lockdown is | What you need |
| --- | --- | --- | --- |
| [Stock Android](#stock-android-path) | Any mainstream Android tablet, such as the Lenovo Tab M11 or Galaxy Tab A9+ | Strongest. Device owner lets Fully use its Lock Task Mode, which turns off the home and recents buttons. | A computer with `adb`, the Fully EMM APK, a Fully PLUS license |
| [Fire tablet](#fire-tablet-path) | A reclaimed Amazon Fire tablet, including a Fire Kids tablet | Weaker. Fully locks the tablet through an Accessibility service, plus a Home app swap on older Fire OS. | A computer with `adb`, the Fully EMM APK, a Fully PLUS license |
| [iPad](#ipad-path) | Any iPad on a current iPadOS | Guided Access keeps the iPad in one app until someone enters a passcode. | Nothing extra |

A Fire tablet is good for checking how the board reads from across a room, but it must never be the device that signs off the offline epic, because Fire OS uses Amazon's own WebView (finding [F2](11-hub-hardware-findings.md#f2-the-offline-epic-makes-the-browser-engine-a-first-class-requirement) and [F3](11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target)).

## Before you start

- The demo stack is running on the desktop (`demo/demo.sh up`, see the [demo README](../../demo/README.md)).
- Android platform-tools (`adb`) are installed on the desktop, for the Android and Fire paths.
- You have the **EMM edition** of Fully Kiosk Browser, package `com.fullykiosk.emm`, from [Fully's downloads page](https://www.fully-kiosk.com/docs/en/getting-started/downloads), not the Play Store build.
- You have one Fully PLUS license for each tablet. Kiosk mode and Device Owner Settings are PLUS features ([Kiosk Mode](https://www.fully-kiosk.com/docs/en/features/kiosk-mode), [Device Owner Settings](https://www.fully-kiosk.com/docs/en/configuration/device-owner)). Without a license, PLUS features run only as a free trial, with a watermark and reminders on screen. A single license is bound to one tablet's device ID, and activating it needs an internet connection once, after which the tablet can stay offline ([Fully PLUS License](https://www.fully-kiosk.com/docs/en/legal/fully-plus-license)).
- You have picked a kiosk PIN, which must differ from the organizer PIN in `demo/.env`.
- You know which connection you will use (next section).

## Connecting the tablet

The hub is an offline-first PWA, and its service worker only registers over HTTPS or on `http://localhost`. **Never use `http://<lan-ip>:8080`**: the page loads there, but the hub stops working the moment the tablet goes offline. The full steps are in [Connecting a tablet](../../demo/README.md#connecting-a-tablet) in the demo README (#101). Pick one option:

| Option | How | Works on |
| --- | --- | --- |
| **Tailscale (default)** | Run `demo/demo.sh share`. It runs `tailscale serve --bg 8080` and prints `https://<host>.<tailnet>.ts.net` and a QR code. You need Tailscale 1.52 or later on both devices, MagicDNS and HTTPS Certificates on, and both devices on the same tailnet. It uses `serve`, not `funnel`, so only your tailnet can reach it. Run `demo/demo.sh unshare` when you are done. See [Tailscale (default)](../../demo/README.md#tailscale-default). | Android, Fire, iPad |
| **Local CA (fallback)** | Serve the hub at `https://<lan-ip>:8443` with a certificate from mkcert or Caddy's internal CA, and install the root certificate on the tablet. Since Android 7, apps ignore user-installed CAs unless they opt in, so Fully may reject it. Prefer Tailscale. See [Local CA (manual fallback)](../../demo/README.md#local-ca-manual-fallback). | Android, iPad |
| **adb reverse (fallback)** | With the tablet on a USB cable, run `adb reverse tcp:8080 tcp:8080` and open `http://localhost:8080`. The mapping drops when the cable or adb disconnects. Remove it with `adb reverse --remove tcp:8080`. See [adb reverse (Android, USB)](../../demo/README.md#adb-reverse-android-usb). | Android, Fire |

**Ordering trap on the stock Android path:** installing Tailscale from the Play Store adds a Google account. Do it only after the device-owner step (step 6 below).

## Stock Android path

> **The one-shot device-owner trap.** The `dpm set-device-owner` command fails if **any** account is on the tablet: Google, Samsung, or any other. Once an account exists, the only way to retry is a **factory reset**. So add no account until step 6 has printed `Success`. That includes the Play Store, a Samsung account, and Tailscale from the Play Store (finding [F5](11-hub-hardware-findings.md#f5-the-mechanism-device-owner-kiosk-mode)).

1. If the tablet has been used, factory reset it.
2. Run setup on Wi-Fi only, and skip every account sign-in.
3. Open Settings > About tablet and tap Build number until Developer options turn on. In Developer options, turn on USB debugging, then plug the tablet into the desktop and accept the debugging prompt. `adb devices` should list the tablet as `device`.
4. Install the EMM APK: `adb install <path-to-the-fully-emm-apk>`. On Android 13 or later, Android may block some of Fully's settings as restricted, and if so, open App info for Fully, tap the three-dot menu, and choose Allow restricted settings ([Fully downloads page](https://www.fully-kiosk.com/docs/en/getting-started/downloads)).
5. Confirm the receiver class in the installed APK:

   ```bash
   adb shell dumpsys package com.fullykiosk.emm | grep -i DeviceOwnerReceiver
   ```

   It should print a line that contains `de.ozerov.fully.DeviceOwnerReceiver`.
6. Make Fully the device owner:

   ```bash
   adb shell dpm set-device-owner com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver
   ```

   Expect a line that starts with `Success: Device owner set to package ...`. The package name `com.fullykiosk.emm` is from [Fully's Fire FAQ](https://www.fully-kiosk.com/docs/en/faq/fire). The ADB (manual) method is from [Fully's device provisioning page](https://www.fully-kiosk.com/docs/en/management/device-provisioning), which says provisioning is free with a PLUS license. Fully's docs do not print this exact line. The receiver class appears in their [exit FAQ](https://www.fully-kiosk.com/docs/en/faq/exit) `dpm remove-active-admin` command, and step 5 confirms it on your APK.
7. Open Fully, grant the permissions it asks for, and activate the PLUS license.
8. Connect the tablet (see [Connecting the tablet](#connecting-the-tablet)), installing Tailscale now if you use it.
9. Import the hub settings file, `demo/tablet/fully-settings.json`, as described in [Importing the settings](../../demo/tablet/README.md#importing-the-settings). It sets the start URL, the kiosk PIN, launch on boot, keep screen on, and the overnight sleep.
10. Turn on kiosk mode, and when Fully asks, set it as the default Home app ([Kiosk Mode](https://www.fully-kiosk.com/docs/en/features/kiosk-mode)). Then open Fully's Device Owner Settings and turn on Enable Lock Task Mode, which turns off the home and recents buttons in kiosk mode ([Device Owner Settings](https://www.fully-kiosk.com/docs/en/configuration/device-owner)). The settings file has no key for Lock Task Mode, so this is a manual step.
11. Restart the tablet: it should open on Butler with no swipe, and the home and recents buttons should do nothing. Then pair the hub: tap "Pair this tablet" after the organizer signs in (see [Organizer PIN](../../demo/README.md#organizer-pin)).
12. Optional: add a Google account now if you want Play Store updates for Chrome and WebView.

The provisioning script in [#128](https://github.com/jasoncavaliere/the-butler-did-it/issues/128) will automate steps 3 to 10 once it lands.

## Fire tablet path

Fully's provisioning page says Fire OS devices do not support device provisioning, and its Fire FAQ says that if you try, use the ADB method before adding an Amazon account. So this path relies on Fully's kiosk mode and its Accessibility service, with device owner as an optional first try in step 6. A Fire OS update can undo some of these changes, so check the tablet after each update ([Fully's Fire FAQ](https://www.fully-kiosk.com/docs/en/faq/fire)).

1. Deregister the Kids profile from the tablet ([SpiceHomeTech walkthrough](https://spicehometech.com/how-to/setup-install/fire-tablet-home-assistant-kiosk/), finding [F3](11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target)).
2. Factory reset it and set it up as an adult device. To try step 6, skip the Amazon account sign-in if setup lets you, and add the account after step 6.
3. Open Settings > Device Options > About Fire Tablet and tap Serial Number until developer mode turns on. In Developer Options, turn on USB Debugging, then plug the tablet into the desktop, accept the prompt, and check `adb devices`.
4. Turn off the Amazon apps you do not need with `adb shell pm disable-user --user 0 <package>`. Find the names with `adb shell pm list packages | grep amazon`. Use `disable-user`, not `uninstall`, so a factory reset brings them back.
5. Install the EMM APK with `adb install <path-to-the-fully-emm-apk>`. Fully's Fire FAQ points to the regular-edition APKs, but it lists the EMM package, `com.fullykiosk.emm`, for its commands. This runbook keeps the EMM edition so one APK and one package name cover every Android and Fire tablet, and the provisioning script (`demo/tablet/provision-tablet.sh`) hard-codes the EMM package. Fully says not to install it from Google Play on a Fire tablet, and to turn off Play's auto-updates if Play is on the tablet.
6. Optional, and only if no Amazon account is on the tablet yet: run the step 5 and step 6 commands from the [Stock Android path](#stock-android-path). If the `dpm` command fails, carry on, because the steps below do not need it.
7. Open Fully, activate the PLUS license, connect the tablet, and import the settings, as in steps 7 to 9 of the Stock Android path.
8. Turn on kiosk mode, and when Fully asks, turn on its service in the Accessibility settings. Fully says this is required to secure the kiosk on Fire OS.
9. On Fire OS 5, 6 or 7, pressing Home takes about 5 seconds to return to Fully. Fully's Fire FAQ gives a workaround that it does not support and that you use at your own risk: after kiosk mode is on, make Fully the Home app and turn off the Fire launcher. Fully says Fire OS 8 seems unaffected when the Accessibility service is on, so skip this step there.

   ```bash
   adb shell pm set-home-activity com.fullykiosk.emm/de.ozerov.fully.LauncherReplacement
   adb shell pm disable-user --user 0 com.amazon.firelauncher
   ```

   Fully's Fire FAQ writes `[package]` in the first command. This runbook puts the EMM package there.
10. Restart the tablet and check that it opens on Butler.

## iPad path

Guided Access keeps the iPad in one app until someone enters a passcode ([Apple: Use Guided Access](https://support.apple.com/en-us/111795)). The iPad cannot use `adb`, so connect it with Tailscale or the local CA before you start.

1. Connect the iPad (see [Connecting the tablet](#connecting-the-tablet)).
2. Open the hub URL in Safari.
3. Tap Share, then **Add to Home Screen**.
4. Go to Settings > Accessibility > **Guided Access**, turn it on, and set a passcode.
5. Set Auto-Lock to Never (see [Keeping it awake](#keeping-it-awake)).
6. Open Butler from the Home Screen. Triple-click the top button (or the Home button, on an iPad that has one) to start Guided Access.
7. To end it, triple-click the top button (or the Home button) again and enter the passcode.

## Keeping it awake

- **Android and Fire:** the settings file turns on Fully's keep screen on and sets the overnight sleep from 22:00 to 06:00 (see [Settings](../../demo/tablet/README.md#settings)).
- **The hub itself** also asks the browser for a screen wake lock where the browser supports one (`Butler.UI/src/pwa/useScreenWakeLock.ts`, #109).
- **iPad:** go to Settings > Display & Brightness > Auto-Lock and choose Never.

## Battery charge cap

The hub stays on its charger all day. A tablet held at 100% on a charger 24/7 often swells its battery in about 12-18 months, and a swollen battery can push the screen off its mount (finding [F6](11-hub-hardware-findings.md#f6-operational-finding-the-battery-is-the-thing-that-kills-wall-tablets)). Turn on a charge cap before you mount the tablet:

- **Samsung:** Settings > Battery > **Protect battery** stops charging at 85%. Newer One UI calls it Battery protection and stops at 80% or a level you pick ([Samsung India support](https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones), [Samsung US support](https://www.samsung.com/us/support/troubleshoot/TSG10013504/)).
- **Lenovo Tab M11:** Settings > Battery > Charge optimization > **Charging protection** holds the battery between 40% and 60% ([Lenovo Tab M11 User Guide](https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf)).
- **iPad and other tablets:** see [Power and battery](17-byo-tablet-setup-guidance.md#power-and-battery) for the iPad 80% Limit and the models that have it.
- **A Fire tablet, or any tablet with no cap:** use a smart plug on a schedule, as in [No charge cap: use a smart plug](17-byo-tablet-setup-guidance.md#no-charge-cap-use-a-smart-plug).

## Recovery

Work down this list, because each step is heavier than the one before it.

### Exit kiosk mode with the PIN

1. Swipe in from the left edge of the screen, holding at the edge for a moment first if the tablet uses gesture navigation.
2. Enter the kiosk PIN, or Fully's default of 1234 if no PIN was ever set ([Fully exit FAQ](https://www.fully-kiosk.com/docs/en/faq/exit)).
3. If the PIN is lost, Fully's exit FAQ lists these escapes, and each one has a condition:
   - **Remote Admin or Fully Cloud** can change the PIN or turn kiosk mode off, but only if Remote Admin is on. The hub settings file turns it off (`"remoteAdmin": false` in `demo/tablet/fully-settings.json`), so this escape is closed unless you turned it on.
   - **A `fully-once-settings.json` file** that turns kiosk mode off, copied over USB to `/sdcard`, then a restart. This works only if Fully was installed from an APK, All Files Access was granted, and Settings Auto-Import in Other Settings was left on.
   - **Safe mode**, then uninstall Fully. This works only if safe mode was never locked, in Fully's Kiosk Mode settings, its Device Owner Settings, or KNOX.
   - **Uninstall Fully over `adb`**, as in [Remove device owner](#remove-device-owner).
   - Otherwise, a [factory reset](#factory-reset) is the only way back.
4. On a Fire tablet where you ran step 9 of the Fire path, after you turn kiosk mode off, give the Fire launcher back ([Fully's Fire FAQ](https://www.fully-kiosk.com/docs/en/faq/fire)):

   ```bash
   adb shell pm enable --user 0 com.amazon.firelauncher
   adb shell pm set-home-activity com.amazon.firelauncher/.Launcher
   ```

5. On an iPad, triple-click the top button (or the Home button) and enter the Guided Access passcode.

### Remove device owner

- **In Fully:** open Device Owner Settings and choose Remove Device Owner. Fully marks it EXPERIMENTAL ([Device Owner Settings](https://www.fully-kiosk.com/docs/en/configuration/device-owner)).
- **Over adb**, per [Fully's exit FAQ](https://www.fully-kiosk.com/docs/en/faq/exit), with the EMM package in place of `[package]`:

  ```bash
  adb shell dpm remove-active-admin com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver
  adb uninstall com.fullykiosk.emm
  ```

- If Android refuses the adb removal, use the in-app option or a factory reset.

### Factory reset

A factory reset is the last resort, and it is also the only way to retry the device-owner step. The Settings path varies by vendor. If a Google account was on the tablet, Android's Factory Reset Protection asks for that account after the reset, so have its password ready.

## Appendix: LineageOS (optional, not for v1)

**Optional, and not recommended for v1.** Skip this appendix unless de-Googling the tablet is itself the goal.

Why it is not for v1:

- **It is the wrong layer.** Butler is a PWA, so booting into it is a launcher and lock-task problem, not an OS problem, and a flashed ROM proves a setup no customer runs (finding [F1](11-hub-hardware-findings.md#f1-flashing-a-custom-os-is-the-wrong-layer-for-v1)).
- **Fire tablets cannot do it.** No bootloader unlock exists for 2020-or-newer Fire tablets ([XDA](https://xdaforums.com/t/unlock-fire-tablet-8-hd-10th-generation-bootloader-is-it-possible.4653382/), finding [F3](11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target)).
- **It needs a maintained build for the exact model.** Samsung Snapdragon US variants are often locked outright, and you then own the OS updates for the kitchen wall ([WhalesDev](https://whalesdev.com/best-tablets-for-lineageos/), F5 Path B in the [Hub Hardware Findings](11-hub-hardware-findings.md#f5-the-mechanism-device-owner-kiosk-mode)).
- **The offline epic needs a current Chromium** to give honest results (finding [F2](11-hub-hardware-findings.md#f2-the-offline-epic-makes-the-browser-engine-a-first-class-requirement)).

If you still want it, find the exact model on the [LineageOS devices wiki](https://wiki.lineageos.org/devices/) and follow that device's own install guide. Unlocking the bootloader wipes the tablet, so do it before anything else, then come back to the [Stock Android path](#stock-android-path) for device owner and Fully.

## What this runbook does not cover

- The provisioning script that automates the Android steps ([#128](https://github.com/jasoncavaliere/the-butler-did-it/issues/128)).
- Running these steps on a real tablet and recording the results ([#132](https://github.com/jasoncavaliere/the-butler-did-it/issues/132)).
- The reference-device decision and its ADR ([#163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163)).
- A native Android shell (finding [F7](11-hub-hardware-findings.md#f7-adjacent-option-a-real-android-apk), deferred).

## Sources

1. [Issue #127 - Runbook: hub tablet kiosk setup](https://github.com/jasoncavaliere/the-butler-did-it/issues/127)
2. [Hub Hardware Findings - F1, F2, F3, F5 and F6](11-hub-hardware-findings.md)
3. [BYO-Tablet Setup Guidance - power, battery and lockdown](17-byo-tablet-setup-guidance.md)
4. [Butler demo stack README - Connecting a tablet and Organizer PIN](../../demo/README.md)
5. [Fully Kiosk settings for the hub tablet](../../demo/tablet/README.md)
6. [Fully Kiosk - Fire tablet FAQ](https://www.fully-kiosk.com/docs/en/faq/fire)
7. [Fully Kiosk - Device provisioning](https://www.fully-kiosk.com/docs/en/management/device-provisioning)
8. [Fully Kiosk - Device Owner Settings](https://www.fully-kiosk.com/docs/en/configuration/device-owner)
9. [Fully Kiosk - How to exit kiosk mode](https://www.fully-kiosk.com/docs/en/faq/exit)
10. [Fully Kiosk - Kiosk Mode](https://www.fully-kiosk.com/docs/en/features/kiosk-mode)
11. [Fully Kiosk - Downloads (Regular and EMM editions)](https://www.fully-kiosk.com/docs/en/getting-started/downloads)
12. [Fully Kiosk - Fully PLUS License](https://www.fully-kiosk.com/docs/en/legal/fully-plus-license)
13. [Apple - Use Guided Access on iPhone and iPad](https://support.apple.com/en-us/111795)
14. [Samsung - Protect battery feature (India support)](https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones)
15. [Samsung - Battery protection on Galaxy phones and tablets (US support)](https://www.samsung.com/us/support/troubleshoot/TSG10013504/)
16. [Lenovo Tab M11 User Guide - Battery section](https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf)
17. [Fire tablet HA kiosk walkthrough (SpiceHomeTech)](https://spicehometech.com/how-to/setup-install/fire-tablet-home-assistant-kiosk/)
18. [Fire tablet bootloader unlock status (XDA)](https://xdaforums.com/t/unlock-fire-tablet-8-hd-10th-generation-bootloader-is-it-possible.4653382/)
19. [Tablets with LineageOS support 2026 (WhalesDev)](https://whalesdev.com/best-tablets-for-lineageos/)
20. [LineageOS - Devices wiki](https://wiki.lineageos.org/devices/)

## Related

- [Hub Hardware Findings](11-hub-hardware-findings.md) - the research (F1, F2, F3, F5, F6) this runbook turns into steps.
- [BYO-Tablet Setup Guidance](17-byo-tablet-setup-guidance.md) - the family-facing version: choosing, powering, mounting, and locking down a tablet.
