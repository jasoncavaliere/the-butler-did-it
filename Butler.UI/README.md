# Butler.UI

The front end for Butler - the household concierge. A cross-platform React app built with **Expo**
(React Native + react-native-web), so one codebase targets **web, iOS, Android**, and (later) desktop.

See the [product vision](../Butler.KnowledgeBase/docs/10-product-vision.md) for what Butler is. The v1
surface is the **shared-tablet hub**: web-first, delivered as an installable PWA on a family's own
tablet, offline-tolerant.

## Platform strategy

| Platform | How | v1? |
| --- | --- | --- |
| Web (the hub) | Expo web export -> Azure Static Web App, installable as a PWA | Yes - the v1 target |
| iOS / Android | Same Expo codebase (`expo run:ios` / `run:android`) | Later |
| Windows / macOS | Package the web build, or React Native Windows/macOS | Later maturation |

## Develop

```bash
# from Butler.UI/
npm install
npm run web        # run the hub in a browser (web-first dev loop)
npm run ios        # iOS simulator (macOS only)
npm run android    # Android emulator
```

## Build & deploy (web)

```bash
npm run build:web          # expo export --platform web  +  the PWA post-export step -> dist/
npm run verify:web-export  # assert dist/ is an installable PWA, without re-exporting
```

`build:web` is the command to deploy from, and the one CI runs. It runs the Expo web export and
then `scripts/pwa-export.js`, which injects the real precache list into `dist/sw.js` and verifies
the result.

A bare `npx expo export --platform web` is **not** a deployable export. `public/` is copied verbatim
into `dist/`, so the manifest, icons, and worker are all present and the browser will still offer the
install - but `dist/sw.js` still carries its placeholder precache list (`/`, `/index.html`,
`/manifest.json`) with no JS bundle in it. The worker would cache a shell it cannot run, and the
first offline load would render blank. `verify:web-export` fails on exactly that, so an un-injected
export never gets past CI.

Publish `dist/` to Azure Static Web Apps. Infra is Bicep with fully parameterized names/tags (fill
`infra/main.bicepparam` with values valid for the target subscription's Azure Policy first):

```bash
az deployment group create \
  --resource-group <rg> \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

App source is published via CI/CD (GitHub Actions / azd), not from the Bicep template.

Offline/PWA internals (service worker, last-known cache, write queue) and the per-component project structure are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Project structure

`src/api` (typed client, config) | `src/auth` (organizer/hub auth providers) | `src/components` (hub widgets) | `src/screens` (HubShell, HouseholdSetup) | `src/state` (React contexts) | `src/offline` (cache + write queue) | `src/pwa` (service-worker registration) | `scripts/` (PWA export). Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## Quality gates

```bash
npm run lint           # eslint (eslint-config-expo)
npm run typecheck      # tsc --noEmit
npm test               # jest (jest-expo preset)
npm run test:coverage  # jest with the 98% global coverage gate
npm run ci:verify      # lint + typecheck + coverage-gated test (the CI gate)
```

Tests use `jest-expo` + `@testing-library/react-native` and live next to the code they cover
(`*.test.ts[x]`). Coverage is gated at 98% for statements, branches, functions, and lines
(`coverageThreshold.global` in `jest.config.js`), per Engineering Contract 7.7 - keep new code covered.
Note: `@testing-library/react-native` v14's `render`/`rerender`/`unmount` are async - `await` them.

The web-export tooling is held to the same bar: `scripts/pwa-export.test.js` checks the shipped
`public/` assets and the injection/verification logic against fixture exports, and
`scripts/service-worker.test.js` drives `public/sw.js` through install -> activate -> offline fetch
in a Node VM. Both run inside `npm run ci:verify`. The export itself is built by a separate CI step
(`npm run build:web`, which fails if the result is not an installable PWA), so run that locally when
touching anything under `public/` or `scripts/`.

## Notes

- `CLAUDE.md` / `AGENTS.md` here are Expo-generated UI guidance and apply within this folder; the
  monorepo-level guide is the root [`CLAUDE.md`](../CLAUDE.md).
- The hub shell (`HubShell`) renders the header, tappable name tiles, and `TodayPanel` seam (T2),
  and tap-to-claim - claiming a person, the claim-colour glow, and the idle timeout back to neutral
  - is wired up (T3). `TodayPanel` is filled with the glanceable, tap-to-complete chore board
  (`ChoreBoard`, Epic 40 C5), and the grocery cart (`GroceryCart`, Epic 50 G5) plus the read-only
  contribution balance (`FairnessView`, Epic 40 C6) render below it.
- Organizer sign-in (`OrganizerBar`, `OrganizerContext`, `IAuthProvider`) is wired up (T4): the hub
  always renders the bar, sensitive affordances are hidden without a signed-in organizer, and the API
  client attaches the organizer bearer automatically.
- Hub device pairing (`HubPairing`, `HubDeviceContext`, T5) is wired up: a signed-in organizer can pair
  the tablet and the resulting device token is held in memory for the process lifetime. Presenting that
  token on later reads/completion writes, and the actual roster-edit/order-confirm/teardown screens the
  `OrganizerBar` callbacks wire into, are later tickets.
- The web export is an installable PWA (O1): manifest, icons, and a service worker that precaches the
  app shell, so a second load of the hub works with the network off. Caching API data (O2, the
  last-known glance) and queuing writes while offline (O3, the durable write queue) both build on top
  of that shell rather than living in the worker itself.
