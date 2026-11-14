import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from './Screen';
import { WidgetEmpty, WidgetError, WidgetSkeleton } from './WidgetState';

/**
 * The hub's "today" region: a clearly-bounded container the chore board (Epic 40
 * C5) fills. This is the documented seam - the shell hands the panel to C5 and
 * C5 populates it, so the hub layout never has to be restructured. It renders
 * whatever children it is given and knows nothing about chores, which is what
 * stops the shell from boxing in C5.
 *
 * The shell drives its load `state` (P8, ADR-0007): `loading` shows a calm
 * skeleton, `error` shows a friendly message with a "Try again" that calls
 * `onRetry`, and `ready` shows the children, or a designed empty state when
 * there are none. It never renders a blank panel or raw error text.
 *
 * When the hub has an active participant (T3 tap-to-claim), it is handed here so
 * "what's mine glows": the panel is accented in the participant's claim colour
 * and labelled as their day. With no active participant the panel stays in the
 * neutral glance state.
 */
export type TodayPanelParticipant = { displayName: string; claimColor: string | null };

/** The shell's load phase the panel reflects. */
export type TodayPanelState = 'loading' | 'error' | 'ready';

const COPY = {
  loading: 'Getting today ready...',
  emptyTitle: 'Ready when you are.',
  emptyDetail: "Today's board appears here once the household is set.",
  loadFailed: "Today's board did not load. Tap Try again.",
} as const;

export function TodayPanel({
  children,
  activeParticipant = null,
  state = 'ready',
  onRetry,
}: {
  children?: ReactNode;
  activeParticipant?: TodayPanelParticipant | null;
  state?: TodayPanelState;
  onRetry?: () => void;
}) {
  // `false`/`null`/`undefined` all mean "no board yet"; anything else is real
  // content C5 has slotted in.
  const hasContent = children !== undefined && children !== null && children !== false;

  const accent = activeParticipant ? activeParticipant.claimColor ?? colors.brass : null;

  return (
    <View
      style={[styles.panel, accent !== null && { borderColor: accent, borderWidth: 2 }]}
      testID="today-panel"
    >
      <Text
        style={[styles.heading, accent !== null && { color: accent }]}
        accessibilityRole="header"
      >
        {activeParticipant ? `${activeParticipant.displayName}'s day` : 'Today'}
      </Text>
      <View style={styles.body}>
        {state === 'loading' ? (
          <WidgetSkeleton testID="today-panel-loading" caption={COPY.loading} />
        ) : state === 'error' ? (
          <WidgetError
            testID="today-panel-error"
            message={COPY.loadFailed}
            onRetry={onRetry}
            retryTestID="today-panel-retry"
          />
        ) : hasContent ? (
          children
        ) : (
          <WidgetEmpty
            testID="today-panel-empty"
            title={COPY.emptyTitle}
            detail={COPY.emptyDetail}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 240,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
  },
  heading: {
    color: colors.brass,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
