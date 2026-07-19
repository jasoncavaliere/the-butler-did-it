import { render, screen, waitFor } from '@testing-library/react-native';

import App from './App';

describe('App', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('renders the Home screen through the navigator', async () => {
    // Stub fetch so the Home screen's health probe resolves without real network.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => JSON.stringify({ status: 'ok' }),
    })) as unknown as typeof fetch;

    await render(<App />);

    expect(await screen.findByText('Welcome home')).toBeOnTheScreen();
    await waitFor(() => {
      expect(screen.getByTestId('health-ok')).toBeOnTheScreen();
    });
  });
});
