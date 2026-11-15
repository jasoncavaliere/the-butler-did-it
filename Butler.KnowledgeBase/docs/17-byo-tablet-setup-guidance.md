---
type: Guide
title: BYO-Tablet Setup Guidance
description: "How a family sets up the tablet it already owns as the Butler hub: choosing one, keeping its battery healthy on permanent power, mounting it, and locking it down (strongly recommended, with iPad Guided Access as the lighter path)."
tags: [byo-tablet, hub, tablet, battery, charge cap, mounting, kiosk, guided access]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 11-hub-hardware-findings, 40-hub-tablet-kiosk-setup]
sources:
  - { id: issue-166, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/166, title: Spike - BYO-tablet setup guidance for families }
  - { id: hub-hardware-findings, resource: 11-hub-hardware-findings.md, title: Hub Hardware Findings - F4, F5 and F6 }
  - { id: samsung-protect-battery-in, resource: https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones, title: Samsung - Protect battery feature (India support) }
  - { id: samsung-battery-protection-us, resource: https://www.samsung.com/us/support/troubleshoot/TSG10013504/, title: Samsung - Battery protection on Galaxy phones and tablets (US support) }
  - { id: lenovo-tab-m11-guide, resource: https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf, title: Lenovo Tab M11 User Guide - Battery section }
  - { id: apple-ipad-charge-limit, resource: https://support.apple.com/en-us/118418, title: Apple - About the 80% Limit on iPad }
  - { id: apple-guided-access, resource: https://support.apple.com/en-us/111795, title: Apple - Use Guided Access on iPhone and iPad }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-15T09:44:48Z }
---

# BYO-Tablet Setup Guidance

> **In one line:** Pick an LCD tablet with a side USB-C port, cap its charging, mount it where the family walks past, and lock it to Butler.

Butler runs on a tablet your family already owns (the [BYO-tablet](90-glossary.md#byo-tablet) decision). This guide says how to set that tablet up as the [hub](90-glossary.md#the-hub). It was written for [issue #247](https://github.com/jasoncavaliere/the-butler-did-it/issues/247), from the decision in [issue #166](https://github.com/jasoncavaliere/the-butler-did-it/issues/166) and the research in the [Hub Hardware Findings](11-hub-hardware-findings.md). The step-by-step kiosk runbook is the [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md).

## Choosing a tablet

Most tablets work. These traits matter most for a screen that stays on all day on a wall. They come from finding F4 in the [Hub Hardware Findings](11-hub-hardware-findings.md#f4-recommended-purchase-lenovo-tab-m11-150-or-samsung-galaxy-tab-a9-180).

| Look for | Why it matters |
| --- | --- |
| **An LCD screen, not OLED** | The hub shows the same layout all day. A static layout burns into an OLED screen over time. LCD does not have that problem. |
| **A USB-C port on the side or a corner** | The tablet stays on power all the time. A side or corner port lets a right-angle cable plug in beside the mount, so the cable does not block the mount or bend hard. |
| **A current browser** | On Android, the real Chrome from the Play Store. On iPad, an up-to-date iPadOS. Butler's offline mode relies on the browser. |
| **Long OS support** | The hub stays on the wall for years, so it needs security updates for years. |
| **A battery charge cap** | A setting that stops charging before 100%. See [Power and battery](#power-and-battery). |

If you are buying one, the research named the Lenovo Tab M11 and the Samsung Galaxy Tab A9+ as good fits. Both have LCD screens. That was as of 2026-08-13, so check prices and support windows before you buy.

## Power and battery

The hub is plugged in all the time. That is hard on a battery. A tablet held at 100% on a charger 24/7 often swells its battery in about **12-18 months**. A swollen battery can push the screen off its mount. This is the most common way wall tablets fail (finding [F6](11-hub-hardware-findings.md#f6-operational-finding-the-battery-is-the-thing-that-kills-wall-tablets)).

The fix is to stop the battery from sitting at 100%. Turn on a charge cap if your tablet has one.

| Tablet | Setting | Where to find it | What it does | Source |
| --- | --- | --- | --- | --- |
| **Samsung Galaxy** | Protect battery (called Battery protection on newer One UI) | Settings > Battery > Protect battery | Stops charging at 85%. Newer One UI versions stop at 80% or at a level you pick. | [Samsung Protect battery (India support)](https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones), [Samsung Battery protection (US support)](https://www.samsung.com/us/support/troubleshoot/TSG10013504/) |
| **Lenovo Tab M11** | Charging protection | Settings > Battery > Charge optimization > Charging protection | Holds the battery between 40% and 60%. | [Lenovo Tab M11 User Guide, Battery section](https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf) |
| **iPad (some models)** | 80% Limit | Settings > Battery > Battery Health | Stops charging at 80%. The iPad may still charge to 100% now and then. | [Apple: About the 80% Limit on iPad](https://support.apple.com/en-us/118418) |

The iPad 80% Limit is only on these models: iPad Pro (M4) and later, iPad Air (M2) and later, iPad mini (A17 Pro), and iPad (A16). **Other iPads have no charge cap you can set.** For those, and for any other tablet without a cap, use a smart plug.

### No charge cap: use a smart plug

Plug the charger into a smart plug and set a schedule. The plug turns the charger on for part of the day and off for the rest. The tablet runs on its battery while the plug is off, so it does not sit at 100% all day.

Watch the battery level for the first week and adjust the schedule. You want the battery to never sit full for long, and never run out.

## Mounting

Put the hub in a common room the whole family walks past, such as the kitchen. It should be easy to see from across the room and easy to reach to tap.

- **Wall mount.** Best for a permanent spot. Choose a mount that leaves the side or corner USB-C port free.
- **Stand.** Fine on a counter or shelf. It is easier to start with, and you can move to the wall later.

Plan the power cable before you mount anything:

- Use a right-angle USB-C cable so it sits flat against the side of the tablet.
- Run the cable behind the mount or down the back of the stand to the nearest outlet.
- Keep the cable where it cannot be pulled or tripped over.
- If you use a smart plug, put it between the charger and the outlet.

## Locking it down

The hub has no passwords for family members. Each person taps their name to use it ([tap-to-claim](90-glossary.md#tap-to-claim)). That means the hub trusts whoever is standing at it. Without lockdown, anyone at the hub can leave Butler and use the rest of the tablet: its apps, its settings, and any accounts signed in on it.

**Kiosk lockdown is strongly recommended**, because it keeps the hub on Butler, so a child or a guest cannot swipe out into the rest of the tablet. On iPad, Guided Access is the lighter path: it takes a few minutes and needs no extra app.

### Android: kiosk app plus device owner

This is the full lockdown. It is a summary of finding [F5](11-hub-hardware-findings.md#f5-the-mechanism-device-owner-kiosk-mode). The step-by-step runbook is the [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md#stock-android-path).

1. Set up the tablet with **no Google account**, on Wi-Fi only.
2. Install a kiosk browser app from the maker's website (sideload it), not from the Play Store. The Play Store adds a Google account, and that blocks step 3.
3. Turn on USB debugging in Developer Options. Then make the kiosk app the device owner, using a computer and a USB cable. This step fails if any account is on the tablet. A retry needs a factory reset, so do it in this order.
4. In the kiosk app, set the start page to the hub URL. Turn on kiosk mode with a PIN, and turn on launch on boot.
5. Turn the tablet off and on. It should open straight to Butler.

### iPad: Guided Access (the lighter path)

Guided Access keeps the iPad in one app until someone enters a passcode ([Apple: Use Guided Access](https://support.apple.com/en-us/111795)).

1. Open Butler in Safari and add it to the Home Screen.
2. Go to Settings > Accessibility > Guided Access. Turn it on and set a passcode.
3. Open Butler from the Home Screen. Triple-click the top button (or the Home button, on an iPad that has one) to start Guided Access.
4. To end it, triple-click the top button (or the Home button) again and enter the passcode.

## What this guidance does not cover

- Showing this guidance inside the app ([#248](https://github.com/jasoncavaliere/the-butler-did-it/issues/248)) or linking it from the landing page ([#249](https://github.com/jasoncavaliere/the-butler-did-it/issues/249)).
- The step-by-step kiosk setup, which is the [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) runbook.
- The reference tablet Butler tests on, which is its own decision ([#163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163)).

## Sources

1. [Issue #166 - BYO-tablet setup guidance for families (the lockdown decision)](https://github.com/jasoncavaliere/the-butler-did-it/issues/166)
2. [Hub Hardware Findings - findings F4, F5 and F6](11-hub-hardware-findings.md)
3. [Samsung - Protect battery feature (India support)](https://www.samsung.com/in/support/mobile-devices/battery-protection-feature-in-samsung-galaxy-phones)
4. [Samsung - Battery protection on Galaxy phones and tablets (US support)](https://www.samsung.com/us/support/troubleshoot/TSG10013504/)
5. [Lenovo Tab M11 User Guide - Battery section](https://download.lenovo.com/consumer/mobiles_pub/tab_m11_ug_en.pdf)
6. [Apple - About the 80% Limit on iPad](https://support.apple.com/en-us/118418)
7. [Apple - Use Guided Access on iPhone and iPad](https://support.apple.com/en-us/111795)

## Related

- [Product Vision](10-product-vision.md) - the BYO-tablet hardware decision and the tap-to-claim trust trade-off this guidance serves.
- [Hub Hardware Findings](11-hub-hardware-findings.md) - the research (F4, F5, F6) this guidance is built from.
- [Hub Tablet Kiosk Setup](40-hub-tablet-kiosk-setup.md) - the step-by-step runbook for the lockdown, connection, charge cap, and recovery.
