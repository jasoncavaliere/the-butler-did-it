import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Screen, colors } from '../components/Screen';
import { space, typeScale } from '../theme/theme';

/** How long the "Household deleted" notice shows before the setup wizard (#168). */
export const HOUSEHOLD_DELETED_NOTICE_MS = 3_000;

/** Every word the notice shows (plain ASCII). */
export const HOUSEHOLD_DELETED_COPY = {
  heading: 'Household deleted',
  body: 'Everything for that household is gone from Butler. Next, set up a new household.',
} as const;

/**
 * The brief notice after a successful household teardown (#168). The root
 * navigator shows it in place of the whole navigation container, so it outlives
 * the signed-in stack the teardown just removed; after {@link durationMs} it
 * calls {@link onDone} and the navigator lands on the setup wizard.
 */
export function HouseholdDeletedScreen({
  onDone,
  durationMs = HOUSEHOLD_DELETED_NOTICE_MS,
}: {
  onDone: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [onDone, durationMs]);

  return (
    <Screen testID="household-deleted-screen">
      <Text style={styles.heading} accessibilityRole="header">
        {HOUSEHOLD_DELETED_COPY.heading}
      </Text>
      <Text style={styles.body}>{HOUSEHOLD_DELETED_COPY.body}</Text>
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
});
