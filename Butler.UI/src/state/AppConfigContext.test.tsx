import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppConfigProvider, defaultAppConfig, useAppConfig } from './AppConfigContext';
import { apiBaseUrl } from '../api/config';

function Probe() {
  const config = useAppConfig();
  return <Text>base:{config.apiBaseUrl}</Text>;
}

describe('AppConfigContext', () => {
  it('exposes the default config derived from apiBaseUrl', () => {
    expect(defaultAppConfig.apiBaseUrl).toBe(apiBaseUrl);
  });

  it('provides the default config when no value prop is given', async () => {
    await render(
      <AppConfigProvider>
        <Probe />
      </AppConfigProvider>,
    );

    expect(screen.getByText(`base:${apiBaseUrl}`)).toBeOnTheScreen();
  });

  it('provides an explicit config value to descendants', async () => {
    await render(
      <AppConfigProvider value={{ ...defaultAppConfig, apiBaseUrl: 'http://override.test:9' }}>
        <Probe />
      </AppConfigProvider>,
    );

    expect(screen.getByText('base:http://override.test:9')).toBeOnTheScreen();
  });

  it('falls back to the default config outside any provider', async () => {
    await render(<Probe />);

    expect(screen.getByText(`base:${apiBaseUrl}`)).toBeOnTheScreen();
  });
});
