import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  AssignmentSetResponse,
  ChoreResponse,
  CompleteChoreResponse,
  RosterEntryResponse,
} from '../api/models';
import { describeApiError } from '../api/errors';
import { useApiClient } from '../api/useApiClient';
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
 * week. A tap on an open item completes it
 * through C4 with an optimistic flip to `Done`, reconciling on the response and
 * reverting on error. A `Done` item is dimmed, checked, and not tappable again,
 * so a completed chore is never re-submitted (matching C4 idempotency).
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

export function ChoreBoard({
  householdId,
  people,
  activePersonId,
}: {
  householdId: string;
  people: RosterEntryResponse[];
  activePersonId: string | null;
}) {
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [weekIso, setWeekIso] = useState('');
  const [items, setItems] = useState<BoardItem[]>([]);

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
      if (!assignments || !assignments.ok) {
        setMessage(assignments ? describeApiError(assignments.error) : 'The board is unavailable.');
        setPhase('error');
        return;
      }
      if (!chores || !chores.ok) {
        setMessage(chores ? describeApiError(chores.error) : 'The board is unavailable.');
        setPhase('error');
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

      setWeekIso(set?.weekIso ?? '');
      setItems(built);
      setPhase('ready');
    });

    return () => {
      active = false;
    };
  }, [client, householdId]);

  // Tapping an open item completes it (C4). The completion is attributed to the
  // active participant (T3); with no active participant the board is read-only,
  // so the tap does nothing. A tap on an already-`Done` item is a no-op too - the
  // completed chore is never re-submitted (matching C4 idempotency). The flip to
  // `Done` is optimistic - it shows immediately, reconciles to the response
  // status, and reverts on error.
  const complete = useCallback(
    async (choreId: string) => {
      if (activePersonId === null) {
        return;
      }
      const target = items.find((item) => item.choreId === choreId);
      if (!target || target.status === 'Done') {
        return;
      }

      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: 'Done' } : item)),
      );

      const result = await client.update<CompleteChoreResponse>(
        `/households/${householdId}/assignments/${weekIso}/${choreId}/complete`,
        { personId: activePersonId },
        { method: 'POST' },
      );

      if (!result || !result.ok) {
        setItems((prev) =>
          prev.map((item) => (item.choreId === choreId ? { ...item, status: 'Open' } : item)),
        );
        return;
      }

      const reconciled: 'Open' | 'Done' = result.data?.status === 'Done' ? 'Done' : 'Open';
      setItems((prev) =>
        prev.map((item) => (item.choreId === choreId ? { ...item, status: reconciled } : item)),
      );
    },
    [client, householdId, weekIso, activePersonId, items],
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
                      // Read-only when no participant is active, and a Done item
                      // is already complete: both are surfaced for accessibility,
                      // and the tap handler makes the press itself a safe no-op.
                      inert={activePersonId === null || item.status === 'Done'}
                      onPress={() => complete(item.choreId)}
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
