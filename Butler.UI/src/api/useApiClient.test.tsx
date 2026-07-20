import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useApiClient } from './useApiClient';
import { AppConfigProvider } from '../state/AppConfigContext';

function Probe() {
  const client = useApiClient();
  return <Text testID="base">{client.baseUrl}</Text>;
}

describe('useApiClient', () => {
  it('builds a client bound to the configured API base URL', async () => {
    await render(
      <AppConfigProvider value={{ apiBaseUrl: 'http://example.test:1234' }}>
        <Probe />
      </AppConfigProvider>,
    );

    expect(screen.getByTestId('base')).toHaveTextContent('http://example.test:1234');
  });

  it('memoizes the client across re-renders with the same base URL', async () => {
    const clients: unknown[] = [];

    function Capture() {
      clients.push(useApiClient());
      return <Text>x</Text>;
    }

    const view = await render(
      <AppConfigProvider value={{ apiBaseUrl: 'http://stable.test:1' }}>
        <Capture />
      </AppConfigProvider>,
    );

    await view.rerender(
      <AppConfigProvider value={{ apiBaseUrl: 'http://stable.test:1' }}>
        <Capture />
      </AppConfigProvider>,
    );

    expect(clients.length).toBeGreaterThanOrEqual(2);
    expect(clients[0]).toBe(clients[clients.length - 1]);
  });
});
