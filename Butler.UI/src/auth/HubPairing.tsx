import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { describeApiError } from '../api/errors';
import type { HubDevicePairingResponse, PairHubDeviceRequest } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { colors } from '../components/Screen';
import { useHousehold } from '../state/HouseholdContext';
import { useHubDevice } from '../state/HubDeviceContext';
import { useOrganizer } from '../state/OrganizerContext';

/**
 * The minimal hub-device pairing affordance (T5). Pairing is a sensitive action,
 * so this renders only for a signed-in organizer (T4) - a participant never even
 * sees it. Tapping it calls the organizer-gated pair endpoint through the F7
 * client and stores the returned long-lived device token in
 * {@link useHubDevice}, making the tablet a first-class, long-lived actor.
 *
 * The hidden affordance is convenience, not the security boundary: the server
 * enforces the `Organizer` policy on the pair endpoint (T5 API side), so a token
 * can never be minted without organizer authority.
 */
const DEFAULT_DEVICE_NAME = 'This tablet';

type PairState =
  | { phase: 'idle' }
  | { phase: 'pairing' }
  | { phase: 'paired' }
  | { phase: 'error'; message: string };

export function HubPairing({ deviceName = DEFAULT_DEVICE_NAME }: { deviceName?: string }) {
  const { isSignedIn } = useOrganizer();
  const { householdId } = useHousehold();
  const { isPaired, setDeviceToken } = useHubDevice();
  const client = useApiClient();
  const [state, setState] = useState<PairState>({ phase: 'idle' });

  const pair = useCallback(async () => {
    // Without a selected household there is nothing to pair into.
    if (householdId === null) {
      setState({ phase: 'error', message: 'Set up a household before pairing this tablet.' });
      return;
    }

    setState({ phase: 'pairing' });
    const body: PairHubDeviceRequest = { deviceName };
    const result = await client.update<HubDevicePairingResponse>(
      `/households/${householdId}/hub-devices/pair`,
      body,
      { method: 'POST' },
    );

    if (!result.ok) {
      setState({ phase: 'error', message: describeApiError(result.error) });
      return;
    }

    // Store the long-lived device token for the hub's subsequent use.
    setDeviceToken(result.data.token);
    setState({ phase: 'paired' });
  }, [client, deviceName, householdId, setDeviceToken]);

  // Hidden for anyone who is not a signed-in organizer.
  if (!isSignedIn) {
    return null;
  }

  const label = isPaired || state.phase === 'paired' ? 'Tablet paired' : 'Pair this tablet';

  return (
    <View style={styles.wrap} testID="hub-pairing">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: state.phase === 'pairing' }}
        testID="hub-pairing-button"
        disabled={state.phase === 'pairing'}
        style={styles.button}
        onPress={() => {
          void pair();
        }}
      >
        <Text style={styles.buttonText}>
          {state.phase === 'pairing' ? 'Pairing...' : label}
        </Text>
      </Pressable>
      {state.phase === 'error' && (
        <Text style={styles.error} testID="hub-pairing-error">
          {state.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  button: {
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  error: { color: colors.brass, fontSize: 12 },
});
