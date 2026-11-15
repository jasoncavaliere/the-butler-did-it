import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { HouseholdResponse } from '../api/models';
import { describeApiError } from '../api/errors';
import { useApiClient } from '../api/useApiClient';
import { ActionButton, Field } from '../components/FormControls';
import { Screen, colors } from '../components/Screen';
import { space, typeScale } from '../layout/tokens';
import { forgetHouseholdOffline } from '../offline/forgetHousehold';
import { useBrowserOnline } from '../offline/useBrowserOnline';
import { useReconnectSignal, type ReconnectTarget } from '../offline/useReconnect';
import { useHousehold } from '../state/HouseholdContext';
import { useHubDevice } from '../state/HubDeviceContext';
import { useOrganizer } from '../state/OrganizerContext';

/**
 * Every word the teardown screen shows. The screen renders only from this
 * constant (plus the household's own name and an API error line), so the
 * plain-ASCII test scans every fixed string a reader sees.
 */
export const TEARDOWN_COPY = {
  heading: 'Delete household',
  intro: 'This deletes the household from Butler, along with everything in it:',
  deletes: [
    'People',
    'Rooms',
    'Chores',
    'Assignments and their history',
    'Grocery carts',
    'Paired hub devices',
  ],
  irreversible: 'This cannot be undone.',
  prompt: "Type the household's name exactly to confirm:",
  inputLabel: 'Household name',
  loading: 'Reading the household...',
  delete: 'Delete household',
  deleting: 'Deleting...',
  cancel: 'Cancel',
  offline: 'Deleting the household needs a connection. Reconnect, then try again.',
  signedOut: 'Sign in as the organizer to delete the household.',
} as const;

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; name: string }
  | { phase: 'error'; message: string };

/**
 * The household teardown screen (#168): the organizer's last, deliberate step
 * for removing a household.
 *
 * It reads the household name, lists what will be deleted, says it cannot be
 * undone, and enables Delete only when the typed text equals the name exactly
 * (ordinal and case-sensitive, no trimming), an organizer is signed in, and the
 * browser is online. A failed name read (for example, the screen was opened
 * offline) re-reads each time the browser comes back online until the name
 * loads (#252). Confirming sends one `DELETE /households/{id}` with
 * `{ confirmName }`; it is never put on the write queue, so an offline tap can
 * never replay a teardown later.
 *
 * On success the hub forgets the household: its write queue and glance cache,
 * the hub-device token, the organizer session, and finally the selected
 * household id. The household id is captured before the request, and nothing
 * on this screen is set after {@link onDeleted} and the id clear, because the
 * navigator unmounts the whole signed-in stack at that point. On a failure
 * (a name mismatch 400, or anything else) it shows the API's message and
 * changes nothing local.
 *
 * It is not wrapped in OrganizerGate: the gate re-probes the organizer on every
 * client change, which would replace the offline state and block the screen
 * mid-teardown. The button is gated on the organizer instead; the server
 * enforces the Organizer policy.
 */
export function HouseholdTeardownScreen({
  onCancel,
  onDeleted,
  connectivityTarget,
}: {
  /** Leave without deleting anything (the navigator returns to the hub). */
  onCancel: () => void;
  /** Called once, after the API deleted the household and local state is cleared. */
  onDeleted: () => void;
  /** Override the browser event target (tests inject one; default is ambient). */
  connectivityTarget?: ReconnectTarget;
}) {
  const client = useApiClient();
  const { householdId, setHouseholdId } = useHousehold();
  const { setDeviceToken } = useHubDevice();
  const { organizer, signOut } = useOrganizer();
  const online = useBrowserOnline(connectivityTarget);

  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  // Bumps on reconnect only while the name read is in error, so a read that
  // failed offline is retried once the browser is back online (#252).
  const reconnectSignal = useReconnectSignal(load.phase === 'error', connectivityTarget);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<'idle' | 'deleting'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Guards a second tap landing before the 'deleting' render disables the button.
  const inFlight = useRef(false);

  useEffect(() => {
    if (householdId === null) {
      return;
    }
    let active = true;
    client.get<HouseholdResponse>(`/households/${householdId}`).then((result) => {
      if (!active) {
        return;
      }
      setLoad(
        result.ok
          ? { phase: 'ready', name: result.data.name }
          : { phase: 'error', message: describeApiError(result.error) },
      );
    });
    return () => {
      active = false;
    };
  }, [client, householdId, reconnectSignal]);

  const name = load.phase === 'ready' ? load.name : null;
  const canDelete =
    organizer !== null && online && name !== null && typed === name && phase === 'idle';

  const handleDelete = async () => {
    if (!canDelete || inFlight.current || householdId === null) {
      return;
    }
    const id = householdId;
    inFlight.current = true;
    setPhase('deleting');
    setError(null);

    const result = await client.update<void>(
      `/households/${id}`,
      { confirmName: typed },
      { method: 'DELETE' },
    );

    if (!result.ok) {
      inFlight.current = false;
      setError(describeApiError(result.error));
      setPhase('idle');
      return;
    }

    // The household is gone server-side; forget it here. Queue before glance
    // (forgetHouseholdOffline), then the device token and the organizer, and
    // the household id last: clearing it unmounts this screen.
    forgetHouseholdOffline(id);
    setDeviceToken(null);
    void signOut();
    onDeleted();
    setHouseholdId(null);
  };

  const copy = TEARDOWN_COPY;
  return (
    <Screen testID="household-teardown-screen">
      <Text style={styles.heading} accessibilityRole="header">
        {copy.heading}
      </Text>
      <Text style={styles.body}>{copy.intro}</Text>
      <View style={styles.list} testID="teardown-deletes">
        {copy.deletes.map((item) => (
          <Text key={item} style={styles.body}>
            {`- ${item}`}
          </Text>
        ))}
      </View>
      <Text style={styles.warning} testID="teardown-irreversible">
        {copy.irreversible}
      </Text>

      {load.phase === 'loading' ? (
        <View style={styles.row} testID="teardown-loading">
          <ActivityIndicator color={colors.brass} />
          <Text style={styles.body}>{copy.loading}</Text>
        </View>
      ) : null}
      {load.phase === 'error' ? (
        <Text style={styles.error} testID="teardown-load-error">
          {load.message}
        </Text>
      ) : null}
      {name !== null ? (
        <View style={styles.section}>
          <Text style={styles.body}>{copy.prompt}</Text>
          <Text style={styles.name} testID="teardown-household-name">
            {name}
          </Text>
          <Field
            label={copy.inputLabel}
            testID="teardown-confirm-input"
            value={typed}
            onChangeText={setTyped}
          />
        </View>
      ) : null}

      {organizer === null ? (
        <Text style={styles.body} testID="teardown-signed-out">
          {copy.signedOut}
        </Text>
      ) : null}
      {!online ? (
        <Text style={styles.body} testID="teardown-offline">
          {copy.offline}
        </Text>
      ) : null}
      {error !== null ? (
        <Text style={styles.error} testID="teardown-error">
          {error}
        </Text>
      ) : null}

      <ActionButton
        testID="teardown-delete"
        disabled={!canDelete}
        onPress={() => {
          void handleDelete();
        }}
      >
        {phase === 'deleting' ? copy.deleting : copy.delete}
      </ActionButton>
      <ActionButton
        testID="teardown-cancel"
        variant="secondary"
        disabled={phase === 'deleting'}
        onPress={onCancel}
      >
        {copy.cancel}
      </ActionButton>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: typeScale.title,
    fontWeight: '700',
    marginBottom: space.s2,
  },
  body: { color: colors.ink, fontSize: typeScale.body, marginTop: space.s2 },
  list: { marginTop: space.s2 },
  warning: {
    color: colors.danger,
    fontSize: typeScale.body,
    fontWeight: '700',
    marginTop: space.s4,
  },
  section: { marginTop: space.s6 },
  name: { color: colors.brass, fontSize: typeScale.body, fontWeight: '700', marginVertical: space.s2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginTop: space.s4 },
  error: { color: colors.danger, fontSize: typeScale.body, marginTop: space.s3 },
});
