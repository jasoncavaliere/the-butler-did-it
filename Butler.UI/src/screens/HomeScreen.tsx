import { StyleSheet, Text } from 'react-native';

import { Screen, colors } from '../components/Screen';
import { useAppConfig } from '../state/AppConfigContext';

/**
 * Placeholder Home screen. Real hub content (tap-to-claim profiles, the weekly
 * board) arrives in later UI tickets; this establishes the screen + layers.
 */
export function HomeScreen() {
  const { apiBaseUrl } = useAppConfig();

  return (
    <Screen testID="home-screen">
      <Text style={styles.eyebrow}>BUTLER</Text>
      <Text style={styles.title} accessibilityRole="header">
        Welcome home
      </Text>
      <Text style={styles.body}>The household hub is being set up.</Text>
      <Text style={styles.meta}>API base: {apiBaseUrl}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 12 },
  body: { color: colors.ink, fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13, marginTop: 16 },
});
