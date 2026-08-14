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
import { useWriteQueue } from '../offline/useWriteQueue';
import { isCurrentWeek } from '../offline/weekIso';
import { assignmentDedupeKey, readWriteQueue, type QueuedWrite } from '../offline/writeQueue';
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
 * back to `Open`. Both reconcile to the response status, and both revert when the
 * service *refuses* the write (an outage queues it instead - see below), so a
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
 * A board served from cache is still a control (Epic 60 O3), and it comes back
 * to life by itself:
 * - **tappable while its week still is this week.** A cached row carries the
 *   *cached* `weekIso`, and the API resolves a completion by
 *   `(householdId, weekIso, choreId)` with no current-week check - so a tap taken
 *   after an outage that spanned a week boundary would land a completion in the
 *   stale week and *succeed*, marking last week done while this week's chore
 *   stays open. That is the one case the board still refuses
 *   ({@link isCurrentWeek}); within the current week an offline tap is queued
 *   ({@link useWriteQueue}) and shown as done immediately.
 * - self-reviving, because the hub lives on a wall and nobody reloads it. While
 *   degraded the board listens for a reconnect ({@link useReconnectSignal}) and
 *   refetches when the network returns, which is what turns the cached board back
 *   into a live one and drains whatever the outage queued.
 *
 * Offline writes (Epic 60 O3) are the same tap, taken twice over:
 * - a tap on a cached board has no live network to try, so it goes straight to
 *   the durable queue;
 * - a tap on a *live* board still goes to the API first, and only an
 *   `unreachable` answer queues it. An HTTP/problem/parse failure is the service
 *   actually refusing the write, so that one still reverts.
 * - either way the optimistic flip **stays**. A queued write is not a failed
 *   one, and reverting it would tell the family their tap was lost when it was
 *   not; a write that ultimately cannot sync is surfaced instead (O4).
 * - and because a redraw would otherwise show the server's pre-sync truth, every
 *   load overlays the queue's pending writes over what it just fetched
 *   ({@link applyQueuedWrites}) - so the reconnect refetch, which races the
 *   drain, can never make a queued tap flicker back to `Open`.
 */

/** A rendered board item: an assignment joined to its chore and lifecycle state. */
export type BoardItem = {
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

/**
 * Overlay the queue's not-yet-synced writes (O3) over a freshly loaded week.
 *
 * A queued completion has been shown as done since the tap, but the server has
 * not seen it yet - so the very next load (the reconnect refetch, which races
 * the drain, or a plain reload) would otherwise redraw the row as `Open` and make
 * the tap look lost. The queue holds one entry per `(week, chore)` target, so the
 * lookup is exact and the direction is read straight off the entry's kind.
 *
 * Entries flagged `failed` are overlaid too: they are still queued, still the
 * user's stated intent, and surfacing them is O4's job - silently redrawing them
 * as undone here would be exactly the "silently dropped" outcome the AC forbids.
 */
export function applyQueuedWrites(
  items: BoardItem[],
  weekIso: string,
  queue: QueuedWrite[],
): BoardItem[] {
  if (queue.length === 0) {
    return items;
  }
  return items.map((item) => {
    const queued = queue.find((entry) => entry.dedupeKey === assignmentDedupeKey(weekIso, item.choreId));
    if (queued === undefined) {
      return item;
    }
    return { ...item, status: queued.kind === 'chore-complete' ? 'Done' : 'Open' };
  });
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
  // The durable offline write queue (O3). It hydrates from storage on mount, so
  // taps taken before a reload of the wall tablet are already here and replaying.
  const { enqueue } = useWriteQueue(householdId, client);
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
          // The cache is re-read from storage on every load, so a queued tap that
          // happened after the record was last written is still shown as done.
          setItems(
            applyQueuedWrites(cached.board.items, cached.board.weekIso, readWriteQueue(householdId)),
          );
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
      // Anything still queued (O3) is layered over the server's answer, because
      // this load races the drain: the API has not seen those writes yet, and
      // redrawing them as undone would make a tap that *is* still on its way look
      // lost. The queue is read from storage rather than from the hook's state so
      // this effect does not re-run every time the queue changes.
      setItems(applyQueuedWrites(built, week, readWriteQueue(householdId)));
      // Live data: the week on screen is the server's again and no longer
      // last-known, which is how a reconnect retires the cached week (and with it
      // the rolled-over-week guard that could have made the board read-only).
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

  // A cached board whose week has rolled over is the one thing an offline tap
  // must never touch: its rows carry the *cached* week, and C4 resolves a
  // completion by `(householdId, weekIso, choreId)` with no current-week check,
  // so replaying that write would mark last week done and succeed. Live data is
  // never stale in this sense - the server just named the week - so the guard is
  // only ever applied to a board served from cache. This is the *render*-time
  // answer, which decides whether a row reads as a control; `toggle` asks the
  // same question again at the moment of the tap, which is what actually guards
  // the write.
  const staleCachedWeek = fromCache && !isCurrentWeek(weekIso);

  // Tapping an item toggles its completion, attributed to the active participant
  // (T3): an `Open` item completes through C4, a `Done` item undoes that
  // completion. With no active participant - or on a cached board whose week has
  // rolled over - the board is read-only, so the tap does nothing.
  //
  // The flip is optimistic in every case: it shows immediately, and it survives
  // whatever happens next unless the service itself refuses the write.
  // - Offline, from a cached board: there is no live network to try, so the write
  //   goes straight to the durable queue (O3) and replays when the network is
  //   back. The row stays done.
  // - Live, but the network drops between the load and the tap: the API answers
  //   `unreachable`, which is the same situation arriving a moment later, so the
  //   write is queued too and the row still stays done. Reverting here would tell
  //   the family their tap was lost when it is sitting in a durable queue; a write
  //   that ultimately cannot sync is surfaced instead (O4).
  // - Live, and the service answers with a real error (HTTP / problem details /
  //   an unreadable body): that is a refusal, not an outage, so the row reverts
  //   exactly as it did before O3 - the board never lies about the server.
  // - Otherwise the row reconciles to the status the response confirms.
  const toggle = useCallback(
    async (choreId: string) => {
      // Re-checked here rather than reused from render: a wall hub can sit
      // untouched for days, so the week must be judged at the moment of the tap,
      // not at the moment the board last drew itself.
      if (activePersonId === null || (fromCache && !isCurrentWeek(weekIso))) {
        return;
      }
      const target = items.find((item) => item.choreId === choreId);
      if (!target) {
        return;
      }

      const previous = target.status;
      const optimistic: 'Open' | 'Done' = previous === 'Open' ? 'Done' : 'Open';
      const action = previous === 'Open' ? 'complete' : 'undo';
      const path = `/households/${householdId}/assignments/${weekIso}/${choreId}/${action}`;
      const body = { personId: activePersonId };
      // Keyed by the target, not the direction, so tapping twice queues one write
      // and a complete-then-undo collapses to what the user last meant.
      const queueWrite = () =>
        enqueue({
          kind: action === 'complete' ? 'chore-complete' : 'chore-undo',
          dedupeKey: assignmentDedupeKey(weekIso, choreId),
          method: 'POST',
          path,
          body,
        });

      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: optimistic } : item)),
      );

      if (fromCache) {
        queueWrite();
        return;
      }

      const result = await client.update<CompleteChoreResponse | UndoChoreResponse>(path, body, {
        method: 'POST',
      });

      if (!result || !result.ok) {
        if (result && result.error.kind === 'network') {
          queueWrite();
          return;
        }
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
    [client, householdId, weekIso, activePersonId, items, fromCache, enqueue],
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
                      // Read-only when no participant is active, or when the board
                      // is a last-known one whose week has since rolled over (that
                      // row must never write - see `toggle`). Otherwise both an
                      // Open item (tap to complete) and a Done item (tap to undo)
                      // are actionable, online or off - offline the tap is queued.
                      // The tap handler still makes a read-only press a safe no-op.
                      inert={staleCachedWeek || activePersonId === null}
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
