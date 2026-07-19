import { Component, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';

import { HouseholdProvider, useHousehold } from './HouseholdContext';

function Probe() {
  const { householdId, setHouseholdId } = useHousehold();
  return (
    <>
      <Text testID="value">hh:{householdId ?? 'none'}</Text>
      <TouchableOpacity testID="set" onPress={() => setHouseholdId('hh-42')}>
        <Text>set</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="clear" onPress={() => setHouseholdId(null)}>
        <Text>clear</Text>
      </TouchableOpacity>
    </>
  );
}

/** Catches a render-time throw so we can assert on it deterministically. */
class ErrorBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }

  render() {
    return this.state.failed ? <Text testID="boundary">caught</Text> : this.props.children;
  }
}

describe('HouseholdContext / useHousehold', () => {
  it('defaults to no household when no initial value is provided', async () => {
    await render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('hh:none');
  });

  it('seeds the initial household when provided', async () => {
    await render(
      <HouseholdProvider initialHouseholdId="hh-1">
        <Probe />
      </HouseholdProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('hh:hh-1');
  });

  it('updates the household through the setter and can clear it', async () => {
    await render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    fireEvent.press(screen.getByTestId('set'));
    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('hh:hh-42');
    });

    fireEvent.press(screen.getByTestId('clear'));
    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('hh:none');
    });
  });

  it('throws when used outside a HouseholdProvider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let captured = '';

    await render(
      <ErrorBoundary onError={(message) => (captured = message)}>
        <Probe />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('boundary')).toBeOnTheScreen();
    expect(captured).toBe('useHousehold must be used within a HouseholdProvider');
    spy.mockRestore();
  });
});
