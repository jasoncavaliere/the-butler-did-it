import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { describeApiError } from '../api/errors';
import type { MeResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { Screen, colors } from '../components/Screen';

/**
 * Gates its children behind an authenticated organizer. It probes the
 * organizer-only `GET /me` endpoint (the F6 auth seam) through the F7 client:
 * a `200` means the caller is a resolved organizer (in dev mode the API returns
 * the dev organizer), so the children render; a `401`/`403` means the visitor
 * is not an authenticated organizer and the flow is withheld; any other failure
 * (unreachable API, etc.) is surfaced without exposing the flow.
 *
 * The organizer sign-in UI itself (the Entra External ID redirect) is T4 (#18);
 * this gate consumes the auth state F6/F7 already provide and blocks otherwise.
 */
type GateState =
  | { phase: 'loading' }
  | { phase: 'authorized' }
  | { phase: 'blocked'; message: string };

export function OrganizerGate({ children }: { children: ReactNode }) {
  const client = useApiClient();
  const [state, setState] = useState<GateState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;

    client.get<MeResponse>('/me').then((result) => {
      if (!active) {
        return;
      }
      if (result.ok) {
        setState({ phase: 'authorized' });
        return;
      }

      const message =
        result.error.status === 401 || result.error.status === 403
          ? 'Sign in as an organizer to set up your household.'
          : describeApiError(result.error);
      setState({ phase: 'blocked', message });
    });

    return () => {
      active = false;
    };
  }, [client]);

  if (state.phase === 'authorized') {
    return <>{children}</>;
  }

  if (state.phase === 'loading') {
    return (
      <Screen testID="organizer-gate-loading">
        <ActivityIndicator color={colors.brass} />
        <Text style={styles.meta}>Checking your organizer access...</Text>
      </Screen>
    );
  }

  return (
    <Screen testID="organizer-gate-blocked">
      <Text style={styles.eyebrow}>BUTLER</Text>
      <Text style={styles.title} accessibilityRole="header">
        Organizer access required
      </Text>
      <Text style={styles.body}>{state.message}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', marginTop: 8, marginBottom: 12 },
  body: { color: colors.ink, fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 16 },
});
