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
              models.ts     # typed request/response shapes for the H1-H4 endpoints
              errors.ts     # describeApiError: an ApiError -> one readable line
  auth/       OrganizerGate.tsx # gates children behind an authenticated organizer (probes /me)
  components/ Screen.tsx     # shared layout primitives
              TodayPanel.tsx # bounded "today" container; glows in the active participant's claim colour (T3), Epic 40 C5 seam
  navigation/ RootNavigator.tsx  # navigation graph
  screens/    HubShell.tsx  # the always-on hub shell (shown once a household is selected)
              HouseholdSetup.tsx       # organizer onboarding wizard (H5)
              HouseholdSetupScreen.tsx # onboarding route = OrganizerGate + HouseholdSetup
  state/      AppConfigContext.tsx # app-wide config/context providers
              HouseholdContext.tsx # current householdId + setter (useHousehold)
```

**Navigation** uses [React Navigation](https://reactnavigation.org/) with a native stack
(`@react-navigation/native` + `@react-navigation/native-stack`). `RootNavigator` mounts the
`NavigationContainer` and conditionally registers routes on the selected household (the React
Navigation auth-flow pattern): with no household it mounts the onboarding flow (`HouseholdSetup`),
and once `useHousehold` holds an id it mounts the `Home` route, which renders the always-on
`HubShell` (T2). Add a screen under `src/screens`, then register it in `RootNavigator` and extend
`RootStackParamList`.

**The hub shell** (`src/screens/HubShell.tsx`, T2/T3) is the shared-device shell the rest of the
product renders inside (BRD 6.2). It reads the active household from `useHousehold` and, through
the typed API client, loads the household name (H1) and the open tap-to-claim roster (the
`RosterEntryResponse[]` projection from `GET /households/{householdId}/people`) to render three
regions: a header (household name + today's date), a row of tappable participant name tiles (one
per person, accented by their claim colour), and a bounded `TodayPanel`. Every load outcome -
loading, ready, no household, or an unreachable API - is a calm, deliberate state; the shell never
shows a crash or a blank screen. There is no password or sign-in prompt on this shell: participants
glance and tap, and organizer sign-in is a separate affordance (T4).

Tapping a name tile claims that person through the T1 endpoint
(`POST /households/{householdId}/people/{personId}/claim`) and holds the returned
`ParticipantSessionResponse` as UI-only state (never persisted as a credential, never sent to
organizer endpoints). The claimed tile and `TodayPanel` both switch to that person's claim colour
and `TodayPanel`'s heading becomes "\<name\>'s day" - "what's mine glows" (BRD vision). Tapping a
different tile (or the active tile again) re-claims and moves the glow; a failed claim leaves the
current state untouched. With no interaction for `IDLE_TIMEOUT_MS` (45s, exported from
`HubShell.tsx` and overridable via the `idleTimeoutMs` prop for tests) the active participant clears
back to the neutral glance automatically - the shared tablet never stays "claimed" by someone who
walked away. The shell fetches no chores itself - `TodayPanel` (`src/components/TodayPanel.tsx`) is
a documented seam: a bounded container that renders whatever children it is given (or a calm "being
prepared" empty state) and, given an `activeParticipant`, accents itself in that person's colour, so
Epic 40 C5 can fill it with the chore board without restructuring the hub layout.

**Organizer onboarding** (`src/screens/HouseholdSetup.tsx`, H5) is a multi-step wizard - create
household, add rooms, add people (each with a child flag and claim colour), map starter chores to
rooms - driven entirely through the typed API client. Each step POSTs to its H1-H4 endpoint; a
failure surfaces the API's problem-details as an in-screen message and does not advance. The new
`householdId` is published to `HouseholdContext` on completion. The flow is wrapped in
`OrganizerGate` (`src/auth/OrganizerGate.tsx`), which probes the organizer-only `GET /me` (the F6
auth seam) so only an authenticated organizer reaches it; the Entra sign-in UI itself is a later
ticket.

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
- The hub shell (`HubShell`) renders the header, tappable name tiles, and `TodayPanel` seam (T2),
  and tap-to-claim - claiming a person, the claim-colour glow, and the idle timeout back to neutral
  - is wired up (T3). The glanceable chore board that fills `TodayPanel` is not built yet - that
  lands in Epic 40 C5.
