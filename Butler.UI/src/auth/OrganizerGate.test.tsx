import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { OrganizerGate } from './OrganizerGate';
import type { ApiClient, ApiResult } from '../api/client';
import type { MeResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import type { IAuthProvider, OrganizerSession } from './authProvider';
import { OrganizerProvider, useOrganizer } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

function clientReturning(result: ApiResult<MeResponse>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async () => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

function child() {
  return <Text testID="gated-child">secret flow</Text>;
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('OrganizerGate', () => {
  it('shows a loading state until the /me probe resolves', async () => {
    let resolve: (result: ApiResult<MeResponse>) => void = () => {};
    const pending = new Promise<ApiResult<MeResponse>>((r) => {
      resolve = r;
    });
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    await render(<OrganizerGate>{child()}</OrganizerGate>);

    expect(screen.getByTestId('organizer-gate-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('gated-child')).toBeNull();

    await act(async () => {
      resolve({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null });
      await pending;
    });
  });

  it('renders the children when the caller is an authenticated organizer', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null }),
    );

    await render(<OrganizerGate>{child()}</OrganizerGate>);

    await waitFor(() => {
      expect(screen.getByTestId('gated-child')).toBeOnTheScreen();
    });
  });

  it('blocks with a sign-in message on a 401', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({
        ok: false,
        error: { kind: 'http', status: 401, title: 'Unauthorized' },
      }),
    );

    await render(<OrganizerGate>{child()}</OrganizerGate>);

    await waitFor(() => {
      expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen();
    });
    expect(screen.getByText('Sign in as an organizer to set up your household.')).toBeOnTheScreen();
    expect(screen.queryByTestId('gated-child')).toBeNull();
  });

  it('blocks with a sign-in message on a 403', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({
        ok: false,
        error: { kind: 'http', status: 403, title: 'Forbidden' },
      }),
    );

    await render(<OrganizerGate>{child()}</OrganizerGate>);

    await waitFor(() => {
      expect(screen.getByText('Sign in as an organizer to set up your household.')).toBeOnTheScreen();
    });
  });

  it('blocks with the API error message when the service is unreachable', async () => {
    useApiClientMock.mockReturnValue(
      clientReturning({
        ok: false,
        error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
      }),
    );

    await render(<OrganizerGate>{child()}</OrganizerGate>);

    await waitFor(() => {
      expect(
        screen.getByText(
          'The household service is unreachable. Check your connection and try again.',
        ),
      ).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('gated-child')).toBeNull();
  });

  it('ignores a probe that resolves after the gate unmounts', async () => {
    let resolve: (result: ApiResult<MeResponse>) => void = () => {};
    const pending = new Promise<ApiResult<MeResponse>>((r) => {
      resolve = r;
    });
    useApiClientMock.mockReturnValue({
      baseUrl: 'http://api.test:1',
      get: jest.fn(() => pending) as unknown as ApiClient['get'],
      update: jest.fn() as unknown as ApiClient['update'],
    });

    const view = await render(<OrganizerGate>{child()}</OrganizerGate>);
    await act(async () => {
      view.unmount();
    });

    await act(async () => {
      resolve({ ok: true, status: 200, data: { subject: 'org', name: 'Org' }, etag: null });
      await pending;
    });

    expect(screen.queryByTestId('gated-child')).toBeNull();
  });

  describe('with the demo PIN provider (#105)', () => {
    const SESSION: OrganizerSession = {
      organizer: { subject: 'dev-organizer', name: 'Demo Organizer' },
      token: 'tok-1',
    };

    function provider(kind: string): IAuthProvider {
      return { kind, signIn: jest.fn(async () => SESSION), signOut: () => Promise.resolve() };
    }

    const unauthorized = (status: number) =>
      clientReturning({ ok: false, error: { kind: 'http', status, title: 'Nope' } });

    async function renderGate(kind: string) {
      await render(
        <OrganizerProvider authProvider={provider(kind)}>
          <OrganizerGate>{child()}</OrganizerGate>
        </OrganizerProvider>,
      );
    }

    it.each([401, 403])('shows a PIN pad when the provider is pin and /me is %i', async (status) => {
      useApiClientMock.mockReturnValue(unauthorized(status));

      await renderGate('pin');

      await waitFor(() => {
        expect(screen.getByTestId('organizer-gate-pin')).toBeOnTheScreen();
      });
      expect(screen.getByTestId('pin-pad')).toBeOnTheScreen();
      expect(screen.queryByTestId('gated-child')).toBeNull();
    });

    it('shows no PIN pad for a non-pin provider', async () => {
      useApiClientMock.mockReturnValue(unauthorized(401));

      await renderGate('entra');

      await waitFor(() => {
        expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen();
      });
      expect(screen.queryByTestId('organizer-gate-pin')).toBeNull();
    });

    it('shows no PIN pad when the API is unreachable', async () => {
      useApiClientMock.mockReturnValue(
        clientReturning({ ok: false, error: { kind: 'network', status: 0, title: 'The API is unreachable.' } }),
      );

      await renderGate('pin');

      await waitFor(() => {
        expect(screen.getByTestId('organizer-gate-blocked')).toBeOnTheScreen();
      });
      expect(screen.queryByTestId('organizer-gate-pin')).toBeNull();
    });

    it('renders the children once the PIN signs the organizer in', async () => {
      const blocked = unauthorized(401);
      const authorized = clientReturning({
        ok: true,
        status: 200,
        data: { subject: 'dev-organizer', name: 'Demo Organizer' },
        etag: null,
      });
      // The real hook rebuilds the client when the organizer token changes.
      useApiClientMock.mockImplementation(() => (useOrganizer().token ? authorized : blocked));

      await renderGate('pin');
      await waitFor(() => {
        expect(screen.getByTestId('pin-pad')).toBeOnTheScreen();
      });

      for (const digit of '2468') {
        await act(async () => {
          fireEvent.press(screen.getByTestId(`pin-digit-${digit}`));
        });
      }
      await act(async () => {
        fireEvent.press(screen.getByTestId('pin-submit'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('gated-child')).toBeOnTheScreen();
      });
    });
  });
});
