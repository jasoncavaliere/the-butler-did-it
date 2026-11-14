import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { lineHeightFor, motionDuration, space, typeScale } from '../layout/tokens';
import { colors } from './Screen';

/**
 * The small celebration a chore row shows when the active participant completes
 * it (#119): a check in their claim colour (ADR-0003 accent) and a calm line of
 * copy. It is a child of the row, never an overlay, and it disables nothing, so
 * tapping the row again is still the #65 undo and the next row still takes a
 * tap while it plays.
 *
 * Animated, it fades and scales in, holds, and fades out, in well under a
 * second (ADR-0006: gentle and quick, from the motion tokens). Under
 * prefers-reduced-motion it renders the same content statically. The board's
 * timer, not an animation callback, decides when it goes away
 * ({@link CELEBRATION_DURATION_MS}).
 *
 * It stays a single line with no vertical padding or border, so the row keeps
 * the height `measureHubBoard` (#118) assumes. The message is in ink, not the
 * claim colour, so it stays legible on the card surface (ADR-0003).
 */

/** Fade and scale in. */
export const CELEBRATION_ENTER_MS = motionDuration.slow;
/** Hold, fully shown. */
export const CELEBRATION_HOLD_MS = 400;
/** Fade out. */
export const CELEBRATION_EXIT_MS = motionDuration.slow;
/** The whole celebration (#119 AC6: at most 1000 ms). */
export const CELEBRATION_DURATION_MS =
  CELEBRATION_ENTER_MS + CELEBRATION_HOLD_MS + CELEBRATION_EXIT_MS;

/** The copy: plain and calm, per the voice guide (no exclamation marks, no points). */
export const CELEBRATION_MESSAGE = 'Nice work.';

type Props = {
  /** The completing participant's claim colour (or the board's fallback). */
  accent: string;
  /** Render statically, with no animation (prefers-reduced-motion). */
  reducedMotion: boolean;
  testID: string;
};

export function ChoreCelebration({ accent, reducedMotion, testID }: Props) {
  const content = <CelebrationContent accent={accent} testID={testID} />;
  return reducedMotion ? content : <AnimatedCelebration testID={testID}>{content}</AnimatedCelebration>;
}

function CelebrationContent({ accent, testID }: { accent: string; testID: string }) {
  return (
    <View style={styles.content} testID={testID}>
      <Text style={[styles.text, { color: accent }]} testID={`${testID}-check`}>
        ✓
      </Text>
      <Text style={styles.text} numberOfLines={1} testID={`${testID}-message`}>
        {CELEBRATION_MESSAGE}
      </Text>
    </View>
  );
}

function AnimatedCelebration({ testID, children }: { testID: string; children: ReactNode }) {
  // Held in state (created once) rather than a ref, so render never reads a ref.
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.8));

  useEffect(() => {
    const easing = Easing.out(Easing.ease);
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: CELEBRATION_ENTER_MS,
          easing,
          useNativeDriver: false,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: CELEBRATION_ENTER_MS,
          easing,
          useNativeDriver: false,
        }),
      ]),
      Animated.delay(CELEBRATION_HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: CELEBRATION_EXIT_MS,
        easing,
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, scale]);

  return (
    <Animated.View
      style={[styles.motion, { opacity, transform: [{ scale }] }]}
      testID={`${testID}-motion`}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  motion: { flexShrink: 0, marginLeft: 'auto' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    flexShrink: 0,
    marginLeft: 'auto',
  },
  text: {
    color: colors.ink,
    fontSize: typeScale.body,
    lineHeight: lineHeightFor(typeScale.body),
  },
});
