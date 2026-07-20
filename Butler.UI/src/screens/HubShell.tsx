import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { describeApiError } from '../api/errors';
import type { HouseholdResponse, RosterEntryResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { TodayPanel } from '../components/TodayPanel';
import { colors } from '../components/Screen';
import { useHousehold } from '../state/HouseholdContext';

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

export function HubShell() {
  const client = useApiClient();
  const { householdId } = useHousehold();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

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

  // A missing household is a calm derived state, not a fetch outcome.
  const view: LoadState =
    householdId === null ? { phase: 'error', message: 'No household is set up yet.' } : state;
  const householdName = view.phase === 'ready' ? view.householdName : 'Butler';

  return (
    <View style={styles.hub} testID="hub-shell">
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
            view.people.map((person) => <NameTile key={person.personId} person={person} />)
          ))}
      </View>

      <TodayPanel />
    </View>
  );
}

/**
 * A participant's name tile: a large, glanceable card accented by the person's
 * claim colour. This ticket renders the tile for the ambient glance only; wiring
 * the tap-to-claim interaction onto it is T3.
 */
function NameTile({ person }: { person: RosterEntryResponse }) {
  const accent = person.claimColor ?? colors.brass;
  return (
    <View style={[styles.tile, { borderColor: accent }]} testID={`name-tile-${person.personId}`}>
      <View style={[styles.tileDot, { backgroundColor: accent }]} />
      <Text style={styles.tileName} numberOfLines={1}>
        {person.displayName}
      </Text>
    </View>
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
});
