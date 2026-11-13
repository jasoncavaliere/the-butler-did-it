import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiClient, ApiError } from '../api/client';
import { describeApiError } from '../api/errors';
import type {
  HouseholdResponse,
  ParticipantSessionResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HubPairing } from '../auth/HubPairing';
import { OrganizerBar } from '../auth/OrganizerBar';
import { ChoreBoard } from '../components/ChoreBoard';
import { FairnessView } from '../components/FairnessView';
import { GroceryCart } from '../components/GroceryCart';
import { LastKnownBanner } from '../components/LastKnownBanner';
import { SyncIndicator } from '../components/SyncIndicator';
import { TodayPanel } from '../components/TodayPanel';
import { colors } from '../components/Screen';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { useReconnectSignal } from '../offline/useReconnect';
import { useWriteQueueContext, WriteQueueProvider } from '../offline/WriteQueueContext';
import { useHousehold } from '../state/HouseholdContext';

/**
 * How long the hub keeps an active participant before clearing back to the
 * neutral glance state (AC: "no interaction for a configured interval"). A single
 * constant so the trade-off - too short annoys, too long leaks the wrong actor
 * into a completion (see the ticket's Risks) - lives in exactly one place. The
 * completion actor is re-read at write time (C4), so this is purely a UI reset.
 */
export const IDLE_TIMEOUT_MS = 45_000;

/**
 * The organizer role string (mirrors the API's
 * `OrganizerAuthorization.OrganizerRole`). Organizers/admins administer the
 * household; they are not chore-doing members, so they are never a claimable tile.
 */
export const ORGANIZER_ROLE = 'Organizer';

/**
 * Whether a roster entry is a chore-doing member (and so a claimable tile) rather
 * than an organizer/admin identity. The API roster read is already filtered to
 * members (`GetRosterQuery` omits organizer-role people, including the synthetic
 * "Development Organizer" dev identity), and those entries carry no `role`. This
 * predicate is the hub's independent second guard: if an organizer-role entry ever
 * reaches the client, it is excluded here so an admin never renders as a name tile.
 */
export function isClaimableMember(person: RosterEntryResponse): boolean {
  return (
    person.role === undefined ||
    person.role.toLowerCase() !== ORGANIZER_ROLE.toLowerCase()
  );
}

/**
 * The slice of a rendered host element that {@link revealAndFocus} touches. On
 * react-native-web a host ref is the DOM node, which has both; React Native's
 * own host types declare neither `scrollIntoView` nor these option arguments, so
 * both are optional and the call site casts to this narrow shape.
 */
export type RevealTarget = {
  scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  focus?: (options?: FocusOptions) => void;
};

/**
 * Bring a control into view and give it keyboard focus. It scrolls first and
 * then focuses with `preventScroll`, because a plain `focus()` jumps instantly
 * and would cancel the smooth scroll. A host without either method (a native
 * platform, or a test double) is skipped quietly rather than throwing.
 */
export function revealAndFocus(node: RevealTarget | null): void {
  node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  node?.focus?.({ preventScroll: true });
}

/**
 * The always-on hub: the shared-device shell the whole product renders inside
 * (BRD 6.2, ADR-0005 three-zone band). It reads the active household from
 * {@link useHousehold} and, through the F7 typed client, loads the household
 * name (H1) and the open tap-to-claim roster (people) to render three regions:
 * a header (household name + today's date), a row of participant name tiles, and
 * a bounded {@link TodayPanel} placeholder that Epic 40 C5 fills with the chore
 * board. It fetches no chores itself - the today panel stays a documented seam.
 *
 * Every load outcome is a calm, deliberate state (loading, ready, no household,
 * or an unreachable service) so the wall never shows a crash or a blank screen.
 * There is no password or sign-in prompt here: participants glance and tap, and
 * organizer sign-in is a separate affordance (T4). Of the organizer's sensitive
 * actions only Confirm order is wired today, and it never confirms anything: it
 * scrolls to the {@link GroceryCart} and focuses the cart's own Confirm button,
 * which keeps the final tap (G4).
 *
 * Offline (Epic 60 O2) the glance survives: each successful load caches the
 * household and its roster, and a load that fails because the API is
 * unreachable renders the real name tiles from that cache instead of the error
 * line. Whenever any region of the hub - these tiles or the board - is served
 * from cache, one {@link LastKnownBanner} says so, and it clears the moment a
 * load succeeds again. While degraded the shell listens for a reconnect
 * ({@link useReconnectSignal}) and reloads itself when the network returns, so
 * the wall recovers on its own - nobody reloads a tablet in a kitchen.
 *
 * The sync state (Epic 60 O4) lives in the header: the shell mounts the one
 * {@link WriteQueueProvider} for the household, so the board's queued taps and
 * the header's {@link SyncIndicator} read the same queue, and the indicator
 * says whether the hub is online, how many writes are waiting, when they have
 * synced, and which ones never went through. It sits in the header's normal
 * flow - no absolute positioning - so it can never cover the name tiles or the
 * board. Any region served from the last-known cache also marks it offline,
 * since that cache only ever stands in when the API did not answer.
 *
 * "Wifi up, API down" never fires the browser's `online` event, so a reconnect
 * alone cannot revive a degraded shell after an API-only outage. A drain that
 * confirms a queued write proves the API answers again, so while degraded the
 * shell also reloads on each such confirmation ({@link QueueRevival}) - the
 * board already refetches on it - and the indicator returns to Online without
 * anyone reloading the tablet.
 */
type LoadState =
  | { phase: 'loading' }
  | {
      phase: 'ready';
      householdName: string;
      people: RosterEntryResponse[];
      /** The cache's freshness stamp when served offline; `null` when live. */
      cachedAtIso: string | null;
    }
  | { phase: 'error'; message: string };

/**
 * Decide what to show when a shell read fails. An unreachable API falls back to
 * the household's cached glance so the tiles stay real and tappable; every other
 * failure (and an outage with no usable cache) keeps the pre-O2 error state, so
 * the cache stands in for the network and nothing else.
 *
 * When only one of the two reads failed, the cached record is still shown whole
 * rather than spliced with the half that arrived: one coherent glance under one
 * freshness stamp is something the "showing last-known" line can describe
 * honestly, and a live name over a cached roster is not.
 */
function resolveShellFailure(householdId: string, error: ApiError): LoadState {
  const cached = error.kind === 'network' ? readGlance(householdId) : null;
  if (cached !== null && cached.household !== null) {
    return {
      phase: 'ready',
      householdName: cached.household.name,
      people: cached.household.people,
      cachedAtIso: cached.cachedAtIso,
    };
  }
  return { phase: 'error', message: describeApiError(error) };
}

/** Today's date, formatted for a glance ("Monday, July 20"). */
function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function HubShell({ idleTimeoutMs = IDLE_TIMEOUT_MS }: { idleTimeoutMs?: number }) {
  const client = useApiClient();
  const { householdId } = useHousehold();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  // The active participant is UI state only: the person a tap claimed, holding
  // the T1 session (incl. its token) that Epic 40 C4 attributes completions to.
  // It is never persisted as a credential and never sent to organizer endpoints.
  const [activeParticipant, setActiveParticipant] = useState<ParticipantSessionResponse | null>(
    null,
  );

  // Degraded = the shell is showing the cached glance, or has nothing to show at
  // all. Only then does it listen for a reconnect, and the returned counter is a
  // load dependency - so the network coming back reloads the hub, refreshes the
  // cache, and clears the last-known indication (AC-4/AC-5) without a reload.
  const shellDegraded =
    state.phase === 'error' || (state.phase === 'ready' && state.cachedAtIso !== null);
  const reconnectSignal = useReconnectSignal(shellDegraded);
  // The same revival when a queued write gets through instead (an API-only
  // outage, where no `online` event ever fires). Bumped only while degraded, so
  // a live hub does no extra reads after a sync.
  const [queueSignal, setQueueSignal] = useState(0);
  const handleQueueConfirmed = useCallback(() => setQueueSignal((previous) => previous + 1), []);

  useEffect(() => {
    // Without a selected household there is nothing to load; the "no household"
    // state is derived at render, so the effect never sets state synchronously.
    if (householdId === null) {
      return;
    }

    let active = true;

    Promise.all([
      client.get<HouseholdResponse>(`/households/${householdId}`),
      client.get<RosterEntryResponse[]>(`/households/${householdId}/people`),
    ]).then(([householdResult, peopleResult]) => {
      if (!active) {
        return;
      }
      if (!householdResult.ok) {
        setState(resolveShellFailure(householdId, householdResult.error));
        return;
      }
      if (!peopleResult.ok) {
        setState(resolveShellFailure(householdId, peopleResult.error));
        return;
      }
      const people = peopleResult.data ?? [];
      setState({
        phase: 'ready',
        householdName: householdResult.data.name,
        people,
        cachedAtIso: null,
      });
      // Refresh the cache (and its freshness stamp) on every successful load, so
      // the next outage - and the reconnect after it - always shows the newest
      // household the hub has actually seen.
      writeGlance(householdId, { household: { name: householdResult.data.name, people } });
    });

    return () => {
      active = false;
    };
    // `reconnectSignal` bumps when the network returns while degraded, and
    // `queueSignal` when a queued write is confirmed while degraded - either is
    // what makes the hub reload itself rather than sitting on last-known data.
  }, [client, householdId, reconnectSignal, queueSignal]);

  // Tapping a name claims that person through T1 and makes them active. There is
  // no password/PIN step: a successful claim sets the session, a switch (tapping
  // a different tile, or the active tile again) re-claims and moves the glow. A
  // failed claim leaves the current state untouched - the wall stays calm.
  const claim = useCallback(
    async (household: string, personId: string) => {
      const result = await claimParticipant(client, household, personId);
      if (!result.ok) {
        return;
      }
      setActiveParticipant(result.data);
    },
    [client],
  );

  // Idle reset: while a participant is active, no interaction for the configured
  // interval clears back to the neutral glance. Each claim yields a fresh session
  // object, so this effect re-arms (its cleanup clears the prior timer) on every
  // tap and on unmount.
  useEffect(() => {
    if (activeParticipant === null) {
      return undefined;
    }
    const timer = setTimeout(() => setActiveParticipant(null), idleTimeoutMs);
    return () => clearTimeout(timer);
  }, [activeParticipant, idleTimeoutMs]);

  // The board reports whether it is serving the last-known week (O2). Stable
  // across renders so it never re-triggers the board's load effect.
  const [boardCachedAtIso, setBoardCachedAtIso] = useState<string | null>(null);
  const handleBoardLastKnown = useCallback(
    (cachedAtIso: string | null) => setBoardCachedAtIso(cachedAtIso),
    [],
  );

  // OrganizerBar's Confirm order (#57) only moves the organizer to the cart: it
  // scrolls the grocery region into view and focuses the cart's own Confirm
  // button, which still owns the confirm. When the cart has no Confirm to focus
  // (no building cart, or the week is already confirmed) it just reveals the
  // region, since a plain View is not focusable on web. Refs are stable, so the
  // handler is too.
  const cartConfirmRef = useRef<ComponentRef<typeof View>>(null);
  const groceriesRef = useRef<ComponentRef<typeof View>>(null);
  const handleConfirmOrder = useCallback(() => {
    const confirmButton = cartConfirmRef.current as unknown as RevealTarget | null;
    if (confirmButton) {
      revealAndFocus(confirmButton);
      return;
    }
    const groceries = groceriesRef.current as unknown as RevealTarget | null;
    groceries?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, []);

  // A missing household is a calm derived state, not a fetch outcome.
  const view: LoadState =
    householdId === null ? { phase: 'error', message: 'No household is set up yet.' } : state;
  const householdName = view.phase === 'ready' ? view.householdName : 'Butler';
  // The claimable roster is chore-doing members only: an organizer/admin identity
  // (including the synthetic "Development Organizer") is never a tile, never fed to
  // the board, and never counted in the fairness balance. This mirrors the API's
  // already-filtered roster read and holds the line even if one ever slips through.
  const members: RosterEntryResponse[] = view.phase === 'ready' ? view.people.filter(isClaimableMember) : [];
  // One last-known indication for the whole hub: the tiles' own stamp when the
  // shell fell back, otherwise the board's when only it did. Either way it
  // clears as soon as both are live again.
  const lastKnownAtIso: string | null =
    view.phase === 'ready' ? view.cachedAtIso ?? boardCachedAtIso : null;

  const content = (
    <View style={styles.hub} testID="hub-shell">
      {householdId !== null ? (
        <QueueRevival enabled={shellDegraded} onConfirmed={handleQueueConfirmed} />
      ) : null}
      {/* Only Confirm order is wired. Edit roster (#167) and Household teardown
          (#168) are deliberately not passed, so OrganizerBar does not render them. */}
      <OrganizerBar onConfirmOrder={handleConfirmOrder} />
      <HubPairing />
      <View style={styles.header} testID="hub-header">
        <Text style={styles.householdName} accessibilityRole="header" testID="hub-household-name">
          {householdName}
        </Text>
        <View style={styles.headerStatus}>
          <Text style={styles.date} testID="hub-date">
            {todayLabel()}
          </Text>
          {householdId !== null ? <SyncIndicator apiUnreachable={lastKnownAtIso !== null} /> : null}
        </View>
      </View>

      {lastKnownAtIso !== null ? <LastKnownBanner cachedAtIso={lastKnownAtIso} /> : null}

      <View style={styles.tiles} testID="hub-name-tiles">
        {view.phase === 'loading' && (
          <View style={styles.centeredRow} testID="hub-loading">
            <ActivityIndicator color={colors.brass} />
            <Text style={styles.status}>Waking up the hub...</Text>
          </View>
        )}

        {view.phase === 'error' && (
          <Text style={styles.status} testID="hub-error">
            {view.message}
          </Text>
        )}

        {view.phase === 'ready' &&
          (members.length === 0 ? (
            <Text style={styles.status} testID="hub-no-people">
              No one has been added to this household yet.
            </Text>
          ) : (
            members.map((person) => (
              <NameTile
                key={person.personId}
                person={person}
                isActive={activeParticipant?.personId === person.personId}
                // A `ready` view is only derived when a household is selected
                // (a null household forces the error state), so this is non-null.
                onPress={() => claim(householdId as string, person.personId)}
              />
            ))
          ))}
      </View>

      <TodayPanel activeParticipant={activeParticipant}>
        {view.phase === 'ready' && householdId !== null ? (
          <ChoreBoard
            householdId={householdId}
            people={members}
            activePersonId={activeParticipant?.personId ?? null}
            onLastKnown={handleBoardLastKnown}
          />
        ) : null}
      </TodayPanel>

      {view.phase === 'ready' && householdId !== null ? (
        <View ref={groceriesRef} style={styles.panel} testID="hub-groceries">
          <GroceryCart
            householdId={householdId}
            activePersonId={activeParticipant?.personId ?? null}
            confirmRef={cartConfirmRef}
          />
        </View>
      ) : null}

      {view.phase === 'ready' && householdId !== null ? (
        <View style={styles.panel} testID="hub-balance">
          <FairnessView householdId={householdId} people={members} />
        </View>
      ) : null}
    </View>
  );

  // One queue per household, shared by the board and the header indicator. With
  // no household there is nothing to queue, so there is no provider either.
  return householdId === null ? (
    content
  ) : (
    <WriteQueueProvider householdId={householdId} client={client}>
      {content}
    </WriteQueueProvider>
  );
}

/**
 * Reports each drain run that confirmed a queued write, while `enabled` (the
 * shell is degraded). A confirmation is proof the API answers again, which the
 * browser's `online` event cannot give when only the API was down. It renders
 * nothing; it exists because the shell mounts the {@link WriteQueueProvider} and
 * so cannot read the queue itself. Starting from the current revision means a
 * mount (or a switch into the degraded state) never reports an old confirmation.
 */
function QueueRevival({ enabled, onConfirmed }: { enabled: boolean; onConfirmed: () => void }) {
  const { confirmedRevision } = useWriteQueueContext();
  const seen = useRef(confirmedRevision);
  useEffect(() => {
    if (confirmedRevision === seen.current) {
      return;
    }
    seen.current = confirmedRevision;
    if (enabled) {
      onConfirmed();
    }
  }, [confirmedRevision, enabled, onConfirmed]);
  return null;
}

/**
 * Claim a person through the T1 endpoint
 * (`POST /households/{householdId}/people/{personId}/claim`). No password or PIN
 * is ever involved; the empty POST body is deliberate. Returns the normalized
 * {@link ApiResult} so the caller decides what to do with success vs. failure.
 */
function claimParticipant(client: ApiClient, householdId: string, personId: string) {
  return client.update<ParticipantSessionResponse>(
    `/households/${householdId}/people/${personId}/claim`,
    {},
    { method: 'POST' },
  );
}

/**
 * A participant's name tile: a large, glanceable, tappable card accented by the
 * person's claim colour. Tapping it claims the person (T3); when that person is
 * the active participant the tile glows in their colour ("what's mine glows").
 */
function NameTile({
  person,
  isActive,
  onPress,
}: {
  person: RosterEntryResponse;
  isActive: boolean;
  onPress: () => void;
}) {
  const accent = person.claimColor ?? colors.brass;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      style={[styles.tile, { borderColor: accent }, isActive && { backgroundColor: accent }]}
      testID={`name-tile-${person.personId}`}
    >
      <View style={[styles.tileDot, { backgroundColor: accent }]} />
      <Text style={[styles.tileName, isActive && styles.tileNameActive]} numberOfLines={1}>
        {person.displayName}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hub: { flex: 1, backgroundColor: colors.page, padding: 32, gap: 24 },
  // Shared card shell for the bounded regions below the today panel (groceries,
  // the fairness balance).
  panel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  householdName: { color: colors.ink, fontSize: 40, fontWeight: '700' },
  // The date and the sync indicator share the header's right-hand side, in flow.
  headerStatus: { alignItems: 'flex-end', gap: 8 },
  date: { color: colors.muted, fontSize: 22 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, minHeight: 96 },
  centeredRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { color: colors.muted, fontSize: 20 },
  tile: {
    minWidth: 160,
    minHeight: 88,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 2,
    paddingVertical: 16,
    paddingHorizontal: 20,
    justifyContent: 'center',
    gap: 10,
  },
  tileDot: { width: 20, height: 20, borderRadius: 10 },
  tileName: { color: colors.ink, fontSize: 24, fontWeight: '600' },
  // Active tile glows: its own colour fills the card, so the name flips to the
  // dark page ink for contrast against the accent.
  tileNameActive: { color: colors.page },
});
