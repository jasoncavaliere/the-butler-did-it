import { render, screen } from '@testing-library/react-native';

import { HomeScreen } from './HomeScreen';
import { AppConfigProvider } from '../state/AppConfigContext';

describe('HomeScreen', () => {
  it('renders the placeholder home content', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText('Welcome home')).toBeOnTheScreen();
    expect(screen.getByText('The household hub is being set up.')).toBeOnTheScreen();
  });

  it('shows the configured API base from context', async () => {
    await render(
      <AppConfigProvider value={{ apiBaseUrl: 'http://example.test:1234' }}>
        <HomeScreen />
      </AppConfigProvider>,
    );

    expect(screen.getByText('API base: http://example.test:1234')).toBeOnTheScreen();
  });
});
