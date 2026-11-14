import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { WidgetEmpty, WidgetError, WidgetSkeleton } from './WidgetState';

describe('WidgetState', () => {
  it('draws the requested number of skeleton bars with a caption', async () => {
    await render(<WidgetSkeleton testID="skeleton" caption="Loading the thing..." lines={2} />);

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton.props.accessibilityRole).toBe('progressbar');
    expect(skeleton.props.accessibilityLabel).toBe('Loading the thing...');
    expect(screen.getByText('Loading the thing...')).toBeOnTheScreen();
    // Two bars plus the caption.
    expect(skeleton.children).toHaveLength(3);
  });

  it('renders an empty title alone when no detail is given', async () => {
    await render(<WidgetEmpty testID="empty" title="Nothing here." />);

    expect(screen.getByTestId('empty')).toHaveTextContent('Nothing here.');
  });

  it('renders an empty title with its detail line', async () => {
    await render(<WidgetEmpty testID="empty" title="Nothing here." detail="Add one." />);

    expect(screen.getByText('Nothing here.')).toBeOnTheScreen();
    expect(screen.getByText('Add one.')).toBeOnTheScreen();
  });

  it('renders an error as an alert with a Try again that calls onRetry', async () => {
    const onRetry = jest.fn();
    await render(
      <WidgetError testID="error" message="It did not load." onRetry={onRetry} retryTestID="retry" />,
    );

    expect(screen.getByTestId('error').props.accessibilityRole).toBe('alert');
    expect(screen.getByText('It did not load.')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('retry')));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an error without a retry button when onRetry is absent', async () => {
    await render(<WidgetError testID="error" message="It did not load." />);

    expect(screen.getByText('It did not load.')).toBeOnTheScreen();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
