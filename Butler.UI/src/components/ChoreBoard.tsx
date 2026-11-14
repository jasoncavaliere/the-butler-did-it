import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiResult } from '../api/client';
import type {
  AssignmentSetResponse,
  ChoreResponse,
  CompleteChoreResponse,
  RosterEntryResponse,
  UndoChoreResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { readGlance, writeGlance } from '../offline/glanceCache';
import { useCurrentWeekIso } from '../offline/useCurrentWeek';
import { useReconnectSignal } from '../offline/useReconnect';
import { useWriteQueueContext } from '../offline/WriteQueueContext';
import { currentWeekIso, isCurrentWeek } from '../offline/weekIso';
import { assignmentDedupeKey, readWriteQueue, type QueuedWrite } from '../offline/writeQueue';
import { colors } from './Screen';
import { WidgetEmpty, WidgetError, WidgetSkeleton } from './WidgetState';

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
 * Load states (P8, ADR-0007): a calm skeleton while the week loads, a designed
 * "all caught up" empty state when nothing is on the board (or on the active
 * participant's list), and a friendly error - fixed copy, never the raw API
 * text - whose "Try again" re-requests the week. Automatic retry is #109.
 *
 * A board - live or served from cache - is a control (Epic 60 O3), and it comes
 * back to life by itself:
 * - **tappable while its week still is this week.** Every row carries the
 *   `weekIso` the board was loaded with, and the API resolves a completion by
 *   `(householdId, weekIso, choreId)` with no current-week check - so a tap on a
 *   board that has outlived its week would land a completion in the stale week
 *   and *succeed*, marking last week done while this week's chore stays open.
 *   That happens to a cached board after an outage that spanned a boundary, and
 *   just as easily to a live board loaded on Sunday night and tapped on Monday
 *   morning (#89). It is the one case the board refuses ({@link isCurrentWeek}),
 *   whichever way the board was loaded; within the current week an offline tap
 *   is queued (the hub's shared {@link useWriteQueueContext} queue) and shown as
 *   done immediately, and a queued write whose week ends before it syncs is
 *   flagged at drain time rather than replayed into the ended week.
 * - self-reviving, because the hub lives on a wall and nobody reloads it. While
 *   degraded the board listens for a reconnect ({@link useReconnectSignal}) and
 *   refetches when the network returns, which is what turns the cached board back
 *   into a live one and drains whatever the outage queued. And at the week
 *   boundary ({@link useCurrentWeekIso}) it redraws its rows as read-only and
 *   reloads the new week, so a healthy hub is not left read-only every Monday.
 *   The tablet and the API each read their own clock, so that boundary reload
 *   can reach a server that has not turned the week yet and be handed the week
 *   that just ended. A live load whose week disagrees with the tablet's is
 *   therefore retried on a short backoff ({@link LIVE_WEEK_RETRY_DELAYS_MS}), and
 *   a refused tap forces a reload too, so the board is never left read-only for
 *   the rest of the week by a few milliseconds of clock skew. If the two still
 *   disagree after a retry, the tablet's clock is the likelier culprit, and the
 *   board says so ({@link CLOCK_NOTICE_AFTER}) rather than going silently inert.
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
 *   ({@link applyQueuedWrites}), which covers a write that is still queued.
 * - the overlay alone cannot cover a write the drain has already *confirmed*:
 *   it has left the queue, yet the reconnect refetch that raced the drain may
 *   still resolve with the server's pre-sync snapshot. So a drain run that
 *   confirms anything bumps the queue's `confirmedRevision`, and the board
 *   refetches once on it - the stale load is discarded and the fresh one shows
 *   the post-sync server state, whichever request the network answered first.
 * - a *live* tap never enters the queue, so neither of those covers it: a load
 *   already in flight when the tap is made (that confirm refetch, a week retry,
 *   the boundary reload) still answers with the row as it was, and the board
 *   stays tappable while it loads. So each live tap is remembered while its POST
 *   is in flight and until a load that started after it settled has landed, and
 *   every load overlays those taps last, over the queue's
 *   ({@link applyLiveTaps}, {@link pruneLiveTaps}, #147). The board does not
 *   refetch again for it - that would cost a request and still redraw a tap
 *   whose POST had not settled yet.
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

/** The board's load-state copy, kept in one place so the voice stays consistent. */
const COPY = {
  loading: 'Setting the board...',
  emptyTitle: 'All caught up.',
  emptyDetailGlance: 'Nothing on the board this week. Enjoy the quiet.',
  emptyDetailMine: 'Nothing on your list this week.',
  loadFailed: 'The board did not load just now. Tap Try again.',
} as const;

/**
 * How long a live board waits before reloading when the server named a week
 * other than the tablet's (#89), indexed by how many live loads in a row have
 * disagreed; past the end the last delay repeats.
 *
 * The usual cause is the boundary reload racing the server's clock: the tablet
 * turns the week a few milliseconds before the API does, so `generate` still
 * answers with the week that just ended. Nothing else would reload the board
 * for a week - it is healthy, so it is not listening for a reconnect, and with
 * every row read-only no tap confirms a write - so the board retries by itself.
 * The first retry is soon, because that race clears in well under a second; the
 * delays then grow so a tablet whose clock is simply wrong polls gently rather
 * than hammering the API.
 */
export const LIVE_WEEK_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000, 300_000];

/**
 * How many live loads in a row must disagree with the tablet about the week
 * before the board says the tablet's clock looks wrong. One disagreement is the
 * ordinary boundary race above and clears on the first retry, so it is not worth
 * a message; a second, after that retry, means the clocks really are apart (a
 * reset RTC or a hand-set time), and a board that is read-only for that reason
 * must say why rather than just stop answering taps.
 */
export const CLOCK_NOTICE_AFTER = 2;

/** The two day buckets the panel presents, in order. */
const DAY_BUCKETS = [
  { key: 'today', label: 'Today', daily: true },
  { key: 'this-week', label: 'This week', daily: false },
] as const;

function isDaily(cadence: string): boolean {
  return cadence.toLowerCase() === 'daily';
}

/** A read that did not produce a board: whether the API was unreachable. */
export type LoadFailure = { offline: boolean };

/**
 * Classify one of the board's failed reads: whether the API was unreachable.
 * The board shows fixed friendly copy for any failure, so no message is carried.
 * Only the client's normalized `network` error means
 * "unreachable", which is the single case the last-known cache stands in for -
 * an HTTP/problem/parse error is a real answer from a reachable service, and a
 * result that never arrived carries no error to classify at all.
 */
export function describeFailure(result: ApiResult<unknown> | undefined): LoadFailure {
  if (result && !result.ok) {
    return { offline: result.error.kind === 'network' };
  }
  return { offline: false };
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

/**
 * A live tap (#147), as the board remembers it until a load is sure to include
 * it: the status the row now shows, and the load sequence number that was
 * current when its POST settled - `null` while the POST is still in flight.
 */
export type LiveTap = { status: 'Open' | 'Done'; settledAtLoad: number | null };

/**
 * Forget the live taps that load number `load` already reflects (#147).
 *
 * A tap whose POST settled before that load started (`settledAtLoad < load`)
 * was recorded on the server before the load's request was sent, so the
 * server's answer already carries it. A tap still in flight, or one that
 * settled while that load (or a later one) was running, may be missing from
 * the snapshot and is kept. Returns a new map; the input is not changed.
 */
export function pruneLiveTaps(taps: Map<string, LiveTap>, load: number): Map<string, LiveTap> {
  return new Map(
    Array.from(taps).filter(([, tap]) => tap.settledAtLoad === null || tap.settledAtLoad >= load),
  );
}

/**
 * Overlay the live taps a load may have missed (#147) over a freshly loaded week.
 *
 * A live tap goes straight to the API rather than the queue, so
 * {@link applyQueuedWrites} cannot cover it: a load that was already in flight
 * when the tap was made - the confirm refetch above all - answers with the row
 * as it was, and would redraw the tap as undone with nothing left to correct it
 * on a live board. Records are keyed like the queue, by `(week, chore)`, so the
 * lookup is exact and a tap on another week never matches.
 */
export function applyLiveTaps(
  items: BoardItem[],
  weekIso: string,
  taps: Map<string, LiveTap>,
): BoardItem[] {
  if (taps.size === 0) {
    return items;
  }
  return items.map((item) => {
    const tap = taps.get(assignmentDedupeKey(weekIso, item.choreId));
    if (tap === undefined) {
      return item;
    }
    return { ...item, status: tap.status };
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
  const [phase, setPhase] = useState<Phase>('loading');
  const [weekIso, setWeekIso] = useState('');
  const [items, setItems] = useState<BoardItem[]>([]);
  // Whether what is on screen came from the offline cache rather than the API.
  // A cached board has no live network to try, so its taps go straight to the
  // durable queue. It no longer decides whether the board is read-only: any
  // board whose week has rolled over is, cached or live (see the module
  // docstring).
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

  // The durable offline write queue (O3), shared with the hub's sync indicator
  // through the one WriteQueueProvider the hub mounts (O4). It hydrates from
  // storage on mount, so taps taken before a reload of the wall tablet are
  // already here and replaying. It has to be read above the load effect, which
  // lists `confirmedRevision`.
  const { enqueue, confirmedRevision } = useWriteQueueContext();

  // The week the hub is in, as state that changes at the boundary (#89). It is
  // what the render compares the board's week against, and - listed in the load
  // effect's dependencies - it reloads the new week once when the week turns.
  const { currentWeek, recheck: recheckWeek } = useCurrentWeekIso();

  // How many live loads in a row named a week other than the tablet's, and a
  // counter that forces a reload. The first arms the backoff retry below and
  // decides the clock notice; the second is bumped by that retry and by a
  // refused tap. Both exist because `currentWeek` alone cannot recover a board
  // whose boundary reload reached the API before the API's week turned: the
  // hook already holds the new week, so re-reading it changes nothing and
  // nothing would load again until next Monday.
  const [weekMismatches, setWeekMismatches] = useState(0);
  const [reloadRevision, setReloadRevision] = useState(0);

  // Counts loads, so a live tap can say which loads it settled during (#147). A
  // ref, not state: it is bumped inside the load effect and read by `toggle`,
  // and neither must re-run the load.
  const loadSeqRef = useRef(0);
  // The live taps a load may have missed (#147), keyed by `(week, chore)`. A ref
  // rather than state or a load dependency, for the same reason the queue is read
  // from storage below: a tap must not refetch the week.
  const liveTapsRef = useRef(new Map<string, LiveTap>());

  useEffect(() => {
    let active = true;
    // Taken now, before the requests are sent, so a tap that settles after this
    // point is known to be one this load's snapshot may not include.
    const load = ++loadSeqRef.current;

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
          // A cached week is not the server's answer, so it says nothing about
          // the clocks; the reconnect, not the backoff, is what reloads it.
          setWeekMismatches(0);
          reportRef.current?.(cached.cachedAtIso);
          return;
        }
        setFromCache(false);
        setPhase('error');
        setWeekMismatches(0);
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
      // lost. A write the drain confirms mid-load has already left the queue, so
      // the overlay cannot cover it; the `confirmedRevision` dependency below
      // re-runs this load instead. The queue is read from storage rather than
      // from the hook's state so this effect does not re-run every time the queue
      // changes.
      //
      // Live taps (#147) go on top, as the newest intent: this load may have been
      // sent before a tap on the live board, which never enters the queue, so
      // without them the row would redraw as it was and nothing would correct
      // it. Taps this load already reflects are forgotten first.
      liveTapsRef.current = pruneLiveTaps(liveTapsRef.current, load);
      setItems(
        applyLiveTaps(
          applyQueuedWrites(built, week, readWriteQueue(householdId)),
          week,
          liveTapsRef.current,
        ),
      );
      // Live data: the week on screen is the server's again and no longer
      // last-known, which is how a reconnect retires the cached week (and with it
      // the rolled-over-week guard that could have made the board read-only).
      setFromCache(false);
      setPhase('ready');
      // Does the server's week agree with the tablet's? The clock is re-read here
      // rather than taken from `currentWeek`, and the render's copy is brought up
      // to date with it, so a tablet whose clock was corrected (or whose boundary
      // timer slept through Monday) draws against the right week. A disagreement
      // arms the backoff retry below.
      const deviceWeek = currentWeekIso();
      recheckWeek();
      setWeekMismatches((previous) => (week === deviceWeek ? 0 : previous + 1));
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
    // someone to reload a tablet nobody touches. `confirmedRevision` bumps once
    // per drain run that confirmed a queued write, so the board refetches the
    // post-sync week (#88): the cleanup discards a load that raced the drain and
    // may hold the pre-sync snapshot. `currentWeek` changes once at the week
    // boundary, so a hub nobody reloads picks up the new week by itself (#89)
    // instead of sitting read-only until someone refreshes it; if that reload
    // finds the network gone it falls back to the cache like any other load.
    // `reloadRevision` bumps when a live load's week disagreed with the tablet's
    // and the backoff has elapsed, or when a tap was refused, so a board whose
    // boundary reload beat the server's clock loads again. All four are triggers
    // only, never read here. Any of these loads can race a live tap; the live-tap
    // overlay above covers that (#147), so a tap settling is deliberately not a
    // trigger.
  }, [client, householdId, reconnectSignal, confirmedRevision, currentWeek, reloadRevision, recheckWeek]);

  // The backoff retry for a live load whose week disagreed with the tablet's.
  // Keyed on the count, which every disagreeing load bumps and every agreeing
  // (or failed) load resets, so each disagreement arms exactly one timer and the
  // first agreement disarms it.
  useEffect(() => {
    if (weekMismatches === 0) {
      return undefined;
    }
    const delays = LIVE_WEEK_RETRY_DELAYS_MS;
    const timer = setTimeout(
      () => setReloadRevision((previous) => previous + 1),
      delays[Math.min(weekMismatches, delays.length) - 1],
    );
    return () => clearTimeout(timer);
  }, [weekMismatches]);

  // A board whose week has rolled over must never write, however it was loaded:
  // its rows carry the week they were loaded with, and C4 resolves a completion
  // by `(householdId, weekIso, choreId)` with no current-week check, so a write
  // from it would mark last week done and succeed. That is as true of a cached
  // board after an outage as of a live one - live data is only current at the
  // moment it was loaded, and the wall hub can hold it across Sunday midnight.
  // This is the *render*-time answer, which decides whether a row reads as a
  // control; `toggle` asks the same question again against the real clock at
  // the moment of the tap, which is what actually guards the write.
  const staleWeek = weekIso !== currentWeek;
  // A live board that is read-only because the server and the tablet still
  // disagree about the week after a retry: say so, rather than go silently inert.
  const clockLooksWrong = staleWeek && weekMismatches >= CLOCK_NOTICE_AFTER;

  // Tapping an item toggles its completion, attributed to the active participant
  // (T3): an `Open` item completes through C4, a `Done` item undoes that
  // completion. With no active participant - or on any board whose week has
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
      // not at the moment the board last drew itself. The refusal comes before
      // the optimistic flip, so the row never pretends the tap landed.
      if (activePersonId === null) {
        return;
      }
      if (!isCurrentWeek(weekIso)) {
        // The week turned but the render has not caught up (a sleeping tablet can
        // fire the boundary timer late), so bring it up to date: the row goes
        // read-only and the new week reloads. The reload is forced as well,
        // because the render may already hold the new week - the boundary reload
        // came back with the ended one - and re-reading an unchanged week would
        // not load anything.
        recheckWeek();
        setReloadRevision((previous) => previous + 1);
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

      // Remember the tap while its POST is in flight, so a load that resolves
      // meanwhile cannot redraw it (#147). The record always mirrors the row.
      const tapKey = assignmentDedupeKey(weekIso, choreId);
      liveTapsRef.current.set(tapKey, { status: optimistic, settledAtLoad: null });

      const result = await client.update<CompleteChoreResponse | UndoChoreResponse>(path, body, {
        method: 'POST',
      });

      if (!result || !result.ok) {
        if (result && result.error.kind === 'network') {
          // The queue overlay takes over from here.
          liveTapsRef.current.delete(tapKey);
          queueWrite();
          return;
        }
        liveTapsRef.current.delete(tapKey);
        setItems((prev) =>
          prev.map((item) => (item.choreId === choreId ? { ...item, status: previous } : item)),
        );
        return;
      }

      const reconciled: 'Open' | 'Done' = result.data?.status === 'Done' ? 'Done' : 'Open';
      // Kept until a load that started after this point has landed: one already
      // in flight may have been sent before the server recorded the tap.
      liveTapsRef.current.set(tapKey, { status: reconciled, settledAtLoad: loadSeqRef.current });
      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: reconciled } : item)),
      );
    },
    [client, householdId, weekIso, activePersonId, items, fromCache, enqueue, recheckWeek],
  );

  // "Try again" on the error state: show the skeleton, then bump the reload
  // counter the load effect lists. Declared above the early returns (hook rules).
  const retry = useCallback(() => {
    setPhase('loading');
    setReloadRevision((previous) => previous + 1);
  }, []);

  if (phase === 'loading') {
    return <WidgetSkeleton testID="chore-board-loading" caption={COPY.loading} />;
  }

  if (phase === 'error') {
    return (
      <WidgetError
        testID="chore-board-error"
        message={COPY.loadFailed}
        onRetry={retry}
        retryTestID="chore-board-retry"
      />
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
      <WidgetEmpty
        testID="chore-board-empty"
        title={COPY.emptyTitle}
        detail={activePersonId === null ? COPY.emptyDetailGlance : COPY.emptyDetailMine}
      />
    );
  }

  const personIndex = (personId: string): number => {
    const idx = people.findIndex((person) => person.personId === personId);
    return idx === -1 ? people.length : idx;
  };

  return (
    <View style={styles.board} testID="chore-board">
      {clockLooksWrong ? (
        <Text style={styles.status} testID="chore-board-clock-notice">
          This tablet&apos;s clock does not match the server&apos;s week, so chores cannot be
          marked until the clock is set right.
        </Text>
      ) : null}
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
                      // Read-only when no participant is active, or when the board's
                      // week has since rolled over, live or cached (that row must
                      // never write - see `toggle`). Otherwise both an Open item
                      // (tap to complete) and a Done item (tap to undo) are
                      // actionable, online or off - offline the tap is queued.
                      // The tap handler still makes a read-only press a safe no-op.
                      inert={staleWeek || activePersonId === null}
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
