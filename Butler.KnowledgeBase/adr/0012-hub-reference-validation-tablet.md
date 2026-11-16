---
id: ADR-0012
title: The Fire Kids tablet is the hub demo device, and current stable Chrome validates the offline epic
type: Decision Record
description: The owner's Fire Kids tablet running Fully Kiosk is the hub's demo and glanceability device, the offline epic (#31-#34) is signed off only in current stable Chrome, and a Galaxy Tab A9+ is a recommended future purchase.
status: accepted
date: 2026-11-15
spike: "#163"
tags: [hub, hardware, tablet, offline, validation, kiosk]
supersedes: none
superseded-by: none
related: [11-hub-hardware-findings]
sources:
  - { id: hub-hardware-findings, resource: ../docs/11-hub-hardware-findings.md, title: Hub Hardware Findings - F2, F3 and F4 }
  - { id: spike-163, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/163, title: Spike issue 163 - hub demo device and Chrome validation runtime }
  - { id: issue-83, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/83, title: Spike - hub tablet and kiosk boot findings }
  - { id: chrome-android-stable, resource: "https://versionhistory.googleapis.com/v1/chrome/platforms/android/channels/stable/versions?pageSize=1", title: Chrome VersionHistory API - Android stable channel }
  - { id: chrome-win-stable, resource: "https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions?pageSize=1", title: Chrome VersionHistory API - Windows stable channel }
  - { id: amazon-fire-os-8, resource: https://developer.amazon.com/docs/fire-tablets/fire-os-8.html, title: Amazon - Fire OS 8 for Fire Tablets }
  - { id: officedepot-a9-plus, resource: https://www.officedepot.com/a/products/8596245/Samsung-Galaxy-Tab-A9-Tablet-11/, title: Office Depot - Samsung Galaxy Tab A9+ 11 inch 64GB Wi-Fi (SM-X210NZAAXAR) }
  - { id: samsung-us-tablets, resource: https://www.samsung.com/us/tablets/all-tablets/, title: Samsung US - all tablets }
  - { id: samsung-us-a9-plus, resource: https://www.samsung.com/us/mobile/tablets/galaxy-tab-a/galaxy-tab-a9-plus-128gb-navy-wi-fi-sm-x210ndbexar, title: Samsung US - former Galaxy Tab A9+ product page }
  - { id: samsung-us-a11-plus, resource: https://www.samsung.com/us/tablets/galaxy-tab-a11-plus/buy/galaxy-tab-a11-plus-128gb-gray-wi-fi-sku-sm-x230nzaixar, title: Samsung US - Galaxy Tab A11+ 128GB Wi-Fi }
  - { id: bestbuy-a9-plus, resource: "https://www.bestbuy.com/site/searchpage.jsp?st=galaxy+tab+a9%2B", title: Best Buy - Galaxy Tab A9+ search results }
  - { id: officedepot-m11, resource: https://www.officedepot.com/a/products/2451454/Lenovo-Tab-M11-FHD-LCD-Tablet/, title: Office Depot - Lenovo Tab M11 4GB 128GB (ZADA0054US) }
  - { id: lenovo-us-m11, resource: https://www.lenovo.com/us/en/p/tablets/android-tablets/lenovo-tab-m-series/lenovo-tab-m11/len103t0006, title: Lenovo US - Lenovo Tab M11 }
  - { id: bestbuy-m11, resource: "https://www.bestbuy.com/site/searchpage.jsp?st=lenovo+tab+m11", title: Best Buy - Lenovo Tab M11 search results }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-15T23:07:10Z }
---

# ADR-0012: The Fire Kids tablet is the hub demo device, and current stable Chrome validates the offline epic

## Status

`accepted` by the product owner on 2026-11-15
([ratification on #163](https://github.com/jasoncavaliere/the-butler-did-it/issues/163#issuecomment-6899304196)).
This ADR also absorbs #133 (K7, closed as a duplicate of #163): it records the wrapper, the connection
method, and the validation bar.

## Context

The hub needs a named hardware target, so the offline epic (#31-#34) and the hub shell (#16) stop
targeting "a tablet". The [Hub Hardware Findings](../docs/11-hub-hardware-findings.md) for #83 set up
the choice:

- [F2](../docs/11-hub-hardware-findings.md#f2-the-offline-epic-makes-the-browser-engine-a-first-class-requirement):
  the offline epic rides on service workers, install criteria, and browser storage, so the browser
  engine is a first-class requirement. An old or forked Chromium gives misleading results in both
  directions.
- [F3](../docs/11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target):
  the owner's spare Fire Kids tablet cannot be flashed, but it can be reclaimed in about 30 minutes and
  run a kiosk browser. Fire OS 8 is Android 11 with Amazon's own forked WebView, so it is good for
  judging how the board reads across a kitchen and not for signing off #31-#34.
- [F4](../docs/11-hub-hardware-findings.md#f4-recommended-purchase-lenovo-tab-m11-150-or-samsung-galaxy-tab-a9-180):
  the Lenovo Tab M11 and the Samsung Galaxy Tab A9+ were the recommended purchases as of 2026-08-13,
  with prices to re-verify before buying.

The owner refined the spike on 2026-11-13 into two roles, a demo device and a validation runtime, so
the demo can run on hardware already in the house without weakening the offline epic's sign-off.

## Decision

We split the hub's hardware into two roles and do not require a purchase:

- **(a) Demo device.** The hub's demo device is the owner's Amazon Fire Kids tablet, reclaimed per F3
  (no flashing), running Fully Kiosk Browser as device owner. Fire OS may refuse device owner, so the
  [runbook's Fire path](../docs/40-hub-tablet-kiosk-setup.md#fire-tablet-path) tries it first and
  otherwise falls back to Fully's Fire lockdown (its Accessibility service plus the Home app swap). The
  #132 on-device checklist records which of the two applied.
- **(b) Offline-epic validation runtime.** The offline epic tickets #31-#34
  ([O1](../brd/tickets/O1-pwa-manifest-service-worker-and-installability.md),
  [O2](../brd/tickets/O2-last-known-week-cache-glanceable-offline.md),
  [O3](../brd/tickets/O3-local-write-queue-sync-on-reconnect.md),
  [O4](../brd/tickets/O4-offline-status-ui-indicator-queued-writes.md)) are signed off in current
  stable Chrome on a Play Store Android device and in desktop Chrome, never on the Fire.
- **(c) Recommended future purchase.** A Samsung Galaxy Tab A9+ (the Lenovo Tab M11 as the alternative)
  is the recommended purchase for a dedicated Chrome-based reference tablet. It is a future step, not a
  requirement.

**The Fire is the demo and glanceability device and is never the device that validates #31-#34**
(F2, F3). A service-worker or install-criteria result on the Fire describes Amazon's WebView, not
Butler. What the Fire answers is "does the board read well from across the kitchen", which feeds #42's
glanceability decisions and the #16 hub shell.

### Demo device

| Field | Value |
| --- | --- |
| Device | The owner's Amazon Fire Kids tablet, reclaimed per F3 |
| OS | Fire OS 8, which incorporates Android 10 and Android 11 (API 30) ([Amazon: Fire OS 8](https://developer.amazon.com/docs/fire-tablets/fire-os-8.html)) |
| Browser engine | Amazon's own forked WebView, not Play Store Chrome ([F3](../docs/11-hub-hardware-findings.md#f3-the-spare-fire-kids-tablet-usable-as-a-prop-not-as-a-target)) |
| Model | TBD - the owner fills this in after merge |
| Generation | TBD - the owner fills this in after merge |

### Wrapper and connection

- **Wrapper:** Fully Kiosk Browser (the EMM edition) as device owner, set up with the
  [Hub Tablet Kiosk Setup](../docs/40-hub-tablet-kiosk-setup.md#fire-tablet-path) runbook (#127), the
  provisioning script (#128), and the reviewed Fully settings file (#129). On the Fire, device owner is
  tried first; if Fire OS refuses it, Fully's Fire lockdown applies, as described in (a).
- **Connection:** the demo share (#101). `demo/demo.sh share` puts the hub on the tailnet over HTTPS,
  so the service worker registers on the tablet. The steps are in
  [Connecting a tablet](../../demo/README.md#connecting-a-tablet) in the demo README.

### Validation runtime and browser floor

- **Requirement:** Chrome on the stable channel, auto-updated. On Android that is Chrome from the Play
  Store; on the desktop it is Chrome's own stable channel. No pinned or forked build counts, and the
  Fire's WebView never counts.
- **Current stable, as of 2026-11-15:** Chrome 158.0.8127.36 on Android
  ([VersionHistory, Android stable](https://versionhistory.googleapis.com/v1/chrome/platforms/android/channels/stable/versions?pageSize=1))
  and Chrome 158.0.8127.37 on Windows desktop
  ([VersionHistory, Windows stable](https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions?pageSize=1)).
- **Floor:** Chrome 158, the stable major version on the ADR date, from the same two sources. A sign-off
  run on an older major version does not count; update Chrome and run it again.

### Validation bar

- #31-#34 count as **hardware-validated** only when run on the **reference device**: a physical Play
  Store Android device on current stable Chrome (at or above the floor). Until a Galaxy Tab A9+ or
  Lenovo Tab M11 is bought, any physical Play Store Android device meets this bar.
- The hands-on pass uses the #132 on-device checklist and is tracked in
  [#165](https://github.com/jasoncavaliere/the-butler-did-it/issues/165).
- Desktop Chrome is required for sign-off too, but it is not hardware validation (the findings say an
  emulator or desktop-Chrome result alone is not sufficient evidence).
- A pass on the Fire never counts toward the bar.

### F4 candidates re-checked on 2026-11-15

Prices and availability below were read on 2026-11-15 from US pages. Amazon pages were not used
because they block automated reads.

| Candidate | Price | Availability | Source |
| --- | --- | --- | --- |
| Samsung Galaxy Tab A9+ (11 inch, 64GB, Wi-Fi, SM-X210NZAAXAR) | $199.99 sale, regular $223.99, sale ends 2026-11-21 | Add To Cart at Office Depot | [Office Depot](https://www.officedepot.com/a/products/8596245/Samsung-Galaxy-Tab-A9-Tablet-11/) |
| Samsung Galaxy Tab A9+ (manufacturer) | No price: Samsung US no longer lists it | Not sold by Samsung US: the old product page redirects to the all-tablets list, which carries the Galaxy Tab A11+ instead | [Samsung US former A9+ page](https://www.samsung.com/us/mobile/tablets/galaxy-tab-a/galaxy-tab-a9-plus-128gb-navy-wi-fi-sm-x210ndbexar), [Samsung US all tablets](https://www.samsung.com/us/tablets/all-tablets/) |
| Samsung Galaxy Tab A9+ (Best Buy) | No price shown | New 256GB Wi-Fi and Kids Edition listings Sold Out; the 128GB listing is open-box only | [Best Buy search](https://www.bestbuy.com/site/searchpage.jsp?st=galaxy+tab+a9%2B) |
| Samsung Galaxy Tab A11+ (successor, for reference) | $299.99 (128GB, Wi-Fi) | In stock at Samsung US | [Samsung US A11+](https://www.samsung.com/us/tablets/galaxy-tab-a11-plus/buy/galaxy-tab-a11-plus-128gb-gray-wi-fi-sku-sm-x230nzaixar) |
| Lenovo Tab M11 (11 inch, 4GB, 128GB, ZADA0054US) | $159.99 sale, regular $219.99, sale ends 2026-11-21 | Out of stock at Office Depot: the product page shows no Add To Cart | [Office Depot](https://www.officedepot.com/a/products/2451454/Lenovo-Tab-M11-FHD-LCD-Tablet/) |
| Lenovo Tab M11 (manufacturer) | Not read: Lenovo US refused the automated read (HTTP 403) | Not read | [Lenovo US Tab M11](https://www.lenovo.com/us/en/p/tablets/android-tablets/lenovo-tab-m-series/lenovo-tab-m11/len103t0006) |
| Lenovo Tab M11 (Best Buy) | No price shown | Folio-case bundles listed; the open-box tablet is Sold Out | [Best Buy search](https://www.bestbuy.com/site/searchpage.jsp?st=lenovo+tab+m11) |

The purchase is optional, so neither candidate has to sit in the vision's "$100 to $150 if they buy one"
band. The A9+ is now a previous-generation model that Samsung US has replaced with the Galaxy Tab A11+;
it stays the recommendation recorded in (c), and whoever buys should re-check both candidates and the
A11+ on the day.

## Consequences

- Nothing is bought now. The demo runs on the Fire, and sign-off runs on any physical Play Store Android
  device plus desktop Chrome.
- #165 runs the offline epic's hardware pass on the reference device with the #132 checklist. #132 also
  records whether the Fire took device owner or fell back to Fully's Fire lockdown.
- The owner fills in the Fire's model and generation in the Demo device table after merge. That is the
  only edit this ADR expects after acceptance.
- The browser floor and the F4 prices drift. When a buy decision or a stale floor makes them matter,
  supersede this ADR with a new one rather than editing the Decision.
- Glanceability findings from the Fire feed #42 and #16; they say nothing about offline behaviour.
- A native Android shell stays out of scope; see
  [F7](../docs/11-hub-hardware-findings.md#f7-adjacent-option-a-real-android-apk). The offline states
  the validation run checks are designed in [ADR-0007](0007-state-design-offline-first.md).

## Alternatives considered

- **Buy the Galaxy Tab A9+ (or M11) now and make it the only device.** This gives a dedicated reference
  tablet on day one, but it spends money before the demo needs it, and any Play Store Android device
  already meets the validation bar.
- **Use the Fire for everything, including sign-off.** Rejected per F2 and F3: Fire OS uses Amazon's
  forked WebView, so a service-worker or install result there describes Amazon's engine, not Butler.
- **Flash the Fire with a stock Android ROM so it runs real Chrome.** Not possible: no bootloader unlock
  exists for 2020-or-newer Fire tablets (F3), and flashing is the wrong layer for v1 anyway (F1).
