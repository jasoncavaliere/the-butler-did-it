import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from './Screen';

/**
 * The hub's "today" region: a clearly-bounded container the chore board (Epic 40
 * C5) fills. This is the documented seam - the shell hands the panel to C5 and
 * C5 populates it, so the hub layout never has to be restructured. In this
 * ticket it ships as a dumb placeholder: it renders whatever children it is
 * given, and shows a calm empty message when given none. Keeping it a pass-through
 * container (rather than knowing anything about chores) is what stops the shell
 * from boxing in C5.
 *
 * When the hub has an active participant (T3 tap-to-claim), it is handed here so
 * "what's mine glows": the panel is accented in the participant's claim colour
 * and labelled as their day. With no active participant the panel stays in the
 * neutral glance state.
 */
export type TodayPanelParticipant = { displayName: string; claimColor: string | null };

export function TodayPanel({
  children,
  activeParticipant = null,
}: {
  children?: ReactNode;
  activeParticipant?: TodayPanelParticipant | null;
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
        {hasContent ? (
          children
        ) : (
          <Text style={styles.empty} testID="today-panel-empty">
            The board is being prepared.
          </Text>
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
  empty: { color: colors.muted, fontSize: 22, textAlign: 'center' },
});
