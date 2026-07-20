import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Screen, colors } from '../components/Screen';
import { useApiClient } from '../api/useApiClient';
import { useAppConfig } from '../state/AppConfigContext';

/** Shape of the System `/health` payload the API returns. */
type HealthStatus = { status: string };

/** The wiring probe's lifecycle: still calling, healthy, or the API is unreachable. */
type HealthState =
  | { phase: 'loading' }
  | { phase: 'healthy'; status: string }
  | { phase: 'error'; detail: string };

/**
 * Placeholder Home screen that also proves the F7 data-access wiring: on mount it
 * calls the API client's System `/health` endpoint and renders a loading,
 * healthy, or graceful-unreachable state. Real hub content (tap-to-claim
 * profiles, the weekly board) arrives in later UI tickets.
 */
export function HomeScreen() {
  const { apiBaseUrl } = useAppConfig();
  const client = useApiClient();
  const [health, setHealth] = useState<HealthState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;

    client.get<HealthStatus>('/health').then((result) => {
      if (!active) {
        return;
      }
      if (result.ok) {
        setHealth({ phase: 'healthy', status: result.data?.status ?? 'unknown' });
      } else {
        setHealth({ phase: 'error', detail: result.error.title });
      }
    });

    return () => {
      active = false;
    };
  }, [client]);

  return (
    <Screen testID="home-screen">
      <Text style={styles.eyebrow}>BUTLER</Text>
      <Text style={styles.title} accessibilityRole="header">
        Welcome home
      </Text>
      <Text style={styles.body}>The household hub is being set up.</Text>

      {health.phase === 'loading' && (
        <Text style={styles.meta} testID="health-loading">
          Checking the household service...
        </Text>
      )}
      {health.phase === 'healthy' && (
        <Text style={styles.healthy} testID="health-ok">
          Household service: {health.status}
        </Text>
      )}
      {health.phase === 'error' && (
        <Text style={styles.error} testID="health-error">
          Can&apos;t reach the household service. It may be offline; the hub will keep trying.
        </Text>
      )}

      <Text style={styles.meta}>API base: {apiBaseUrl}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 12 },
  body: { color: colors.ink, fontSize: 16 },
  healthy: { color: colors.brass, fontSize: 14, marginTop: 16 },
  error: { color: '#E5A0A0', fontSize: 14, marginTop: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 16 },
});
