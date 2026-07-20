import { act, render, screen, waitFor } from '@testing-library/react-native';

import { HomeScreen } from './HomeScreen';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { AppConfigProvider } from '../state/AppConfigContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

/** A client whose `get` resolves with the supplied result. */
function clientReturning(result: ApiResult<{ status: string }>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HomeScreen', () => {
  it('renders the placeholder home content and API base', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({ ok: true, status: 200, data: { status: 'ok' }, etag: null }),
    );

    await render(
      <AppConfigProvider value={{ apiBaseUrl: 'http://example.test:1234' }}>
        <HomeScreen />
      </AppConfigProvider>,
    );

    expect(screen.getByText('Welcome home')).toBeOnTheScreen();
    expect(screen.getByText('The household hub is being set up.')).toBeOnTheScreen();
    expect(screen.getByText('API base: http://example.test:1234')).toBeOnTheScreen();
  });

  it('shows the loading state until the health call resolves', async () => {
    let resolve: (result: ApiResult<{ status: string }>) => void = () => {};
    const pending = new Promise<ApiResult<{ status: string }>>((r) => {
      resolve = r;
    });
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    await render(<HomeScreen />);

    expect(screen.getByTestId('health-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve({ ok: true, status: 200, data: { status: 'ok' }, etag: null });
      await pending;
    });

    expect(screen.queryByTestId('health-loading')).toBeNull();
  });

  it('shows the healthy state with the returned status value', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({ ok: true, status: 200, data: { status: 'ok' }, etag: null }),
    );

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('health-ok')).toHaveTextContent('Household service: ok');
    });
  });

  it('falls back to "unknown" when a healthy response carries no data', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({
        ok: true,
        status: 200,
        data: undefined as unknown as { status: string },
        etag: null,
      }),
    );

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('health-ok')).toHaveTextContent('Household service: unknown');
    });
  });

  it('shows a graceful error state when the API is unreachable', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({
        ok: false,
        error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
      }),
    );

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('health-error')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('health-ok')).toBeNull();
  });

  it('ignores a health result that resolves after the screen unmounts', async () => {
    let resolve: (result: ApiResult<{ status: string }>) => void = () => {};
    const pending = new Promise<ApiResult<{ status: string }>>((r) => {
      resolve = r;
    });
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    const view = await render(<HomeScreen />);
    await act(async () => {
      view.unmount();
    });

    // Resolving after unmount must not throw or update state (active guard).
    await act(async () => {
      resolve({ ok: true, status: 200, data: { status: 'ok' }, etag: null });
      await pending;
    });

    expect(screen.queryByTestId('health-ok')).toBeNull();
  });
});
