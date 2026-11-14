import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from './Screen';
import { DEFAULT_HUB_LAYOUT, type HubLayout } from '../layout/hubLayout';
import { radii } from '../layout/tokens';
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
 *
 * Its padding and heading size come from the hub `layout` (#118). In a landscape
 * layout the panel fills its zone and its body scrolls, so a board taller than
 * the fit model's budget scrolls inside the panel instead of pushing the page.
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
  layout = DEFAULT_HUB_LAYOUT,
}: {
  children?: ReactNode;
  activeParticipant?: TodayPanelParticipant | null;
  state?: TodayPanelState;
  onRetry?: () => void;
  /** The hub layout to size the panel for; portrait when omitted. */
  layout?: HubLayout;
}) {
  const styles = useMemo(() => makePanelStyles(layout), [layout]);
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
        numberOfLines={1}
      >
        {activeParticipant ? `${activeParticipant.displayName}'s day` : 'Today'}
      </Text>
      {/* The body: scrolls inside the panel in landscape, plain in portrait. */}
      {renderBody(
        layout,
        styles,
        state === 'loading' ? (
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
        ),
      )}
    </View>
  );
}

type PanelStyles = ReturnType<typeof makePanelStyles>;

function renderBody(layout: HubLayout, styles: PanelStyles, body: ReactNode) {
  if (layout.orientation === 'landscape') {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="today-panel-scroll"
      >
        {body}
      </ScrollView>
    );
  }
  return <View style={styles.body}>{body}</View>;
}

function makePanelStyles(layout: HubLayout) {
  return StyleSheet.create({
    panel: {
      flex: 1,
      minHeight: 240,
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: layout.panelPadding,
    },
    heading: {
      color: colors.brass,
      fontSize: layout.panelHeadingSize,
      lineHeight: layout.panelHeadingLineHeight,
      fontWeight: '700',
      letterSpacing: 3,
      textTransform: 'uppercase',
      marginBottom: layout.panelHeadingGap,
    },
    body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  });
}
