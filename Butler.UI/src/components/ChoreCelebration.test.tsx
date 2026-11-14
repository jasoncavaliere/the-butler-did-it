import { render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

import {
  CELEBRATION_DURATION_MS,
  CELEBRATION_ENTER_MS,
  CELEBRATION_EXIT_MS,
  CELEBRATION_HOLD_MS,
  CELEBRATION_MESSAGE,
  ChoreCelebration,
} from './ChoreCelebration';
import { colors } from './Screen';
import { lineHeightFor, motionDuration, typeScale } from '../layout/tokens';

const ACCENT = '#B0206F';

// The animation's frames run on the fake clock, so none tick outside act.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ChoreCelebration timing (#119 AC6)', () => {
  it('lasts at most 1000 ms in all, and each transition uses a motion token', () => {
    expect(CELEBRATION_DURATION_MS).toBeLessThanOrEqual(1000);
    expect(CELEBRATION_ENTER_MS + CELEBRATION_HOLD_MS + CELEBRATION_EXIT_MS).toBe(
      CELEBRATION_DURATION_MS,
    );
    expect(Object.values(motionDuration)).toContain(CELEBRATION_ENTER_MS);
    expect(Object.values(motionDuration)).toContain(CELEBRATION_EXIT_MS);
  });

  it('configures the animation with exactly those durations', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const delay = jest.spyOn(Animated, 'delay');

    await render(<ChoreCelebration accent={ACCENT} reducedMotion={false} testID="cel" />);

    const durations = timing.mock.calls.map(([, config]) => config.duration);
    // Opacity and scale enter together, then opacity exits.
    expect(durations).toEqual([CELEBRATION_ENTER_MS, CELEBRATION_ENTER_MS, CELEBRATION_EXIT_MS]);
    expect(timing.mock.calls.every(([, config]) => config.useNativeDriver === false)).toBe(true);
    expect(delay).toHaveBeenCalledWith(CELEBRATION_HOLD_MS);
    const total = CELEBRATION_ENTER_MS + CELEBRATION_HOLD_MS + CELEBRATION_EXIT_MS;
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('ChoreCelebration', () => {
  it('uses a calm, plain message (voice guide: no exclamation marks)', () => {
    expect(CELEBRATION_MESSAGE).toBe('Nice work.');
    expect(CELEBRATION_MESSAGE).not.toMatch(/!/);
  });

  it('renders the animated variant with a motion wrapper, the check in the accent and the message in ink', async () => {
    await render(<ChoreCelebration accent={ACCENT} reducedMotion={false} testID="cel" />);

    expect(screen.getByTestId('cel')).toBeOnTheScreen();
    expect(screen.getByTestId('cel-motion')).toBeOnTheScreen();
    const check = StyleSheet.flatten(screen.getByTestId('cel-check').props.style);
    expect(screen.getByTestId('cel-check')).toHaveTextContent('✓');
    expect(check.color).toBe(ACCENT);
    const message = screen.getByTestId('cel-message');
    expect(message).toHaveTextContent(CELEBRATION_MESSAGE);
    expect(message.props.numberOfLines).toBe(1);
    const messageStyle = StyleSheet.flatten(message.props.style);
    expect(messageStyle.color).toBe(colors.ink);
    expect(messageStyle.fontSize).toBe(typeScale.body);
    expect(messageStyle.lineHeight).toBe(lineHeightFor(typeScale.body));
  });

  it('renders the static variant with no motion wrapper and no animation', async () => {
    const sequence = jest.spyOn(Animated, 'sequence');

    await render(<ChoreCelebration accent={ACCENT} reducedMotion testID="cel" />);

    expect(screen.getByTestId('cel')).toBeOnTheScreen();
    expect(screen.queryByTestId('cel-motion')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('cel-check').props.style).color).toBe(ACCENT);
    expect(screen.getByTestId('cel-message')).toHaveTextContent(CELEBRATION_MESSAGE);
    expect(sequence).not.toHaveBeenCalled();
  });

  it('stops its animation on unmount', async () => {
    const realSequence = Animated.sequence;
    let stop: jest.SpyInstance | undefined;
    jest.spyOn(Animated, 'sequence').mockImplementation((animations) => {
      const animation = realSequence(animations);
      stop = jest.spyOn(animation, 'stop');
      return animation;
    });

    const { unmount } = await render(
      <ChoreCelebration accent={ACCENT} reducedMotion={false} testID="cel" />,
    );
    expect(stop).toBeDefined();
    expect(stop).not.toHaveBeenCalled();

    await unmount();

    expect(stop).toHaveBeenCalled();
  });
});
