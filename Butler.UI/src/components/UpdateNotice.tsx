import { StyleSheet, Text, View } from 'react-native';

import { colors } from './Screen';

/** How long the "Updated to build ..." line stays before it quietly goes. */
export const UPDATE_NOTICE_MS = 10_000;

/**
 * The hub's "picked up a new build" line (#108).
 *
 * After the hub reloads onto a newly deployed build it says so once, in the same calm muted style
 * as the last-known line, so whoever is near the tablet can tell the screen refreshed on purpose.
 * The shell hides it after {@link UPDATE_NOTICE_MS}; there is nothing to dismiss.
 */
export function UpdateNotice({ build }: { build: string }) {
  return (
    <View style={styles.notice} testID="hub-update-notice" accessibilityLiveRegion="polite">
      <View style={styles.dot} />
      <Text style={styles.text}>{`Updated to build ${build}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brass },
  text: { color: colors.muted, fontSize: 16 },
});
