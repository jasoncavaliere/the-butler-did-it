import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Screen, colors } from './Screen';

describe('Screen', () => {
  it('renders children inside the card', async () => {
    await render(
      <Screen testID="test-screen">
        <Text>hello inside</Text>
      </Screen>,
    );

    expect(screen.getByTestId('test-screen')).toBeOnTheScreen();
    expect(screen.getByText('hello inside')).toBeOnTheScreen();
  });

  it('renders without a testID', async () => {
    await render(
      <Screen>
        <Text>no test id</Text>
      </Screen>,
    );

    expect(screen.getByText('no test id')).toBeOnTheScreen();
  });

  it('exposes the brand palette', () => {
    expect(colors.brass).toBe('#D9B25A');
  });
});
