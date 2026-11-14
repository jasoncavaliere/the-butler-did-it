import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../components/Screen';
import { useOrganizer } from '../state/OrganizerContext';
import { PinSignInError } from './pinAuthProvider';

/** The shortest and longest PIN the API accepts (4-6 digits). */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 6;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** The message shown for a refused sign-in. */
export function pinErrorMessage(error: unknown): string {
  if (error instanceof PinSignInError) {
    if (error.reason === 'invalid') {
      return 'That PIN is not right.';
    }
    if (error.reason === 'locked') {
      return error.retryAfterSeconds === undefined
        ? 'Too many tries. Try again in a minute.'
        : `Too many tries. Try again in ${error.retryAfterSeconds} seconds.`;
    }
    return error.message;
  }
  return 'Sign-in failed. Please try again.';
}

export type PinPadProps = {
  /** Called after the PIN signs the organizer in. */
  onSignedIn?: () => void;
  /** When given, a Cancel button is shown and calls it. */
  onCancel?: () => void;
};

/**
 * The organizer PIN pad for the local demo PIN provider (#105). Digits 0-9, a
 * backspace, and a submit enabled at 4-6 digits; the entry is masked. Submitting
 * calls the organizer context's `signIn({ pin })`; a refused PIN clears the
 * entry and says why (wrong PIN, or locked out with the seconds to wait). The
 * PIN is held only in component state while typing and never stored.
 */
export function PinPad({ onSignedIn, onCancel }: PinPadProps) {
  const { signIn } = useOrganizer();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && pin.length >= MIN_PIN_LENGTH && pin.length <= MAX_PIN_LENGTH;

  const addDigit = (digit: string) => {
    setError(null);
    setPin((current) => (current.length < MAX_PIN_LENGTH ? current + digit : current));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn({ pin });
      setPin('');
      setBusy(false);
      onSignedIn?.();
    } catch (cause) {
      setPin('');
      setBusy(false);
      setError(pinErrorMessage(cause));
    }
  };

  return (
    <View style={styles.pad} testID="pin-pad">
      <Text style={styles.label}>Organizer PIN</Text>
      <Text style={styles.display} testID="pin-display" accessibilityLabel={`${pin.length} digits entered`}>
        {pin.length > 0 ? '•'.repeat(pin.length) : 'Enter PIN'}
      </Text>
      {error ? (
        <Text style={styles.error} testID="pin-error" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {DIGITS.map((digit) => (
          <Pressable
            key={digit}
            accessibilityRole="button"
            accessibilityLabel={digit}
            testID={`pin-digit-${digit}`}
            style={styles.key}
            disabled={busy}
            onPress={() => addDigit(digit)}
          >
            <Text style={styles.keyText}>{digit}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete last digit"
          testID="pin-backspace"
          style={styles.key}
          disabled={busy}
          onPress={() => setPin((current) => current.slice(0, -1))}
        >
          <Text style={styles.keyText}>Del</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        {onCancel ? (
          <Pressable accessibilityRole="button" testID="pin-cancel" style={styles.button} onPress={onCancel}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          testID="pin-submit"
          style={[styles.button, styles.submit, !canSubmit && styles.disabled]}
          disabled={!canSubmit}
          onPress={() => {
            void submit();
          }}
        >
          <Text style={styles.submitText}>Sign in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 12, maxWidth: 320 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  display: { color: colors.ink, fontSize: 28, letterSpacing: 8, minHeight: 36 },
  error: { color: colors.danger, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: {
    width: 64,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { color: colors.ink, fontSize: 20, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  buttonText: { color: colors.brass, fontSize: 14, fontWeight: '600' },
  submit: { backgroundColor: colors.brass },
  submitText: { color: colors.page, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
