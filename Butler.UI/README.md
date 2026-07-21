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
  api/        config.ts     # typed API base config (env-driven, dev default) + AuthConfig (T4)
              client.ts     # typed fetch client (ApiClient) - the data-access seam; attaches the organizer bearer (T4)
              useApiClient.ts # hook that binds the client to AppConfigContext's base URL + OrganizerContext's token
              models.ts     # typed request/response shapes for the H1-H4 endpoints
              errors.ts     # describeApiError: an ApiError -> one readable line
  auth/       OrganizerGate.tsx    # gates children behind an authenticated organizer (probes /me)
              authProvider.ts     # IAuthProvider seam: OrganizerIdentity/OrganizerSession (T4)
              createAuthProvider.ts # config-driven provider selection (dev vs Entra) (T4)
              devAuthProvider.ts  # dev-mode provider - the deterministic F6 dev organizer, no token (T4)
              entraAuthProvider.ts # Entra External ID OIDC/PKCE provider - the v1 IAuthProvider (T4)
              OrganizerBar.tsx    # hub control strip: sign in/out + gated sensitive affordances (T4)
              HubPairing.tsx      # organizer-only "pair this tablet" affordance (T5)
  components/ Screen.tsx     # shared layout primitives
              TodayPanel.tsx # bounded "today" container; glows in the active participant's claim colour (T3)
              ChoreBoard.tsx # today/this-week chore board with tap-to-complete, fills TodayPanel (Epic 40 C5)
  navigation/ RootNavigator.tsx  # navigation graph
  screens/    HubShell.tsx  # the always-on hub shell (shown once a household is selected)
              HouseholdSetup.tsx       # organizer onboarding wizard (H5)
              HouseholdSetupScreen.tsx # onboarding route = OrganizerGate + HouseholdSetup
  state/      AppConfigContext.tsx # app-wide config/context providers
              HouseholdContext.tsx # current householdId + setter (useHousehold)
              OrganizerContext.tsx # signed-in organizer + token, backed by IAuthProvider (T4)
              HubDeviceContext.tsx # paired hub device token for the shared tablet (T5)
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
walked away. The shell itself fetches no chores; `TodayPanel` (`src/components/TodayPanel.tsx`) stays
a bounded, dumb container - it renders whatever children it is given (or a calm "being prepared" empty
state) and, given an `activeParticipant`, accents itself in that person's colour - and `HubShell` fills
it with `ChoreBoard` (Epic 40 C5) once a household is ready.

**The chore board** (`src/components/ChoreBoard.tsx`, Epic 40 C5) is the visible payoff of the wedge
(journey 6.2): it fills `TodayPanel` with the current week's assignments and lets a tap mark one done.
On mount it calls the C3 generate/regenerate endpoint (`POST /households/{householdId}/assignments/generate`
with an empty body - a deterministic, `Done`-preserving regenerate, so re-reading it to render is safe)
and joins each assignment against the open Chores read (H2) by `choreId` to get its title and cadence
(the C3 projection carries no title). Items are grouped into two buckets - daily-cadence chores under
"Today", weekly-cadence under "This week" - and within each bucket by person, in roster order; the
active participant's items (T3) glow in their claim colour, and with no active participant the board
renders read-only (a tap cannot attribute a completion, so it does nothing). Tapping an open item
completes it through the C4 endpoint
(`POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete`) with an optimistic flip to
`Done`, reconciling on the response and reverting on error; a `Done` item is dimmed, checked, and not
tappable again, matching C4's idempotent double-complete.

**Organizer onboarding** (`src/screens/HouseholdSetup.tsx`, H5) is a multi-step wizard - create
household, add rooms, add people (each with a child flag and claim colour), map starter chores to
rooms - driven entirely through the typed API client. Each step POSTs to its H1-H4 endpoint; a
failure surfaces the API's problem-details as an in-screen message and does not advance. The new
`householdId` is published to `HouseholdContext` on completion. The flow is wrapped in
`OrganizerGate` (`src/auth/OrganizerGate.tsx`), which probes the organizer-only `GET /me` (the F6
auth seam) so only an authenticated organizer reaches it; the Entra sign-in UI itself is a later
ticket.

**Organizer sign-in** (`src/auth/`, `src/state/OrganizerContext.tsx`, T4) is the client side of
Engineering Contract 7.4: the organizer is the product's only authenticated user, and sign-in flows
through an IdP-agnostic `IAuthProvider` seam (`src/auth/authProvider.ts`) rather than any Entra-specific
SDK, mirroring the server's generic `AddJwtBearer` and the `IStoreConnector` philosophy. `createAuthProvider`
(`src/auth/createAuthProvider.ts`) selects the concrete provider from `AuthConfig`
(`src/api/config.ts`): in dev mode (`EXPO_PUBLIC_DISABLE_AUTH`, defaults to `true` when unset) it
builds `devAuthProvider.ts`'s deterministic dev organizer (matching the API's `DevOrganizerSubject`/
`DevOrganizerName`, no token, no live tenant needed); otherwise it builds `entraAuthProvider.ts`'s
standard OIDC Authorization Code + PKCE flow against `EXPO_PUBLIC_AUTH_AUTHORITY`,
`EXPO_PUBLIC_AUTH_CLIENT_ID`, `EXPO_PUBLIC_AUTH_REDIRECT_URI`, and `EXPO_PUBLIC_AUTH_SCOPES` (space
separated, defaults to `openid profile`). `OrganizerProvider` (wrapping the app in `App.tsx`, above
`HouseholdProvider`) holds the resulting `OrganizerSession` and exposes it through `useOrganizer()` as
`{ organizer, token, isSignedIn, signIn, signOut }`; `useApiClient()` reads `token` and the client
(`src/api/client.ts`) attaches it as `Authorization: Bearer` only when present, so participant reads stay
unauthenticated. `OrganizerBar` (rendered at the top of `HubShell`) offers only a sign-in button with no
organizer signed in; once signed in it shows the organizer's name, sign-out, and the sensitive-action
affordances (edit roster, confirm order, household teardown) - hidden entirely rather than merely
disabled, so a participant is never presented them. This is defense-in-depth only: the API enforces the
`Organizer` policy server-side (F6, T5); a hidden affordance is convenience, not the security boundary.
Organizer auth and the active tap-to-claim participant are independent - signing in or out never
disturbs the other.

**Hub device pairing** (`src/auth/HubPairing.tsx`, `src/state/HubDeviceContext.tsx`, T5) makes the
shared tablet itself a long-lived, household-scoped actor rather than an anonymous caller. `HubPairing`
(rendered in `HubShell`, next to `OrganizerBar`) renders only for a signed-in organizer - a participant
never sees it - and calls the organizer-gated `POST /households/{householdId}/hub-devices/pair` endpoint
through the typed API client; the hidden affordance is convenience, not the security boundary, since the
API enforces the `Organizer` policy server-side (T5 API side). A successful pair stores the returned
long-lived device token in `HubDeviceProvider` (wired in `App.tsx`, alongside `OrganizerProvider` and
`HouseholdProvider`) via `useHubDevice()`'s `setDeviceToken`; the token lives in memory for the process
lifetime, mirroring the other hub session state. Presenting the device token on later requests (the
`X-Device-Token` header) is a later ticket - this ticket only pairs and stores it.

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
  - is wired up (T3). `TodayPanel` is filled with the glanceable, tap-to-complete chore board
  (`ChoreBoard`, Epic 40 C5).
- Organizer sign-in (`OrganizerBar`, `OrganizerContext`, `IAuthProvider`) is wired up (T4): the hub
  always renders the bar, sensitive affordances are hidden without a signed-in organizer, and the API
  client attaches the organizer bearer automatically.
- Hub device pairing (`HubPairing`, `HubDeviceContext`, T5) is wired up: a signed-in organizer can pair
  the tablet and the resulting device token is held in memory for the process lifetime. Presenting that
  token on later reads/completion writes, and the actual roster-edit/order-confirm/teardown screens the
  `OrganizerBar` callbacks wire into, are later tickets.
