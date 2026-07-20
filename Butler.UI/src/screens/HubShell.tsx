import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiClient } from '../api/client';
import { describeApiError } from '../api/errors';
import type {
  HouseholdResponse,
  ParticipantSessionResponse,
  RosterEntryResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { HubPairing } from '../auth/HubPairing';
import { OrganizerBar } from '../auth/OrganizerBar';
import { TodayPanel } from '../components/TodayPanel';
import { colors } from '../components/Screen';
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
 * organizer sign-in is a separate affordance (T4).
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; householdName: string; people: RosterEntryResponse[] }
  | { phase: 'error'; message: string };

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
        setState({ phase: 'error', message: describeApiError(householdResult.error) });
        return;
      }
      if (!peopleResult.ok) {
        setState({ phase: 'error', message: describeApiError(peopleResult.error) });
        return;
      }
      setState({
        phase: 'ready',
        householdName: householdResult.data.name,
        people: peopleResult.data ?? [],
      });
    });

    return () => {
      active = false;
    };
  }, [client, householdId]);

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

  // A missing household is a calm derived state, not a fetch outcome.
  const view: LoadState =
    householdId === null ? { phase: 'error', message: 'No household is set up yet.' } : state;
  const householdName = view.phase === 'ready' ? view.householdName : 'Butler';

  return (
    <View style={styles.hub} testID="hub-shell">
      <OrganizerBar />
      <HubPairing />
      <View style={styles.header}>
        <Text style={styles.householdName} accessibilityRole="header" testID="hub-household-name">
          {householdName}
        </Text>
        <Text style={styles.date} testID="hub-date">
          {todayLabel()}
        </Text>
      </View>

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
          (view.people.length === 0 ? (
            <Text style={styles.status} testID="hub-no-people">
              No one has been added to this household yet.
            </Text>
          ) : (
            view.people.map((person) => (
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

      <TodayPanel activeParticipant={activeParticipant} />
    </View>
  );
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
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  householdName: { color: colors.ink, fontSize: 40, fontWeight: '700' },
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
