import { render, screen } from '@testing-library/react-native';

import App from './App';

describe('App', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('routes an authenticated organizer with no household into the setup flow', async () => {
    // No household is selected on a fresh launch, so the navigator mounts the
    // onboarding flow. Stub fetch so the organizer gate's `GET /me` probe
    // resolves as an authenticated organizer without real network.
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => JSON.stringify({ subject: 'dev-organizer', name: 'Dev Organizer' }),
    })) as unknown as typeof fetch;

    await render(<App />);

    expect(await screen.findByText('Create your household')).toBeOnTheScreen();
  });
});
