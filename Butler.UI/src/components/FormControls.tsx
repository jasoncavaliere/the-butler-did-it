import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from './Screen';

/**
 * Shared organizer form controls: a labelled text input, a primary/secondary
 * button, and a selectable chip. Moved out of the onboarding wizard
 * (`HouseholdSetup`) so the Household editor (#112) uses the same controls.
 */

/** Labelled text input. */
export function Field({
  label,
  testID,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'numeric';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
      />
    </View>
  );
}

/** A pressable button in a primary or secondary style. */
export function ActionButton({
  testID,
  onPress,
  disabled,
  variant = 'primary',
  children,
}: {
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={variant === 'secondary' ? styles.buttonSecondaryText : styles.buttonText}>
        {children}
      </Text>
    </Pressable>
  );
}

/** A selectable chip (room / cadence picker). */
export function Chip({
  testID,
  selected,
  onPress,
  children,
}: {
  testID: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={selected ? styles.chipSelectedText : styles.chipText}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    color: colors.ink,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brass, borderColor: colors.brass },
  chipText: { color: colors.ink, fontSize: 14 },
  chipSelectedText: { color: colors.page, fontSize: 14, fontWeight: '700' },
  button: {
    backgroundColor: colors.brass,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.page, fontSize: 16, fontWeight: '700' },
  buttonSecondaryText: { color: colors.ink, fontSize: 16, fontWeight: '600' },
});
