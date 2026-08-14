import { StyleSheet, Text, View } from 'react-native';

import { describeLastKnown } from '../offline/glanceCache';
import { colors } from './Screen';

/**
 * The hub's "showing last-known" indication (Epic 60 O2).
 *
 * Whenever a region of the glance is served from the offline cache rather than
 * from the API, the hub says so. It is deliberately one calm muted line under
 * the header rather than a banner, a modal, or an alarm: the tablet is on the
 * wall all day, so the honest signal must be readable at a glance without
 * shouting at the family. What it must never do is stay silent - a cached board
 * that looks live is the failure mode this ticket exists to prevent.
 *
 * The wording is derived from the record's freshness stamp, so the family can
 * tell "saved moments ago" (the network blipped) from "saved 2 days ago" (the
 * hub has been offline since the weekend).
 */
export function LastKnownBanner({ cachedAtIso }: { cachedAtIso: string }) {
  return (
    <View style={styles.banner} testID="last-known-banner">
      <View style={styles.dot} />
      <Text style={styles.text}>{describeLastKnown(cachedAtIso)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brass },
  text: { color: colors.muted, fontSize: 16 },
});
