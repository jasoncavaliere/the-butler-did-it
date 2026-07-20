import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../components/Screen';
import { useOrganizer } from '../state/OrganizerContext';

/**
 * The organizer control strip on the hub. It is the visible half of Engineering
 * Contract 7.4's client side: when no organizer is signed in it offers only a
 * sign-in affordance, and the sensitive actions (edit roster, confirm order,
 * household teardown) are simply not rendered - a participant is never even
 * presented them. Once an organizer signs in, those affordances appear
 * alongside sign-out.
 *
 * This is defense-in-depth only: the server enforces the `Organizer` policy
 * (F6/T5), so a hidden affordance is convenience, not the security boundary.
 * The strip is independent of the participant tap-to-claim state.
 */
export type OrganizerBarProps = {
  /** Invoked when the organizer taps "Delete household" (teardown). */
  onHouseholdTeardown?: () => void;
  /** Invoked when the organizer taps "Confirm order". */
  onConfirmOrder?: () => void;
  /** Invoked when the organizer taps "Edit roster". */
  onEditRoster?: () => void;
};

const noop = () => undefined;

export function OrganizerBar({
  onHouseholdTeardown = noop,
  onConfirmOrder = noop,
  onEditRoster = noop,
}: OrganizerBarProps) {
  const { organizer, signIn, signOut } = useOrganizer();

  if (!organizer) {
    return (
      <View style={styles.bar} testID="organizer-bar">
        <Pressable
          accessibilityRole="button"
          testID="organizer-sign-in"
          style={styles.button}
          onPress={() => {
            void signIn();
          }}
        >
          <Text style={styles.buttonText}>Organizer sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.bar} testID="organizer-bar">
      <Text style={styles.identity} testID="organizer-identity" numberOfLines={1}>
        {organizer.name}
      </Text>
      <View style={styles.actions} testID="organizer-actions">
        <Affordance testID="affordance-edit-roster" label="Edit roster" onPress={onEditRoster} />
        <Affordance
          testID="affordance-confirm-order"
          label="Confirm order"
          onPress={onConfirmOrder}
        />
        <Affordance
          testID="affordance-household-teardown"
          label="Delete household"
          onPress={onHouseholdTeardown}
        />
        <Pressable
          accessibilityRole="button"
          testID="organizer-sign-out"
          style={styles.button}
          onPress={() => {
            void signOut();
          }}
        >
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A single sensitive-action button, only ever rendered for a signed-in organizer. */
function Affordance({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" testID={testID} style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  identity: { color: colors.brass, fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  buttonText: { color: colors.brass, fontSize: 14, fontWeight: '600' },
  action: {
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  actionText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
});
