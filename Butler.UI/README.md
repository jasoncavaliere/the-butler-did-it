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

### The PWA (O1)

The hub is installed on the family tablet as a PWA, which needs three things served together: a web
app manifest, a registered service worker, and an https (or localhost) origin. All three ship from
this folder, following the versioned [Expo 57 PWA guide](https://docs.expo.dev/guides/progressive-web-apps/)
for a `web.output: single` app:

| Piece | Where | What it does |
| --- | --- | --- |
| Manifest | `public/manifest.json` | Install metadata: name, `display: standalone`, start URL, theme/background colour, and 192px + 512px icons in both `any` and `maskable` form (`public/icons/`, derived from `assets/icon.png`). |
| HTML | `public/index.html` | The exporter's HTML template (`npx expo customize public/index.html`), with the `<link rel="manifest">`, `theme-color`, and apple-touch-icon added. |
| Worker | `public/sw.js` | Precaches the app shell on install, serves it cache-first, and answers navigations network-first so a deploy is never pinned. Static assets only. |
| Registration | `src/pwa/` | `registerServiceWorker()` + the `useServiceWorkerRegistration()` hook `App.tsx` calls on mount. Feature-detected, so it is a no-op on iOS/Android and never throws. |
| Build step | `scripts/pwa-export.js` | Injects the exported (content-hashed) file list and a build id into `dist/sw.js`, then verifies the export is installable. |

**Offline scope.** This is the app *shell* only: HTML, JS, icons, static assets. API responses are
not cached by the worker (the glance cache below is O2) and writes are not queued by it (that is
O3, below) - non-GET and cross-origin requests fall straight through to the network.

**Checking it offline (local).**

```bash
npm run build:web
npx serve dist        # or any static server; localhost counts as a secure origin
```

Load the page, then in DevTools **Application > Service Workers** confirm the worker is activated,
tick **Offline**, and reload: the hub still renders. `scripts/service-worker.test.js` asserts this
same lifecycle headlessly, so the manual pass is a confirmation, not the only evidence.

**Manual installability check (Lighthouse).** Automated tests cover the manifest, the worker, and
the export; the browser's own install verdict is checked by hand. Serve `dist/` over https or
localhost, open Chrome DevTools > **Lighthouse**, and run the report - the install criteria should
pass and the address bar should offer **Install**. Re-run this whenever the manifest, the icons, or
the worker change.

### The last-known cache (O2)

O1 keeps the app *shell* loading with no network; O2 keeps it *worth looking at*. Every successful
load writes the data behind the daily glance to browser storage, and a load that fails because the
API is unreachable renders from that copy instead of an error - so the wall still shows the
last-known week and today's board (BRD 6.5 step 1, guardrail BO-5).

| Piece | Where | What it does |
| --- | --- | --- |
| Cache | `src/offline/glanceCache.ts` | One record per household under `butler.glance.v1.<householdId>`: the household + its people, the week + its board items, and a `cachedAtIso` freshness stamp. Read/write/merge helpers plus `describeLastKnown()`. |
| Reconnect | `src/offline/useReconnect.ts` | `useReconnectSignal(enabled)` - a counter that bumps on the browser `online` event while a surface is degraded. Both load effects list it, so the network returning refetches. |
| Tiles | `src/screens/HubShell.tsx` | Caches the household read; falls back to it when the API is unreachable, so the name tiles stay real. |
| Board | `src/components/ChoreBoard.tsx` | Caches the built week; falls back to it the same way, renders that fallback read-only, and reports up so the hub can mark the view. |
| Indication | `src/components/LastKnownBanner.tsx` | One calm line under the header ("Showing last-known - saved 12 minutes ago"), shown whenever any region is served from cache and cleared on the next successful load. |

Five rules keep it honest:

- **Read cache only.** Nothing here touches the write path; queuing an offline tap is O3's job
  (below), which persists separately through the same storage seam.
- **It revives itself.** The hub is a tablet on a wall; nobody reloads it. While degraded each surface
  listens for `online` and refetches when the network returns, which re-stamps the cache and clears
  the last-known line. A healthy surface subscribes to nothing.
- **Only for an unreachable API.** The fallback fires on the client's normalized `network` error. An
  HTTP/problem/parse failure is a real answer from a reachable service and still shows as an error,
  so the cache never hides a bug behind stale data. A partial outage shows the cached record whole
  rather than splicing it with the half that arrived - one glance, one freshness stamp.
- **Never cross-household.** The record is keyed by `householdId` *and* carries its own, verified on
  read; a mismatch reads as no cache.
- **Never a crash.** Storage that is absent, blocked (where even *reading* `localStorage` throws), or
  full, and an entry that is missing, unparseable, or wrong-shaped, all degrade to "no cache" and drop
  the caller back on its normal empty/error path. Reads are rebuilt field by field rather than cast,
  and each half is validated on its own, so a corrupt half cannot reach a render and the good half
  still serves.

### The write queue (O3)

O2 kept a cached board *readable* offline but refused every tap, because a cached row carries a
stale `weekIso` and the API has no current-week check on a completion. O3 makes that tap safe to
take: while offline (or the instant a live request answers `unreachable`), the tap still flips the
row immediately and the write lands in a durable local queue instead of the API, then replays in
order once the network is back (BRD 6.5 step 2, guardrail BO-5). Replay is safe without any
client-side conflict resolution because `ChoreCompletions` are append-only and an assignment's
`Status` is last-writer-wins under optimistic concurrency (risk R-2) - so a write that reaches the
server twice cannot double-count or corrupt state; a client-side de-duplication key keeps the
common double-send from even happening.

| Piece | Where | What it does |
| --- | --- | --- |
| Storage seam | `src/offline/storage.ts` | The one feature-detected, `SecurityError`-guarded Web Storage accessor (`defaultLocalStorage`) both O2 and O3 persist through, plus the shared `isRecord` validator. It also holds `sessionFallbackStorage()`, the write-only-as-far-as-this-session stand-in the queue (and only the queue) falls back to - see "never dropped, even with nowhere to persist" below. |
| Queue | `src/offline/writeQueue.ts` | One record per household under `butler.writeq.v1.<householdId>`: an ordered list of `{ method, path, body, kind, dedupeKey, attempts, status }` entries. `enqueueWrite`/`readWriteQueue`/`saveWriteQueue` plus `drainWriteQueue`, which replays head-first, persists after every step, and stops (never reorders) at the first write it cannot confirm. |
| React seam | `src/offline/useWriteQueue.ts` | `useWriteQueue(householdId, client)` hydrates the queue from storage on mount, drains on mount/reconnect/backoff-timer, coalesces concurrent drain requests into one pass, and hands a surface `{ entries, pending, failed, enqueue, flush }`. |
| Week guard | `src/offline/weekIso.ts` | `isCurrentWeek(weekIso)` - the client-side mirror of the API's ISO year-week bucketing, used to refuse a write from a cached board whose week has rolled over (the one case queuing would still be unsafe). |
| Board | `src/components/ChoreBoard.tsx` | Calls `enqueue()` from `toggle()` when offline (a cached board) or when a live request answers `network`; the optimistic flip stays either way. `applyQueuedWrites()` overlays not-yet-synced entries onto every fresh load, so a reconnect refetch racing the drain can never flicker a queued tap back to `Open`. |

Five rules keep replay honest:

- **An outage costs a write nothing.** A `network` answer means the outage is still on, not that the
  write is bad - it does not consume the retry budget, so an outage of any length can never mark a
  write terminally failed. A real HTTP/problem/parse error is the service actually refusing the
  write; that one still reverts the optimistic flip, exactly as it did before O3.
- **Bounded retries, then flag and continue.** A real error backs off exponentially (1s, 2s, 4s, 8s,
  capped at 30s); at 5 attempts the entry is flagged `failed` and the drain steps past it rather than
  blocking everything queued behind it. A flagged entry stays in storage - never dropped, never
  auto-cleared - which is what O4 surfaces; only a fresh tap on the same target revives it.
- **One write per target.** `enqueueWrite` keys by `(weekIso, choreId)`, not by direction: tapping
  done twice queues one write, and a complete-then-undo collapses to the single write the user
  actually meant, at its original queue position.
- **Never dropped, even with nowhere to persist.** The read cache degrades to "no cache" when Web
  Storage is absent (React Native), blocked (a privacy or kiosk profile), or refuses the write (quota,
  private mode) - a cache miss costs nothing. The *queue* cannot degrade that far: a tap the board has
  already flipped to done would be discarded with nothing left to replay it and nothing for O4 to
  surface. So it falls back one step less far, to `sessionFallbackStorage()` - session memory that the
  drain reads back through the same seam, so the queue stays complete, ordered, and replayable for the
  rest of the session, and only *durability across a relaunch* is given up. `saveWriteQueue` returns
  whether the queue landed durably, so the distinction is reported rather than assumed.
- **A cached board that has rolled into a new week stays read-only.** `isCurrentWeek` is checked both
  at render (whether the row is tappable) and again inside `toggle` (a wall tablet can sit untouched
  for days, so the week is judged at the moment of the tap, not the moment the board last drew
  itself) - the one case where queuing the tap would still land a completion in the wrong week.

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
              ChoreBoard.tsx # today/this-week chore board with tap-to-complete/undo, fills TodayPanel (Epic 40 C5/C7)
              FairnessView.tsx # contribution-balance view, rendered below TodayPanel in HubShell (Epic 40 C6)
              GroceryCart.tsx # hub grocery region: add by typing, review the cart, organizer-only confirm (Epic 50 G5)
              LastKnownBanner.tsx # "showing last-known" indication when a region is served from cache (O2)
  navigation/ RootNavigator.tsx  # navigation graph
  screens/    HubShell.tsx  # the always-on hub shell (shown once a household is selected)
              HouseholdSetup.tsx       # organizer onboarding wizard (H5)
              HouseholdSetupScreen.tsx # onboarding route = OrganizerGate + HouseholdSetup
  offline/    storage.ts    # shared, feature-detected Web Storage seam both offline modules persist through, plus the queue's session-memory fallback (O2/O3)
              glanceCache.ts # last-known glance read cache in browser storage, keyed by householdId (O2)
              useReconnect.ts # `online`-event signal that refetches a degraded surface; no-op off web (O2)
              weekIso.ts    # client-side ISO year-week helpers (isCurrentWeek) guarding a write from a stale cached board (O3)
              writeQueue.ts # durable local write queue + drain/replay-on-reconnect, keyed by householdId (O3)
              useWriteQueue.ts # React seam over the write queue: hydrate, drain on mount/reconnect/backoff, enqueue (O3)
  pwa/        registerServiceWorker.ts     # registers /sw.js; feature-detected no-op off web (O1)
              useServiceWorkerRegistration.ts # the hook App.tsx calls on mount (O1)
  state/      AppConfigContext.tsx # app-wide config/context providers
              HouseholdContext.tsx # current householdId + setter (useHousehold)
              OrganizerContext.tsx # signed-in organizer + token, backed by IAuthProvider (T4)
              HubDeviceContext.tsx # paired hub device token for the shared tablet (T5)
public/                     # copied verbatim into dist/ by the web export (O1)
  index.html                # the HTML template: links the manifest, keeps the Expo placeholders
  manifest.json             # web app manifest (install metadata)
  sw.js                     # the app-shell service worker
  icons/                    # 192/512 install icons, `any` + `maskable`, and the apple-touch-icon
scripts/                    # web-export build tooling (plain Node, no bundler)
  pwa-export.js             # inject the precache list into dist/sw.js, then verify the export
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
"Today", weekly-cadence under "This week" - and within each bucket by person, in roster order. With an
active participant (T3) the board *focuses*: it renders only that person's assignments (glowing in
their claim colour), answering "what's mine right now"; with no active participant it falls back to
the full read-only household glance for everyone (a tap cannot attribute a completion, so it does
nothing). Switching or clearing the active participant re-focuses or restores the full board instantly
with no refetch, since it is a pure derived-render filter over the already-loaded week. Tapping an item
toggles its completion, attributed to the active participant: an `Open` item completes through the C4
endpoint (`POST .../assignments/{weekIso}/{choreId}/complete`) with an optimistic flip to `Done`; a
`Done` item undoes that completion through the C7 endpoint
(`POST .../assignments/{weekIso}/{choreId}/undo`) with an optimistic flip back to `Open`. Both
directions reconcile to the response's `status` and revert to the item's prior state on error (or an
unconfirmed/empty response), so a mis-tap in either direction is recoverable without the board lying
about the server; a `Done` item is dimmed and checked (still tappable, to undo) rather than inert,
matching C4/C7's idempotent complete/undo.

**The fairness view** (`src/components/FairnessView.tsx`, Epic 40 C6) is journey 6.3's contribution
balance - a read-only glance at the Section 10 fairness guardrail, rendered by `HubShell` below
`TodayPanel` once a household is ready. On mount it reads the C6 aggregate
(`GET /households/{householdId}/fairness`, optionally with a `windowWeeks` query param) through the
typed API client and renders a labelled bar per person sized to their share of the household's
completed effort, with the top contributor's row emphasised. There is no tap target and no write. Every
load outcome is a calm, deliberate state: loading, an error message, a "nothing completed yet" empty
state when the household total is zero, or the ready distribution - the wall never shows a crash or a
blank region. A person's bar accents in their claim colour when supplied via the `people` prop
(`{ personId, claimColor }[]`, sourced from the roster `HubShell` already holds); otherwise it falls
back to the neutral brass accent.

**The grocery cart** (`src/components/GroceryCart.tsx`, Epic 50 G5) is journey 6.4's whole
"add oat milk -> review -> confirm" gesture, rendered by `HubShell` as its own bounded region between
`TodayPanel` and the fairness balance. It owns no data and composes three API surfaces through the
typed client:

- **Review (G2).** On mount it reads `GET /households/{householdId}/carts/current`, which hands back
  the week's single `Building` cart with its items and its `eTag`. Each line renders its `DisplayName`
  and `Quantity`. A week whose cart is already confirmed answers `409`, which the region treats as a
  calm confirmed state rather than an error.
- **Add (G3).** Typing a term and submitting (the Add button and the keyboard's return are the same
  gesture) POSTs to `/capture/text` with `{ utterance, personId, weekIso, quantity: 1 }`, then re-reads
  the cart so the rendered list and the `eTag` are always the server's truth - adding the same product
  twice increments its quantity server-side. Adding is deliberately open to anyone on the roster: no
  password, no organizer (decision D-3). The line is attributed to the hub's active tap-to-claim
  participant, so with nobody claimed the region says "Tap your name first" instead of spending a round
  trip on a `400`. An ambiguous term renders the problem's `suggestions` candidates with a next step;
  a no-match renders the problem's own message. Neither is ever a silent failure.
- **Confirm (G4).** The `Confirm order` action renders **only** for a signed-in organizer (T4) -
  absent, not disabled, matching the `OrganizerBar` convention - and POSTs to
  `/carts/{weekIso}/confirm` with the cart's `eTag` as `If-Match` (Contract 7.3), so a line added since
  the review comes back `412` with a re-read-and-try-again message rather than a silent no-op. On
  success the region reads as `Confirmed` and offers neither adding nor confirming again. As
  everywhere else in the hub, hiding the control is convenience: the API independently enforces `403`
  for a participant or the paired hub device.

**Demo path (fully offline of any real store).** The backing connector is the simulated G1
`SimulatedHebConnector` and its fixture catalog, so the end-to-end path needs no store account and no
network beyond the local API: tap a name to claim it -> type `oat milk` -> the cart shows
`H-E-B Oat Milk` x1 -> an organizer signs in through `OrganizerBar` -> `Confirm order` -> the cart
reads `Confirmed`. **No real order is placed and no money moves** (BRD decision D-8); the confirm
records intent only.

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
Offline behavior layers on top of this seam: a `network` result is what the O3 write queue
(`src/offline/writeQueue.ts`) queues instead of surfacing as an error.

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
