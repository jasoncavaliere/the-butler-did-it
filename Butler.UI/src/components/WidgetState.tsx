import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './Screen';

/**
 * Shared load states for the hub widgets (TodayPanel, ChoreBoard, FairnessView,
 * GroceryCart) and household setup. ADR-0007: loading is a calm skeleton, never a
 * blank panel; an empty widget gets a designed title and a small detail line; a
 * failure is an icon plus friendly text plus colour, with a manual "Try again"
 * (automatic retry is #109). Status is never colour alone (ADR-0010).
 */

/** A static skeleton: a few soft bars and a muted caption. No animation. */
export function WidgetSkeleton({
  testID,
  caption,
  lines = 3,
}: {
  testID?: string;
  caption: string;
  lines?: number;
}) {
  const bars = Array.from({ length: lines }, (_, index) => index);
  return (
    <View
      style={styles.skeleton}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={caption}
    >
      {bars.map((index) => (
        <View
          key={index}
          style={[styles.bar, index === lines - 1 && styles.barShort]}
          importantForAccessibility="no"
        />
      ))}
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

/** A designed empty state: a title and an optional small detail line. */
export function WidgetEmpty({
  testID,
  title,
  detail,
}: {
  testID?: string;
  title: string;
  detail?: string;
}) {
  return (
    <View style={styles.empty} testID={testID}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

/**
 * A friendly error: a circled "!" in the danger colour, the message in ink, and
 * a "Try again" button only when `onRetry` is given.
 */
export function WidgetError({
  testID,
  message,
  onRetry,
  retryTestID,
}: {
  testID?: string;
  message: string;
  onRetry?: () => void;
  retryTestID?: string;
}) {
  return (
    <View style={styles.error} testID={testID} accessibilityRole="alert">
      <View style={styles.errorRow}>
        <View
          style={styles.mark}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.markGlyph}>!</Text>
        </View>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={styles.retry}
          accessibilityRole="button"
          testID={retryTestID}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { width: '100%', gap: 12, paddingVertical: 8 },
  bar: { height: 20, borderRadius: 4, backgroundColor: colors.border, width: '100%' },
  barShort: { width: '60%' },
  caption: { color: colors.muted, fontSize: 15, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  emptyDetail: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  error: { width: '100%', gap: 12, paddingVertical: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: { color: colors.danger, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.ink, fontSize: 16, flexShrink: 1 },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  retryText: { color: colors.ink, fontSize: 16, fontWeight: '600' },
});
