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
npx expo export --platform web     # static site -> dist/
```

Publish `dist/` to Azure Static Web Apps. Infra is Bicep with fully parameterized names/tags (fill
`infra/main.bicepparam` with values valid for the target subscription's Azure Policy first):

```bash
az deployment group create \
  --resource-group <rg> \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

App source is published via CI/CD (GitHub Actions / azd), not from the Bicep template.

## Project structure

Application code lives under `src/`, layered so later capability tickets have a clear home:

```
App.tsx                     # thin composition root: providers + navigation
src/
  api/        config.ts     # typed API base config (env-driven, dev default)
              client.ts     # typed fetch client (ApiClient) - the data-access seam
              useApiClient.ts # hook that binds the client to AppConfigContext's base URL
  components/ Screen.tsx     # shared layout primitives
  navigation/ RootNavigator.tsx  # navigation graph
  screens/    HomeScreen.tsx # one screen per route
  state/      AppConfigContext.tsx # app-wide config/context providers
              HouseholdContext.tsx # current householdId + setter (useHousehold)
```

**Navigation** uses [React Navigation](https://reactnavigation.org/) with a native stack
(`@react-navigation/native` + `@react-navigation/native-stack`). `RootNavigator` mounts the
`NavigationContainer` and registers routes; the `Home` route is the entry. Add a screen under
`src/screens`, then register it in `RootNavigator` and extend `RootStackParamList`.

**API base URL** comes from `src/api/config.ts`: it reads `EXPO_PUBLIC_API_BASE_URL` (inlined by Expo
at build time) and falls back to `http://localhost:5108` for local dev. Use `apiUrl(path)` to build
request URLs.

**API client** (`src/api/client.ts`) is the shared data-access seam every UI ticket should call the API
through instead of reinventing `fetch`. `createApiClient({ baseUrl })` returns an `ApiClient` with:

- `get<T>(path)` - GETs `path` and returns an `ApiResult<T>`, surfacing the response `ETag`.
- `update<T>(path, body, { ifMatch, method })` - writes `body` to `path` (`PUT` by default), sending
  `If-Match: ifMatch` when provided.

Both methods always resolve (never reject) to an `ApiResult<T>`: either `{ ok: true, status, data, etag }`
or `{ ok: false, error }`, where `error.kind` is one of `http` (error status, non-problem body),
`problem` (RFC 7807 `application/problem+json` body), `network` (the API was unreachable), or `parse`
(a success status whose body wasn't valid JSON). Callers branch on `result.ok` and never need to
`try/catch` a raw fetch. In components, get a client bound to the current config via the
`useApiClient()` hook (`src/api/useApiClient.ts`) rather than calling `createApiClient` directly.
Offline behavior (queuing writes while unreachable, Epic 60) layers on top of this seam and is not
built yet.

**Household context** (`src/state/HouseholdContext.tsx`) holds the currently-selected household for the
shared tablet. Wrap the app in `HouseholdProvider` (already wired in `App.tsx`) and read/set the active
household from any screen with the `useHousehold()` hook (`{ householdId, setHouseholdId }`). Later
tickets (tap-to-claim, session) build richer participant state on top of this seam.

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

## Notes

- `CLAUDE.md` / `AGENTS.md` here are Expo-generated UI guidance and apply within this folder; the
  monorepo-level guide is the root [`CLAUDE.md`](../CLAUDE.md).
- The hub UI (tap-to-claim profiles, the glanceable weekly board, offline behavior) is not built yet -
  `HomeScreen` is still a placeholder screen, but it now proves the API client wiring by calling the
  System `/health` endpoint on mount and showing a loading, healthy, or graceful-unreachable state.
