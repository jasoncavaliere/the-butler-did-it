# Butler.UI - Architecture notes

Design notes moved out of the README so it stays a quick start. Read only the section for the area you are touching.

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
| React seam | `src/offline/useWriteQueue.ts` | `useWriteQueue(householdId, client)` hydrates the queue from storage on mount, drains on mount/reconnect/backoff-timer, coalesces concurrent drain requests into one pass, and hands a surface `{ entries, pending, failed, enqueue, flush, confirmedRevision, unreachable }`. `confirmedRevision` is a counter that bumps once per drain run that confirmed at least one write (never on an empty, unreachable, or refused run), for a load effect to list in its dependencies. `unreachable` is whether the last drain run ended on a `network` answer (reset by the next run that reaches the API), which the O4 indicator reads. Called exactly once per household, by `WriteQueueProvider` (`src/offline/WriteQueueContext.tsx`); surfaces read it through `useWriteQueueContext()`, which throws outside the provider. |
| Week guard | `src/offline/weekIso.ts`, `src/offline/useCurrentWeek.ts` | `isCurrentWeek(weekIso)` - the client-side mirror of the API's ISO year-week bucketing, used to refuse a write from any board, live or cached, whose week has rolled over, and to refuse to replay a queued assignment write whose week ended before it could sync (#89). `msUntilNextWeekIso()` gives the time to the next Monday 00:00 UTC, and `useCurrentWeekIso()` holds the current week as React state on a timer armed for that instant, so a wall hub nobody reloads redraws (and reloads) at the boundary. |
| Board | `src/components/ChoreBoard.tsx` | Calls `enqueue()` from `toggle()` when offline (a cached board) or when a live request answers `network`; the optimistic flip stays either way. `applyQueuedWrites()` overlays not-yet-synced entries onto every fresh load, so a reconnect refetch racing the drain cannot flicker a still-queued tap back to `Open`. A write the drain has already confirmed is no longer in the queue to overlay, so the board also lists `confirmedRevision` in its load dependencies: it refetches once when a drain confirms a write, discarding any load that raced the drain with a pre-sync snapshot, and renders the post-sync server state (#88). A live tap never enters the queue, so taps still in flight or settled during a load are overlaid on that load (`applyLiveTaps()`/`pruneLiveTaps()`, queued writes first and live taps on top), so a refetch that raced a live tap cannot redraw it (#147). |

Six rules keep replay honest:

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
- **Any board that has rolled into a new week stays read-only until it reloads.** A live board is
  only current at the moment it was loaded, and the wall tablet can hold it across Sunday midnight
  just as a cached board outlives an outage, so the guard no longer cares how the board was loaded
  (#89). The week is checked at render (`useCurrentWeekIso`, whether the row is tappable) and again
  inside `toggle` against the real clock (a wall tablet can sit untouched for days, so the week is
  judged at the moment of the tap, not the moment the board last drew itself) - the one case where
  writing or queuing the tap would land a completion in the wrong week. The board lists the current
  week in its load dependencies, so it reloads the new week once at the boundary and a healthy hub is
  tappable again on Monday without anyone touching it. The tablet and the API read different clocks,
  so that reload can reach a server that has not turned the week yet; a live load whose week
  disagrees with the tablet's is retried on a backoff (`LIVE_WEEK_RETRY_DELAYS_MS`: 5s, 15s, 60s,
  then every 5 minutes), and a refused tap forces a reload, so a few milliseconds of skew cannot
  leave the board read-only for the week. If the weeks still disagree after a retry
  (`CLOCK_NOTICE_AFTER`), the tablet's clock is likely wrong and the board says so instead of going
  silently inert.
- **A queued write whose week has ended is flagged, not replayed.** The drain reads the week back out
  of each assignment entry's `dedupeKey` (`assignmentWeekIso`) before sending it; if that week is no
  longer current the entry is flagged `failed` with a "the week ended" error and stepped over, like an
  exhausted retry, so a tap queued on Sunday night cannot mark last week done on Monday. Its
  `attempts` are untouched (the API never answered it), it stays in storage for O4, and writes with no
  week in their key (a cart add) are not week-bound. The key is parsed rather than a field added, so
  writes queued before this rule existed are covered and the `v1` schema is unchanged.
- **A held drain shows the queue as stored.** When the dataset guard cannot verify the dataset
  (`unverified`), the drain re-reads the queue into its state before backing off. Otherwise a write
  enqueued just after an earlier pass read an empty queue (the hub glance on mount, say) would show as
  0 pending, and the queue would not listen for the reconnect that replays it.

### Hub glance events (#122)

The hub reports that it was looked at by posting `{ "type": "hub-glanced" }` to
`POST /households/{id}/events` (`src/offline/hubGlance.ts`, `src/offline/useHubGlance.ts`). It is the
only usage event the UI posts: completions, undos, cart adds, confirms and claims are recorded by the API
itself, so claiming a person on the hub posts no event of its own.

- **Triggers.** `HubGlanceReporter`, a render-null component beside `QueueRevival` inside the
  `WriteQueueProvider` in `HubShell`, reports on mount and whenever `document` fires
  `visibilitychange` with `visibilityState === 'visible'`. Without a document (native, Jest) it reports
  on mount only.
- **10-minute per-device debounce.** The last report is stamped per household under
  `butler.hubglanced.v1.<householdId>` (not `butler.glance.v1.`, which is the O2 cache) in
  `sessionFallbackStorage`, so it survives a reload where Web Storage exists. The stamp is written
  before posting, so a failing API is not hammered.
- **Online: a direct post, not the queue.** A write that drains through the queue bumps
  `confirmedRevision`, which flashes "All synced." and makes surfaces refetch. A glance every 10
  minutes must do neither, so the online path calls `client.update` directly.
- **Offline: queued.** Only a `network` error enqueues the glance (`kind: 'hub-glance'`, a non-assignment
  `dedupeKey` of `hub-glance|<ms>`, so it is not week-bound) and it replays on reconnect like any other
  write. While queued it counts in the sync indicator's pending count. Any other refusal (a `401` on an
  unpaired hub, `400`, `404`) is dropped, since retrying an answered request cannot succeed.

### The sync indicator (O4)

The hub header carries one quiet row of status chips, `SyncIndicator`
(`src/components/SyncIndicator.tsx`), so the family can tell at a glance whether the wall is online,
whether taps are waiting to sync, and whether any never went through. It is styled after the
`offline-chip` design token: muted pill chips, a text glyph plus words for every state, never colour
alone (ADR-0010), and a polite live region for screen readers.

| Segment | When | Copy |
| --- | --- | --- |
| Connection | always | `Online` / `Offline` |
| Pending | the queue's `pending` is above 0 | `2 waiting to sync` |
| Synced | for `SYNC_CONFIRMATION_MS` (4s) after a drain run confirms writes and leaves nothing pending | `All synced.`, or `Synced.` while any write is flagged failed |
| Failed | the queue's `failed` is above 0 | `1 change did not go through` / `2 changes did not go through` |

- **One queue, shared.** The board and the indicator both read the queue, and two `useWriteQueue`
  calls would be two drains over one storage record. So `HubShell` mounts one `WriteQueueProvider`
  per household (with the same `useApiClient()` client the board loads with) and both read it via
  `useWriteQueueContext()`.
- **Offline is more than the browser's flag.** The connection reads `Offline` when the browser says
  so (`useBrowserOnline`: `navigator.onLine`, then the `online`/`offline` events, inert off web), when
  the queue's last drain could not reach the API (`unreachable`), or when the hub is serving any
  region from the O2 cache (that cache only ever stands in on a network failure). So "wifi up, API
  down" reads `Offline` once a drain fails or a region is served from cache, and stays there until a
  drain or a reload actually gets through. With no cache and an empty queue neither happens, so the
  indicator reads `Online` beside the shell's could-not-reach error - a known gap tracked in #151.
  That outage never fires the
  browser's `online` event, so a drain that confirms a queued write is what revives the hub: the board
  refetches on `confirmedRevision`, and while the shell is degraded it reloads on it too (HubShell's
  `QueueRevival`), which clears the cached stamp and with it `Offline`. None of the indicator's inputs
  is a load dependency - the indicator itself never causes a refetch.
- **The confirmation is derived, not stored.** It shows while the queue's `confirmedRevision` is
  ahead of the revision the indicator last let go of; a timer armed in an effect moves that marker
  forward. It starts at the current revision, so a remount never replays an old confirmation.
- **Failed writes are never hidden.** The failed chip has no timer and no dismiss; it clears only
  when the entry leaves the queue (a fresh tap on the same target revives it, O3). A signed-in
  organizer also sees a row per failed write: what it was (`Marking a chore done`, `Undoing a
  chore`, `Adding to the cart`, otherwise `A change`) and the queue's `lastError`.
- **It never covers the glance.** The indicator renders inside the header (`hub-header`), beside the
  date, in normal flex flow - no absolute positioning, `zIndex`, or negative margins - so it cannot
  overlap the name tiles or the board. A `HubShell` component test walks the styles from the
  indicator up to the shell to hold that line.

### The dataset guard (D7)

The cache (O2) and the queue (O3) both outlive the data they were built from. When that data is
replaced - a demo reseed, or storage wiped - the cache shows a household that is gone and the queue
holds taps aimed at rows that no longer exist (or new rows that happen to share their ids). The API
serves a **dataset id** for this (`GET /api/system/dataset`, #100; see `Butler.API/ARCHITECTURE.md`),
and the hub compares it with the id it last saw.

- **The check.** `checkDataset(householdId, client)` (`src/offline/datasetGuard.ts`) reads the id via
  `fetchDatasetId` (`src/api/dataset.ts`). Any failure - unreachable API, any error status (the proxy
  answers `502` while the API is down), a malformed body - is `unverified` and clears nothing. With
  no stored id it is `first-seen`: store the id, keep everything. The same id is `unchanged`. A
  different id is `changed`: clear the household's write queue (`clearWriteQueue`, the only path
  that discards writes), then its glance (`clearGlance`), then store the new id. Everything after the
  fetch is synchronous, so two racing checks can never both act on the old id.
- **Where the id lives.** Per household at `butler.dataset.v1.<householdId>`, through
  `sessionFallbackStorage`, so it is durable exactly when the queue is.
- **When it runs.** `useDatasetGuard` (`src/offline/useDatasetGuard.ts`) checks when the shell mounts
  with a household (the hub does not persist its household, so that is "startup") and on every
  `online` event, live or degraded. `HubShell` renders only a `hub-dataset-check` placeholder
  ("Waking up the hub...") until the startup check settles, so no cached glance is shown and no
  queued write drains before the guard has had its say.
- **The drain gate.** `HubShell` passes the guard's `verify` into `WriteQueueProvider`, and
  `useWriteQueue` asks it before every drain pass that has something pending: `changed` stops the run
  (the guard has emptied the queue), `unverified` sends nothing, reports unreachable, and re-probes
  after `OFFLINE_RETRY_MS`; `unchanged` and `first-seen` drain. This covers an API-only outage (a demo
  reset) that never fires `online`.
- **The reload.** A `changed` check bumps the guard's `revision`, and `HubShell` keys its body on it.
  The remount reloads every household read from the API and re-hydrates the queue from the storage
  the guard just emptied, so a stale tap is never replayed into the new dataset.
- **Known limits.** A dataset fetch that hangs holds the placeholder (no timeout yet), and a write
  already in flight at the moment of a reseed is not recalled.

### The hub layout (#118)

`HubShell` picks its layout from the window (`useHubLayout()` = `selectHubLayout(useWindowDimensions())`,
in `src/layout/hubLayout.ts`) and hands it to `TodayPanel` and `ChoreBoard`, which default to portrait.

| Layout | Selected when | Arrangement | Type steps (name / tile / row) |
| --- | --- | --- | --- |
| `landscape-compact` (1280x800) | width >= height, height < 1000 | ADR-0005 zones: header, one tile row, then Today (2 columns of person groups, scrolls inside the panel) beside a side column (groceries, balance) | title / subhead / subhead |
| `landscape-roomy` (1920x1200) | width >= height, height >= 1000 | same zones, roomier padding and gaps | display / title / title |
| `portrait` (800x1280, jest default) | height > width | the single stack inside a page `ScrollView`, tiles 3 to a row, 1 column of groups | title / subhead / subhead |

- **Tokens only.** Every font size, line height (`round(size * 1.2)`), padding, gap and fixed height
  comes from `design-tokens.json` through `src/layout/tokens.ts` (spacing named `s1`..`s9` as in the
  mockup). Every layout keeps the 64px hub row (ADR-0008). The palette is unchanged.
- **Theme module and hub targets (#120).** `src/theme/theme.ts` is the typed view UI code reads design
  values from: the six claim colours (`claimColors`, token order, glyph plus light and dark variants),
  `onClaim`, the light and dark palettes (`themes`), and the spacing and touch-target sizes re-exported
  from `src/layout/tokens.ts`. Hub targets (name tiles, chore rows) are at least `hubTouchTarget` (48,
  the `s8` step) square and sit at least `minTargetGap` (8, the `s2` step) apart; the compact
  `groupGap` is therefore 8. `src/theme/contrast.test.ts` checks every claim colour with the WCAG 2.1
  formula in `src/theme/contrast.ts`: each light variant >= 3:1 on the light bg and surface, each
  dark variant >= 3:1 on the dark bg and surface, and on-claim / on-claim-dark text >= 4.5:1 on its
  variant (ADR-0010). The hub's rendered palette still lives in `Screen.tsx`.
- **Fit model.** `measureHubBoard(layout, { people, todayRowsByPerson, weekRowsByPerson })` sums page
  padding, the chrome row (44), zone gaps, header, tile rows and the Today panel (frame, heading, day
  labels, person groups chunked by column, rows). Fixed boxes render as `minHeight` over single-line
  content and spacing is `gap` only, so the model matches the render. A 4-person household with 8
  chores due today models 682px at compact (budget 800) and 794px at roomy (budget 1200).
- **Outside the budget:** the signed-in organizer bar or its PIN pad, `LastKnownBanner`, the
  `SyncIndicator` detail rows, and the board's clock notice. A board over budget scrolls inside the
  Today panel; there is no automatic paging.

## Project structure

Application code lives under `src/`, layered so later capability tickets have a clear home:

```
App.tsx                     # thin composition root: providers + navigation
src/
  api/        config.ts     # typed API base config (env-driven, dev default) + AuthConfig (T4)
              client.ts     # typed fetch client (ApiClient) - the data-access seam; one credential per request: organizer bearer or X-Device-Token (T4, #105)
              useApiClient.ts # hook that binds the client to the base URL, the organizer token, the device token and clearSession
              models.ts     # typed request/response shapes for the H1-H4 endpoints
              errors.ts     # describeApiError: an ApiError -> one readable line; friendlyApiError: fixed friendly line, never server text (P8); isPreconditionFailed (412)
  auth/       OrganizerGate.tsx    # gates children behind an authenticated organizer (probes /me)
              authProvider.ts     # IAuthProvider seam: OrganizerIdentity/OrganizerSession (T4)
              createAuthProvider.ts # config-driven provider selection (dev, Entra, or PIN) (T4, #105)
              devAuthProvider.ts  # dev-mode provider - the deterministic F6 dev organizer, no token (T4)
              entraAuthProvider.ts # Entra External ID OIDC/PKCE provider - the v1 IAuthProvider (T4)
              pinAuthProvider.ts  # demo PIN provider - POST /auth/pin/sign-in, short-lived bearer (#105)
              PinPad.tsx          # organizer PIN pad (digits, backspace, 4-6 digit submit, masked) (#105)
              OrganizerBar.tsx    # hub control strip: sign in/out + gated sensitive affordances (T4)
              HubPairing.tsx      # organizer-only "pair this tablet" affordance (T5)
  components/ Screen.tsx     # shared layout primitives
              FormControls.tsx # shared organizer form controls: Field, ActionButton, Chip (#112)
              WidgetState.tsx # shared load states: WidgetSkeleton, WidgetEmpty, WidgetError with Try again (P8, #117)
              TodayPanel.tsx # bounded "today" container; glows in the active participant's claim colour (T3)
              ChoreBoard.tsx # today/this-week chore board with tap-to-complete/undo, fills TodayPanel (Epic 40 C5/C7)
              ChoreCelebration.tsx # completion check in the claim colour + "Nice work.", animated <= 1000 ms or static under reduced motion (#119)
              FairnessView.tsx # contribution-balance view, rendered below TodayPanel in HubShell (Epic 40 C6)
              GroceryCart.tsx # hub grocery region: add by typing or voice, review the cart, organizer-only confirm (Epic 50 G5, #116)
              OrderReceipt.tsx # order receipt shown in place of the hub body after a successful confirm (#115)
              LastKnownBanner.tsx # "showing last-known" indication when a region is served from cache (O2)
              SyncIndicator.tsx # hub-header sync state: online/offline, pending count, synced, failed writes (O4)
  navigation/ RootNavigator.tsx  # navigation graph
  screens/    HubShell.tsx  # the always-on hub shell (shown once a household is selected)
              HouseholdSetup.tsx       # organizer onboarding wizard (H5)
              HouseholdSetupScreen.tsx # onboarding route = OrganizerGate + HouseholdSetup
              HouseholdEditor.tsx      # organizer room/chore editor: list, add, rename, edit, deactivate, remove (#112)
              HouseholdScreen.tsx      # Household route = OrganizerGate + HouseholdEditor (#112)
  setup/      starterChoreTemplates.json # versioned starter-chore catalog: 30 templates across 9 rooms with aliases (#111)
              starterTemplates.ts # catalog types, room-name/alias matching, template -> CreateChoreRequest (#111)
  offline/    storage.ts    # shared, feature-detected Web Storage seam both offline modules persist through, plus the queue's session-memory fallback (O2/O3)
              glanceCache.ts # last-known glance read cache in browser storage, keyed by householdId (O2)
              useReconnect.ts # `online`-event signal that refetches a degraded surface; no-op off web (O2)
              weekIso.ts    # client-side ISO year-week helpers (isCurrentWeek) guarding a write from a stale cached board (O3)
              writeQueue.ts # durable local write queue + drain/replay-on-reconnect, keyed by householdId (O3)
              useWriteQueue.ts # React seam over the write queue: hydrate, drain on mount/reconnect/backoff, enqueue (O3)
              WriteQueueContext.tsx # WriteQueueProvider: the one queue per household, shared by board and indicator (O4)
              useBrowserOnline.ts # navigator.onLine + online/offline events; inert off web (O4)
  motion/     useReducedMotion.ts # prefers-reduced-motion via AccessibilityInfo; starts reduced until the platform answers (ADR-0006, #119)
  voice/      speechRecognition.ts # feature-detected browser SpeechRecognition / webkitSpeechRecognition + local Web Speech types (#116)
              useSpeechCapture.ts # one-utterance recognition hook behind the grocery mic: supported, listening, start(handlers) (#116)
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
`HubShell` (T2), and the `Household` route (the organizer's room and chore editor, #112). `Home` is a
small wrapper that passes `HubShell` an `onEditHousehold` handler navigating to `Household`, so
`HubShell` itself never needs a navigation context. Add a screen under `src/screens`, then register it in `RootNavigator` and extend
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
a bounded, dumb container - it renders whatever children it is given and, given an
`activeParticipant`, accents itself in that person's colour - and `HubShell` fills it with
`ChoreBoard` (Epic 40 C5) once a household is ready. The shell also hands it a `state` (its own load
phase, or `ready` when no household is selected) and an `onRetry`: `loading` renders a calm skeleton,
`error` a friendly line with a `Try again` that re-reads the household and roster, and `ready` with no
children a designed empty state ("Ready when you are.").

**Widget load states (P8, #117).** `TodayPanel`, `ChoreBoard`, `FairnessView` and `GroceryCart` render
their load states through the shared `src/components/WidgetState.tsx` (ADR-0007): `WidgetSkeleton`
(static bars plus a muted caption, never a blank panel), `WidgetEmpty` (a title plus a small detail
line), and `WidgetError` (a circled `!` in the danger colour plus friendly text, never the raw API
text, and a `Try again` button). Each widget keeps its copy in a module `COPY` const. `Try again` is an
event handler that sets the loading phase and bumps a revision counter listed in the load effect's
dependencies, so the widget re-requests its data. Retry is manual only; automatic retry is #109.

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
matching C4/C7's idempotent complete/undo. A completing tap also celebrates (#119): the row shows
`ChoreCelebration`, a check in the participant's claim colour plus "Nice work." in ink, which fades and
scales in and out within `CELEBRATION_DURATION_MS` (900 ms, from the motion tokens) or renders
statically when `useReducedMotion` reports prefers-reduced-motion. A board timer, not the animation,
ends it; an undo or a refused completion ends it early. It is a plain child of the row, so the same
tap still undoes and other rows still take taps while it plays.

**The fairness view** (`src/components/FairnessView.tsx`, Epic 40 C6) is journey 6.3's contribution
balance - a read-only glance at the Section 10 fairness guardrail, rendered by `HubShell` below
`TodayPanel` once a household is ready. On mount it reads the C6 aggregate
(`GET /households/{householdId}/fairness`, optionally with a `windowWeeks` query param) through the
typed API client and renders a labelled bar per person sized to their share of the household's
completed effort, with the top contributor's row emphasised. There is no write. Every load outcome is
a calm, deliberate state under the same heading: a skeleton, a friendly error with `Try again`, a
"Nothing to weigh yet." empty state when the household total is zero, or the ready distribution - the
wall never shows a crash or a blank region. A person's bar accents in their claim colour when supplied via the `people` prop
(`{ personId, claimColor }[]`, sourced from the roster `HubShell` already holds); otherwise it falls
back to the neutral brass accent.

**The grocery cart** (`src/components/GroceryCart.tsx`, Epic 50 G5) is journey 6.4's whole
"add oat milk -> review -> confirm" gesture, rendered by `HubShell` as its own bounded region between
`TodayPanel` and the fairness balance. It owns no data and composes three API surfaces through the
typed client:

- **Review (G2).** On mount it reads `GET /households/{householdId}/carts/current`, which hands back
  the week's single `Building` cart with its items and its `eTag`. Each line renders its `DisplayName`
  and `Quantity`, and a custom line (`isCustom`) also carries a `Custom` tag. Under a non-empty list the
  region shows `Estimated total $X.XX` (the API's `estimatedTotal`), and when `customItemCount` is above
  zero a note such as `Plus 1 custom item, not priced.` - on a confirmed cart too. A week whose cart is already confirmed answers `409`, which the region treats as a
  calm confirmed state rather than an error. While it loads the region shows a skeleton; an empty
  building cart shows "The list is clear."; any other failed read shows a friendly line with a
  `Try again` that re-reads the cart (P8).
- **Add (G3).** Typing a term and submitting (the Add button and the keyboard's return are the same
  gesture) POSTs to `/capture/text` with `{ utterance, personId, weekIso, quantity: 1 }`, then re-reads
  the cart so the rendered list and the `eTag` are always the server's truth - adding the same product
  twice increments its quantity server-side. Adding is deliberately open to anyone on the roster: no
  password, no organizer (decision D-3). The line is attributed to the hub's active tap-to-claim
  participant, so with nobody claimed the region says "Tap your name first" instead of spending a round
  trip on a `400`. An ambiguous term renders the problem's `suggestions` candidates with a next step.
  A no-match is a `200` with outcome `NoMatch` (#113): the region keeps the term and offers
  `Add "<term>" as a custom item` (`grocery-add-custom`). Tapping it POSTs
  `/carts/{weekIso}/items` with `{ displayName, personId, quantity: 1 }`, then re-reads the cart; a
  failure shows the readable error and keeps the offer to retry, and any new add withdraws a stale
  offer. No outcome is ever a silent failure.
- **Voice (#116).** Where the browser exposes speech recognition (`SpeechRecognition`, else
  `webkitSpeechRecognition`, feature-detected through `src/voice/` rather than switched on
  `Platform.OS`), a `Speak` button (`grocery-voice`) sits beside Add; with no recognizer (native,
  Firefox, Jest) it is absent, not disabled. A tap listens for one utterance (`continuous` and
  `interimResults` off, one alternative, `en-US`); the button reads `Listening...` and is disabled until
  recognition ends, and recognition stops after the first result. The transcript is shown
  (`Heard "<transcript>"`) and sent straight away, with no confirm tap, to `/capture/voice` with the same
  body as a typed add. The API's normalizer strips fillers such as "please add" and "to the list", so
  the UI only trims it. The answer is handled exactly as a typed add's is (added and re-read,
  suggestions, or the custom-item offer), except that a spoken add leaves the text field alone. A
  recognition error, no match, an empty transcript, or a session that ends with nothing heard posts
  nothing and says `I did not catch that. Tap Speak to try again, or type it.`, and the cart stays usable.
  Chrome grants the mic only in a secure context, so over plain `http://` on the LAN the tap lands in that
  miss path.
- **Confirm (G4).** The `Confirm order` action renders **only** for a signed-in organizer (T4) -
  absent, not disabled, matching the `OrganizerBar` convention - and POSTs to
  `/carts/{weekIso}/confirm` with the cart's `eTag` as `If-Match` (Contract 7.3), so a line added since
  the review comes back `412` with a re-read-and-try-again message rather than a silent no-op. On
  success the region reads as `Confirmed` and offers neither adding nor confirming again. As
  everywhere else in the hub, hiding the control is convenience: the API independently enforces `403`
  for a participant or the paired hub device. The `OrganizerBar`'s Confirm order jumps to this button
  (through `GroceryCart`'s `confirmRef`); it never confirms on its own.
- **Receipt (#115).** A successful confirm also hands the confirm response to `HubShell` (through
  `GroceryCart`'s optional `onConfirmed`), which shows `OrderReceipt` in place of the whole hub body
  until it is dismissed. The receipt is built only from that response and the roster: each line with
  its quantity, who added it (roster name, or "someone"), a `Custom` tag on custom lines, the store
  name from the lines' `sourceConnector` through a display table (`simulated-heb` -> `H-E-B`; never
  hard-coded in the copy), the API's `estimatedTotal` and `customItemCount` (never recomputed on the
  client), and a plain line that no money has moved and the order is ready to hand off to the store.
  It is in-shell state, not a navigation route, and is not persisted. `Back to the hub` clears it,
  which remounts the hub body, so the cart re-reads the week (now a calm `409` "week confirmed").

**Demo path (fully offline of any real store).** The backing connector is the simulated G1
`SimulatedHebConnector` and its fixture catalog, so the end-to-end path needs no store account and no
network beyond the local API: tap a name to claim it -> type `oat milk` -> the cart shows
`H-E-B Oat Milk` x1 -> an organizer signs in through `OrganizerBar` -> `Confirm order` -> the hub
shows the order receipt (lines, who added them, `Store: H-E-B`, the estimated total) -> `Back to the
hub` -> the cart reads as this week's confirmed list. **No real order is placed and no money moves** (BRD decision D-8); the confirm
records intent only.

**Organizer onboarding** (`src/screens/HouseholdSetup.tsx`, H5) is a multi-step wizard - create
household, add rooms, add people (each with a child flag and claim colour), map starter chores to
rooms - driven entirely through the typed API client. The claim colour is one of the six token
claim colours (`claimColors`, swatch `claim-color-<name>`), stored as its dark-variant hex because
the hub is dark-only (#120); a colour stored before that renders unchanged. Each step POSTs to its H1-H4 endpoint. While a
request is in flight the flow shows a step-specific loading line (`setup-loading`); a failed request
shows a friendly line from `friendlyApiError` (never the server's detail or title) with a `Try again`
that re-sends the current form (or the remaining starter-chore selection), and does not advance (P8).
The client's own validation messages show no retry. The
chores step also offers starter chores (#111) from the versioned catalog in
`src/setup/starterChoreTemplates.json`: a created room whose name equals a catalog room's name or
one of its aliases (trimmed, case-insensitive, exact - so `Bath` matches Bathroom but `Den` matches
nothing) lists that room's templates as toggles, off by default, and an unmatched room lists none.
"Add selected" POSTs each selected template to the chores endpoint one at a time, in room then
catalog order, stopping on the first failure with the failed and untried ones left selected. The new
`householdId` is published to `HouseholdContext` on completion. The flow is wrapped in
`OrganizerGate` (`src/auth/OrganizerGate.tsx`), which probes the organizer-only `GET /me` (the F6
auth seam) so only an authenticated organizer reaches it; the Entra sign-in UI itself is a later
ticket.

**Organizer sign-in** (`src/auth/`, `src/state/OrganizerContext.tsx`, T4) is the client side of
Engineering Contract 7.4: the organizer is the product's only authenticated user, and sign-in flows
through an IdP-agnostic `IAuthProvider` seam (`src/auth/authProvider.ts`) rather than any Entra-specific
SDK, mirroring the server's generic `AddJwtBearer` and the `IStoreConnector` philosophy. `createAuthProvider`
(`src/auth/createAuthProvider.ts`) selects the concrete provider from `AuthConfig`
(`src/api/config.ts`) by `EXPO_PUBLIC_AUTH_PROVIDER` (`dev`, `entra` or `pin`; when unset it falls back
to `EXPO_PUBLIC_DISABLE_AUTH`, which defaults to dev). `dev` builds `devAuthProvider.ts`'s deterministic
dev organizer (matching the API's `DevOrganizerSubject`/`DevOrganizerName`, no token, no live tenant
needed); `entra` builds `entraAuthProvider.ts`'s standard OIDC Authorization Code + PKCE flow against
`EXPO_PUBLIC_AUTH_AUTHORITY`, `EXPO_PUBLIC_AUTH_CLIENT_ID`, `EXPO_PUBLIC_AUTH_REDIRECT_URI`, and
`EXPO_PUBLIC_AUTH_SCOPES` (space separated, defaults to `openid profile`); `pin` (the demo stack, #105)
builds `pinAuthProvider.ts`, which posts the PIN typed on `PinPad.tsx` to `POST /auth/pin/sign-in` and
keeps the short-lived token in memory (a reload signs the organizer out). `OrganizerProvider` (wrapping
the app in `App.tsx`, above `HouseholdProvider`) holds the resulting `OrganizerSession` and exposes it
through `useOrganizer()` as `{ organizer, token, isSignedIn, signIn, signOut, clearSession, providerKind }`.
`useApiClient()` hands the client (`src/api/client.ts`) exactly one credential per request: the organizer
token as `Authorization: Bearer` when signed in, otherwise the paired hub's device token on
`X-Device-Token` (never as a bearer), otherwise none, so participant reads stay unauthenticated. When the
API answers a request that carried the organizer bearer with `401` (the PIN token expired after 15 idle
minutes), the client calls `clearSession` and retries that request once on `X-Device-Token`, so a paired
hub drops to participant-only mode without an error. With the PIN provider, `OrganizerGate` shows the
`PinPad` when `/me` is `401`/`403`, and `OrganizerBar`'s sign-in button opens it inline. `OrganizerBar` (rendered at the top of `HubShell`) offers only a sign-in button with no
organizer signed in; once signed in it shows the organizer's name, sign-out, and the sensitive-action
affordances - hidden entirely rather than merely disabled, so a participant is never presented them.
Each affordance renders only when `HubShell` supplies its handler, so the bar never shows a button that
does nothing. Today that is Household (#112), which opens the Household editor through the handler
`RootNavigator` passes to `HubShell`, and Confirm order, which scrolls the hub to `GroceryCart` and focuses the
cart's own Confirm order button through `confirmRef` (the final tap stays in the cart, G4). Edit roster
is #167 and Household teardown is #168; until they land, `HubShell` does not pass those handlers. This is defense-in-depth only: the API enforces the
`Organizer` policy server-side (F6, T5); a hidden affordance is convenience, not the security boundary.
Organizer auth and the active tap-to-claim participant are independent - signing in or out never
disturbs the other.

**Household editor** (`src/screens/HouseholdEditor.tsx`, #112) is the organizer's after-setup editor for
rooms and chores, behind `OrganizerGate` (`HouseholdScreen.tsx`). It reads `GET /households/{id}/rooms` and
`GET /households/{id}/chores` (all chores, active or not) together and lists each room with its chores;
chores whose room is gone sit under "Not in a room". One editor is open at a time. Every write goes through
the typed client and, on success, replaces the item with the response body, so the next edit carries that
item's fresh `eTag` (the API's `ETag` member serializes as `eTag`, as `RoomResponse`/`ChoreResponse` now
declare). Renames and chore edits are PUTs under `If-Match`; a `412` shows a reload prompt that re-reads
both lists and closes the editor without re-sending the edit (`isPreconditionFailed`). Any other failure
shows the problem-details message and leaves the list as it was. Deactivate and room DELETE carry no
`If-Match`. Removing a room is refused on the client while it has active chores (the server DELETE does not
check). This list/edit/If-Match/412 shape is the pattern for the roster editor (#167).

**Hub device pairing** (`src/auth/HubPairing.tsx`, `src/state/HubDeviceContext.tsx`, T5) makes the
shared tablet itself a long-lived, household-scoped actor rather than an anonymous caller. `HubPairing`
(rendered in `HubShell`, next to `OrganizerBar`) renders only for a signed-in organizer - a participant
never sees it - and calls the organizer-gated `POST /households/{householdId}/hub-devices/pair` endpoint
through the typed API client; the hidden affordance is convenience, not the security boundary, since the
API enforces the `Organizer` policy server-side (T5 API side). A successful pair stores the returned
long-lived device token in `HubDeviceProvider` (wired in `App.tsx`, alongside `OrganizerProvider` and
`HouseholdProvider`) via `useHubDevice()`'s `setDeviceToken`; the token lives in memory for the process
lifetime, mirroring the other hub session state. The API client presents it on the `X-Device-Token`
header whenever no organizer is signed in (#105).

**API base URL** comes from `src/api/config.ts`: it reads `EXPO_PUBLIC_API_BASE_URL` (inlined by Expo
at build time) and falls back to `http://localhost:5108` for local dev. The base may be absolute or a
same-origin relative base: the demo stack builds with `/api` (Caddy serves the hub and proxies `/api/*`
to the API on one origin, see `demo/README.md`), and `apiUrl` then yields relative URLs such as
`/api/households`. Use `apiUrl(path)` to build request URLs.

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
