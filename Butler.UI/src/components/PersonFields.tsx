import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Field } from './FormControls';
import { colors } from './Screen';
import { claimColors } from '../theme/theme';

/** The editable fields of one person: what the people form shows and sends. */
export type PersonDraft = {
  displayName: string;
  isChild: boolean;
  /** The stored claim colour (a dark-variant hex), or `null` for none. */
  claimColor: string | null;
};

/**
 * The people-step form fields shared by onboarding (`HouseholdSetup`) and the
 * organizer's Roster editor (#167): the person's name, a child switch, and the
 * six claim-colour swatches ({@link claimColors}). A swatch stores its
 * dark-variant hex because the hub is dark-only (#120). A colour that is not a
 * preset (or `null`) shows no selected swatch and is left as it is until a
 * swatch is tapped. The component is controlled: every change hands the whole
 * merged draft to {@link onChange}. There is deliberately no role control.
 */
export function PersonFields({
  value,
  onChange,
}: {
  value: PersonDraft;
  onChange: (next: PersonDraft) => void;
}) {
  return (
    <View>
      <Field
        label="Person name"
        testID="input-person-name"
        value={value.displayName}
        onChangeText={(displayName) => onChange({ ...value, displayName })}
        placeholder="Alex"
      />
      <View style={styles.row}>
        <Text style={styles.label}>Child</Text>
        <Switch
          testID="input-person-child"
          value={value.isChild}
          onValueChange={(isChild) => onChange({ ...value, isChild })}
        />
      </View>
      <Text style={styles.label}>Claim colour</Text>
      <View style={styles.swatches}>
        {claimColors.map((color) => {
          const selected = value.claimColor === color.dark;
          return (
            <Pressable
              key={color.name}
              testID={`claim-color-${color.name}`}
              accessibilityRole="button"
              accessibilityLabel={color.name}
              accessibilityState={{ selected }}
              onPress={() => onChange({ ...value, claimColor: color.dark })}
              style={[
                styles.swatch,
                { backgroundColor: color.dark },
                selected && styles.swatchSelected,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: colors.ink },
});
