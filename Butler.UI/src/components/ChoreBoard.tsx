import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiResult } from '../api/client';
import type {
  AssignmentSetResponse,
  ChoreResponse,
  CompleteChoreResponse,
  RosterEntryResponse,
  UndoChoreResponse,
} from '../api/models';
import { describeApiError } from '../api/errors';
import { useApiClient } from '../api/useApiClient';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { useReconnectSignal } from '../offline/useReconnect';
import { colors } from './Screen';

/**
 * The hub chore board (Epic 40 C5): the visible payoff of the wedge (journey
 * 6.2). It fills the {@link TodayPanel} seam with the current week's assignments
 * and lets a tap mark one done.
 *
 * It sources the week from the F7 typed client:
 * - the assignment set from C3 (`POST .../assignments/generate` with an empty
 *   body) - the only surface that returns an {@link AssignmentSetResponse}, and
 *   a deterministic, `Done`-preserving regenerate, so re-reading it to render is
 *   safe;
 * - each assignment's title + cadence from the open Chores read (H2), joined by
 *   `choreId` (the C3 projection carries no title);
 * - the person display name + claim colour from the roster the shell already
 *   loaded, passed in as {@link people}.
 *
 * The items are grouped into the panel's two day buckets - daily-cadence chores
 * under "Today", weekly-cadence under "This week" - and within each bucket by
 * person, in roster order. When a participant is active (T3), the board *focuses*
 * on them - it renders only that person's assignments, answering "what's mine
 * right now" (their items still glow in their claim colour). With no active
 * participant the board falls back to the full read-only household glance for
 * everyone (a tap cannot attribute a completion, so it does nothing). Switching
 * the active participant re-focuses on the newly selected person, and the T3
 * idle-timeout clearing the selection restores the full-household view - all
 * without any refetch, since it is a pure derived-render change over the loaded
 * week. A tap on an open item completes it through C4 with an optimistic flip to
 * `Done`; a tap on a `Done` item undoes that completion with an optimistic flip
 * back to `Open`. Both reconcile to the response status and revert on error, so a
 * mis-tap in either direction is recoverable without leaving the board lying about
 * the server.
 *
 * Offline (Epic 60 O2), the read path falls back to the last-known week: every
 * successful load caches the built week, and a load that fails *because the API
 * is unreachable* renders those cached items through this same board instead of
 * the error line, reporting the cache's freshness stamp up to the shell so the
 * hub can mark the view as last-known. Only a `network` failure falls back - an
 * HTTP/problem/parse error is a real answer from a reachable service and still
 * shows as an error.
 *
 * A board served from cache is **read-only**, and it comes back to life by
 * itself:
 * - read-only, because a cached row carries the *cached* `weekIso` and the API
 *   resolves a completion by `(householdId, weekIso, choreId)` with no
 *   current-week check. Left tappable, a tap taken after an outage that spanned a
 *   week boundary would post a completion into the stale week and *succeed* -
 *   marking last week done while this week's chore stays open. O2 is a read
 *   cache; queuing an offline tap is O3's job, so until then the honest
 *   behaviour is that the last-known board is a display, not a control.
 * - self-reviving, because the hub lives on a wall and nobody reloads it. While
 *   degraded the board listens for a reconnect ({@link useReconnectSignal}) and
 *   refetches when the network returns, which is what turns the cached board back
 *   into a live, tappable one and re-stamps the cache.
 */

/** A rendered board item: an assignment joined to its chore and lifecycle state. */
type BoardItem = {
  choreId: string;
  title: string;
  cadence: string;
  assignedPersonId: string;
  status: 'Open' | 'Done';
};

type Phase = 'loading' | 'ready' | 'error';

/** The two day buckets the panel presents, in order. */
const DAY_BUCKETS = [
  { key: 'today', label: 'Today', daily: true },
  { key: 'this-week', label: 'This week', daily: false },
] as const;

function isDaily(cadence: string): boolean {
  return cadence.toLowerCase() === 'daily';
}

/** A read that did not produce a board, and whether the API was unreachable. */
export type LoadFailure = { message: string; offline: boolean };

/**
 * Describe one of the board's failed reads: the line to show, and whether the
 * API was unreachable. Only the client's normalized `network` error means
 * "unreachable", which is the single case the last-known cache stands in for -
 * an HTTP/problem/parse error is a real answer from a reachable service, and a
 * result that never arrived carries no error to classify at all.
 */
export function describeFailure(result: ApiResult<unknown> | undefined): LoadFailure {
  if (result && !result.ok) {
    return { message: describeApiError(result.error), offline: result.error.kind === 'network' };
  }
  return { message: 'The board is unavailable.', offline: false };
}

export function ChoreBoard({
  householdId,
  people,
  activePersonId,
  onLastKnown,
}: {
  householdId: string;
  people: RosterEntryResponse[];
  activePersonId: string | null;
  /**
   * Reports whether this board is being served from the offline cache: the
   * record's freshness stamp when it is, `null` when it is live. The shell uses
   * it to show a single "showing last-known" indication for the whole hub
   * instead of one per region.
   */
  onLastKnown?: (cachedAtIso: string | null) => void;
}) {
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [weekIso, setWeekIso] = useState('');
  const [items, setItems] = useState<BoardItem[]>([]);
  // Whether what is on screen came from the offline cache rather than the API.
  // This is what makes the board read-only (see the module docstring): a cached
  // row carries the cached week, so a tap on it could complete the wrong week.
  const [fromCache, setFromCache] = useState(false);

  // Held in a ref so an inline callback from the parent cannot re-trigger the
  // load effect below (which would refetch the week on every render).
  const reportRef = useRef(onLastKnown);
  useEffect(() => {
    reportRef.current = onLastKnown;
  }, [onLastKnown]);

  // Degraded = the last load did not produce live data, whether it fell back to
  // the cache or had nothing to fall back to. Only while degraded does the board
  // listen for a reconnect, so a healthy hub subscribes to nothing; the returned
  // counter is a load dependency, so the network coming back refetches the week.
  const degraded = fromCache || phase === 'error';
  const reconnectSignal = useReconnectSignal(degraded);

  useEffect(() => {
    let active = true;

    Promise.all([
      client.update<AssignmentSetResponse>(
        `/households/${householdId}/assignments/generate`,
        {},
        { method: 'POST' },
      ),
      client.get<ChoreResponse[]>(`/households/${householdId}/chores?active=true`),
    ]).then(([assignments, chores]) => {
      if (!active) {
        return;
      }

      // A failed read falls back to the last-known week when (and only when) the
      // API was unreachable, so the wall keeps showing a real, readable board
      // rather than an error line (BRD 6.5 step 1). With no usable cache it is
      // the pre-O2 error state, unchanged.
      //
      // A partial outage (one of the two reads answered) deliberately falls back
      // to the whole cached record rather than rendering the half that arrived:
      // one coherent week under one freshness stamp is honest, whereas a live
      // assignment set drawn with cached titles - or with none - would be a mix
      // the "showing last-known" line could not describe truthfully.
      const applyFailure = (failure: LoadFailure) => {
        const cached = failure.offline ? readGlance(householdId) : null;
        if (cached !== null && cached.board !== null) {
          setWeekIso(cached.board.weekIso);
          setItems(cached.board.items);
          setFromCache(true);
          setPhase('ready');
          reportRef.current?.(cached.cachedAtIso);
          return;
        }
        setMessage(failure.message);
        setFromCache(false);
        setPhase('error');
        reportRef.current?.(null);
      };

      if (!assignments || !assignments.ok) {
        applyFailure(describeFailure(assignments));
        return;
      }
      if (!chores || !chores.ok) {
        applyFailure(describeFailure(chores));
        return;
      }

      const choreById = new Map((chores.data ?? []).map((chore) => [chore.choreId, chore]));
      const set = assignments.data;
      const built: BoardItem[] = (set?.assignments ?? []).map((assignment) => {
        const chore = choreById.get(assignment.choreId);
        return {
          choreId: assignment.choreId,
          title: chore?.title ?? assignment.choreId,
          cadence: chore?.cadence ?? 'Weekly',
          assignedPersonId: assignment.assignedPersonId,
          status: assignment.status === 'Done' ? 'Done' : 'Open',
        };
      });
      const week = set?.weekIso ?? '';

      setWeekIso(week);
      setItems(built);
      // Live data: the board is tappable again and no longer last-known, which is
      // how a reconnect turns a read-only cached board back into a control.
      setFromCache(false);
      setPhase('ready');
      // Refresh the cache (and its freshness stamp) on every successful load, so
      // the next outage falls back to this week rather than an older one.
      writeGlance(householdId, { board: { weekIso: week, items: built } });
      reportRef.current?.(null);
    });

    return () => {
      active = false;
    };
    // `reconnectSignal` bumps when the network returns while degraded; listing it
    // here is what makes the reconnect refetch (AC-4/AC-5) rather than waiting for
    // someone to reload a tablet nobody touches.
  }, [client, householdId, reconnectSignal]);

  // Tapping an item toggles its completion, attributed to the active participant
  // (T3): an `Open` item completes through C4, a `Done` item undoes that
  // completion. With no active participant the board is read-only, so the tap does
  // nothing. Both directions are optimistic - the flip shows immediately,
  // reconciles to the response status, and reverts to the item's prior state on
  // error (or an unconfirmed/empty response), so a mis-tap either way is
  // recoverable and the board never lies about the server.
  //
  // A board served from the offline cache writes nothing at all. Its `weekIso` is
  // the *cached* week, and the API resolves a completion by
  // `(householdId, weekIso, choreId)` without checking that the week is current -
  // so a tap taken on a cached board after the network returned would land a
  // completion in the stale week and succeed. Refusing the write is the only
  // honest answer until O3 can queue one.
  const toggle = useCallback(
    async (choreId: string) => {
      if (fromCache || activePersonId === null) {
        return;
      }
      const target = items.find((item) => item.choreId === choreId);
      if (!target) {
        return;
      }

      const previous = target.status;
      const optimistic: 'Open' | 'Done' = previous === 'Open' ? 'Done' : 'Open';
      const action = previous === 'Open' ? 'complete' : 'undo';

      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: optimistic } : item)),
      );

      const result = await client.update<CompleteChoreResponse | UndoChoreResponse>(
        `/households/${householdId}/assignments/${weekIso}/${choreId}/${action}`,
        { personId: activePersonId },
        { method: 'POST' },
      );

      if (!result || !result.ok) {
        setItems((prev) =>
          prev.map((item) => (item.choreId === choreId ? { ...item, status: previous } : item)),
        );
        return;
      }

      const reconciled: 'Open' | 'Done' = result.data?.status === 'Done' ? 'Done' : 'Open';
      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: reconciled } : item)),
      );
    },
    [client, householdId, weekIso, activePersonId, items, fromCache],
  );

  if (phase === 'loading') {
    return (
      <View style={styles.centered} testID="chore-board-loading">
        <ActivityIndicator color={colors.brass} />
        <Text style={styles.status}>Setting the board...</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <Text style={styles.status} testID="chore-board-error">
        {message}
      </Text>
    );
  }

  // Focus vs. glance: with an active participant the board narrows to just that
  // person's assignments ("what's mine right now"); with none it shows the whole
  // household read-only. This filters only what is rendered - the loaded `items`
  // (and the completion logic keyed on `choreId`) are untouched, so switching or
  // clearing the active participant re-focuses / restores instantly with no
  // refetch.
  const visibleItems =
    activePersonId === null
      ? items
      : items.filter((item) => item.assignedPersonId === activePersonId);

  if (visibleItems.length === 0) {
    return (
      <Text style={styles.status} testID="chore-board-empty">
        Nothing on the board this week.
      </Text>
    );
  }

  const personIndex = (personId: string): number => {
    const idx = people.findIndex((person) => person.personId === personId);
    return idx === -1 ? people.length : idx;
  };

  return (
    <View style={styles.board} testID="chore-board">
      {DAY_BUCKETS.map((bucket) => {
        const dayItems = visibleItems.filter((item) => isDaily(item.cadence) === bucket.daily);
        if (dayItems.length === 0) {
          return null;
        }

        // The person ids present in this bucket, in roster order.
        const personIds = Array.from(new Set(dayItems.map((item) => item.assignedPersonId))).sort(
          (a, b) => personIndex(a) - personIndex(b),
        );

        return (
          <View key={bucket.key} style={styles.day} testID={`chore-board-day-${bucket.key}`}>
            <Text style={styles.dayLabel} accessibilityRole="header">
              {bucket.label}
            </Text>
            {personIds.map((personId) => {
              const person = people.find((entry) => entry.personId === personId);
              const name = person?.displayName ?? personId;
              const accent = person?.claimColor ?? colors.brass;
              const isActive = personId === activePersonId;
              const personItems = dayItems.filter((item) => item.assignedPersonId === personId);

              return (
                <View
                  key={personId}
                  style={styles.personGroup}
                  testID={`chore-board-person-${bucket.key}-${personId}`}
                >
                  <Text style={[styles.personName, isActive && { color: accent }]}>{name}</Text>
                  {personItems.map((item) => (
                    <ChoreItem
                      key={item.choreId}
                      item={item}
                      accent={accent}
                      glow={isActive}
                      // Read-only when no participant is active, or when the whole
                      // board is the last-known one served from cache (a cached
                      // row must never write - see `toggle`). Otherwise both an
                      // Open item (tap to complete) and a Done item (tap to undo)
                      // are actionable. The tap handler still makes a read-only
                      // press a safe no-op.
                      inert={fromCache || activePersonId === null}
                      onPress={() => toggle(item.choreId)}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/**
 * One tappable chore row. It glows in the person's claim colour when it belongs
 * to the active participant, and reads as a distinct dimmed/checked state once
 * `Done`.
 */
function ChoreItem({
  item,
  accent,
  glow,
  inert,
  onPress,
}: {
  item: BoardItem;
  accent: string;
  glow: boolean;
  inert: boolean;
  onPress: () => void;
}) {
  const done = item.status === 'Done';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: glow, disabled: inert, checked: done }}
      style={[
        styles.item,
        glow && { borderColor: accent, borderWidth: 2 },
        done && styles.itemDone,
      ]}
      testID={`chore-item-${item.choreId}`}
    >
      <Text
        style={[styles.itemMark, done && { color: accent }]}
        testID={`chore-item-mark-${item.choreId}`}
      >
        {done ? '✓' : '○'}
      </Text>
      <Text style={[styles.itemTitle, done && styles.itemTitleDone]} numberOfLines={1}>
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  board: { flex: 1, alignSelf: 'stretch', gap: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  status: { color: colors.muted, fontSize: 20, textAlign: 'center' },
  day: { gap: 10 },
  dayLabel: {
    color: colors.brass,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  personGroup: { gap: 8, marginBottom: 8 },
  personName: { color: colors.muted, fontSize: 16, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemDone: { opacity: 0.5 },
  itemMark: { color: colors.muted, fontSize: 20, width: 24, textAlign: 'center' },
  itemTitle: { color: colors.ink, fontSize: 20, flexShrink: 1 },
  // A completed chore is struck through as well as dimmed, so it reads as done
  // at a glance.
  itemTitleDone: { textDecorationLine: 'line-through', color: colors.muted },
});
