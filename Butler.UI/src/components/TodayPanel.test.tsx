import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { TodayPanel } from './TodayPanel';
import { LANDSCAPE_COMPACT } from '../layout/hubLayout';

describe('TodayPanel', () => {
  it('renders the calm empty placeholder when given no children', async () => {
    await render(<TodayPanel />);

    expect(screen.getByTestId('today-panel')).toBeOnTheScreen();
    expect(screen.getByText('Ready when you are.')).toBeOnTheScreen();
  });

  it('renders supplied children (the C5 seam) instead of the placeholder', async () => {
    await render(
      <TodayPanel>
        <Text testID="board-content">Chore board goes here</Text>
      </TodayPanel>,
    );

    expect(screen.getByTestId('board-content')).toBeOnTheScreen();
    expect(screen.queryByTestId('today-panel-empty')).toBeNull();
  });

  it('treats a falsey child as no content and shows the placeholder', async () => {
    await render(<TodayPanel>{false}</TodayPanel>);

    expect(screen.getByTestId('today-panel-empty')).toBeOnTheScreen();
  });

  it('labels the panel as the active participant\'s day, accented in their claim colour', async () => {
    await render(<TodayPanel activeParticipant={{ displayName: 'Alex', claimColor: '#B0206F' }} />);

    expect(screen.getByText("Alex's day")).toBeOnTheScreen();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('scrolls its body inside the panel in a landscape layout (#118)', async () => {
    await render(
      <TodayPanel layout={LANDSCAPE_COMPACT}>
        <Text testID="board-content">Chore board goes here</Text>
      </TodayPanel>,
    );

    const scroll = screen.getByTestId('today-panel-scroll');
    expect(within(scroll).getByTestId('board-content')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('today-panel').props.style)).toMatchObject({
      padding: LANDSCAPE_COMPACT.panelPadding,
    });
  });

  it('keeps a plain body (no inner scroll) in the default portrait layout', async () => {
    await render(<TodayPanel />);

    expect(screen.queryByTestId('today-panel-scroll')).toBeNull();
  });

  it('falls back to the brass accent when the active participant has no claim colour', async () => {
    await render(<TodayPanel activeParticipant={{ displayName: 'Sam', claimColor: null }} />);

    expect(screen.getByText("Sam's day")).toBeOnTheScreen();
  });

  describe('load states', () => {
    it('renders a skeleton while the shell is loading', async () => {
      await render(<TodayPanel state="loading" />);

      expect(screen.getByTestId('today-panel-loading')).toBeOnTheScreen();
      expect(screen.getByText('Getting today ready...')).toBeOnTheScreen();
      expect(screen.queryByTestId('today-panel-empty')).toBeNull();
    });

    it('renders the designed empty state when ready with no board', async () => {
      await render(<TodayPanel state="ready" />);

      expect(screen.getByTestId('today-panel-empty')).toBeOnTheScreen();
      expect(screen.getByText('Ready when you are.')).toBeOnTheScreen();
      expect(
        screen.getByText("Today's board appears here once the household is set."),
      ).toBeOnTheScreen();
    });

    it('renders a friendly error with a retry', async () => {
      await render(<TodayPanel state="error" onRetry={jest.fn()} />);

      expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();
      expect(screen.getByText("Today's board did not load. Tap Try again.")).toBeOnTheScreen();
      expect(screen.getByTestId('today-panel-retry')).toHaveTextContent('Try again');
    });
  });

  describe('retry', () => {
    it('Try again calls onRetry', async () => {
      const onRetry = jest.fn();
      await render(<TodayPanel state="error" onRetry={onRetry} />);

      await act(async () => fireEvent.press(screen.getByTestId('today-panel-retry')));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows no retry button when no onRetry is given', async () => {
      await render(<TodayPanel state="error" />);

      expect(screen.getByTestId('today-panel-error')).toBeOnTheScreen();
      expect(screen.queryByTestId('today-panel-retry')).toBeNull();
    });
  });
});
