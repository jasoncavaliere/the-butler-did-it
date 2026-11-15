import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { HIDDEN_MENU_HOLD_MS, HiddenOrganizerMenu } from './HiddenOrganizerMenu';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import { PING_PATH } from '../api/ping';
import { useApiClient } from '../api/useApiClient';
import { VERSION_PATH } from '../api/version';
import type { IAuthProvider } from '../auth/authProvider';
import { writeLastSeenDatasetId } from '../offline/datasetGuard';
import { resetSessionFallbackStorage } from '../offline/storage';
import { OrganizerProvider } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });
const down: ApiResult<unknown> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

type Answers = { ping?: ApiResult<unknown>; dataset?: ApiResult<unknown> | 'throw' };

/** A client answering the menu's reads: ping, dataset and version. */
function menuClient({ ping = ok({ status: 'ok' }), dataset = ok({ datasetId: 'ds-live' }) }: Answers = {}): ApiClient {
  return {
    baseUrl: 'https://butler-api.test/api',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === PING_PATH) {
        return ping;
      }
      if (path === DATASET_PATH) {
        if (dataset === 'throw') {
          throw new Error('boom');
        }
        return dataset;
      }
      if (path === VERSION_PATH) {
        return ok({ sha: 'api1234', buildTime: '2026-11-15T10:00:00Z' });
      }
      return down;
    }) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

function fakeProvider(signOut: () => Promise<void> = () => Promise.resolve()): IAuthProvider {
  return { kind: 'pin', signIn: () => Promise.resolve(null), signOut: jest.fn(signOut) };
}

type MenuOptions = {
  client?: ApiClient;
  provider?: IAuthProvider;
  householdId?: string | null;
  onClearLocalCache?: (() => void) | null;
  reload?: () => void;
};

async function renderMenu({
  client = menuClient(),
  provider = fakeProvider(),
  householdId = 'hh-1',
  onClearLocalCache = jest.fn(),
  reload,
}: MenuOptions = {}) {
  useApiClientMock.mockReturnValue(client);
  const onClose = jest.fn();
  await render(
    <OrganizerProvider authProvider={provider}>
      <HiddenOrganizerMenu
        householdId={householdId}
        onClose={onClose}
        onClearLocalCache={onClearLocalCache ?? undefined}
        reload={reload}
      />
    </OrganizerProvider>,
  );
  return { onClose, provider, onClearLocalCache };
}

afterEach(() => {
  useApiClientMock.mockReset();
  resetSessionFallbackStorage();
});

describe('HiddenOrganizerMenu', () => {
  it('holds for three seconds', () => {
    expect(HIDDEN_MENU_HOLD_MS).toBe(3000);
  });

  describe('status (AC5, AC6, AC7)', () => {
    it('shows the API base URL and that ping succeeds', async () => {
      const client = menuClient();
      await renderMenu({ client });

      expect(screen.getByTestId('hidden-menu-api-url')).toHaveTextContent('https://butler-api.test/api');
      await waitFor(() => expect(screen.getByTestId('hidden-menu-ping')).toHaveTextContent('OK'));
      expect(client.get).toHaveBeenCalledWith(PING_PATH);
    });

    it('shows Not reachable when ping fails', async () => {
      await renderMenu({ client: menuClient({ ping: down }) });

      await waitFor(() => expect(screen.getByTestId('hidden-menu-ping')).toHaveTextContent('Not reachable'));
    });

    it('shows Not reachable when the ping read throws', async () => {
      const client = menuClient();
      (client.get as jest.Mock).mockImplementation(async () => {
        throw new Error('boom');
      });
      await renderMenu({ client });

      await waitFor(() => expect(screen.getByTestId('hidden-menu-ping')).toHaveTextContent('Not reachable'));
    });

    it('shows the live dataset id', async () => {
      writeLastSeenDatasetId('hh-1', 'ds-old');
      await renderMenu();

      await waitFor(() => expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('ds-live'));
      expect(screen.getByTestId('hidden-menu-dataset')).not.toHaveTextContent('last seen');
    });

    it('falls back to the last-seen dataset id when the live read fails', async () => {
      writeLastSeenDatasetId('hh-1', 'ds-old');
      await renderMenu({ client: menuClient({ dataset: down }) });

      await waitFor(() =>
        expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('ds-old (last seen)'),
      );
    });

    it('falls back to the last-seen dataset id when the live read throws', async () => {
      writeLastSeenDatasetId('hh-1', 'ds-old');
      await renderMenu({ client: menuClient({ dataset: 'throw' }) });

      await waitFor(() =>
        expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('ds-old (last seen)'),
      );
    });

    it('shows the dataset as unavailable with neither a live nor a last-seen id', async () => {
      await renderMenu({ client: menuClient({ dataset: down }) });

      await waitFor(() => expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('unavailable'));
    });

    it('shows the dataset as unavailable with no household to fall back to', async () => {
      await renderMenu({ client: menuClient({ dataset: down }), householdId: null });

      await waitFor(() => expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('unavailable'));
    });

    it.each([
      ['answer', false],
      ['fail', true],
    ])('ignores reads that %s after the menu closed', async (_label, reject) => {
      const settles: (() => void)[] = [];
      const client = menuClient();
      (client.get as jest.Mock).mockImplementation(
        (path: string) =>
          new Promise((resolve, rejectRead) => {
            settles.push(() => (reject ? rejectRead(new Error('late')) : resolve(ok({ datasetId: path }))));
          }),
      );
      useApiClientMock.mockReturnValue(client);
      const view = await render(
        <HiddenOrganizerMenu householdId="hh-1" onClose={jest.fn()} />,
      );
      expect(screen.getByTestId('hidden-menu-ping')).toHaveTextContent('checking...');
      expect(screen.getByTestId('hidden-menu-dataset')).toHaveTextContent('checking...');

      await view.unmount();
      settles.forEach((settle) => settle());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(settles.length).toBeGreaterThanOrEqual(2);
    });

    it('renders VersionInfo with the UI and API build versions', async () => {
      await renderMenu();

      const menu = screen.getByTestId('hidden-menu');
      expect(within(menu).getByTestId('version-info')).toBeOnTheScreen();
      expect(within(menu).getByTestId('version-ui-sha')).toBeOnTheScreen();
      await waitFor(() => expect(within(menu).getByTestId('version-api-sha')).toHaveTextContent('api1234'));
    });
  });

  describe('actions (AC8-AC11)', () => {
    it.each([
      ['reload', 'hidden-menu-reload', 'Reload the app?'],
      ['clear', 'hidden-menu-clear-cache', 'Clear local cache?'],
      ['signOut', 'hidden-menu-sign-out', 'Sign out the organizer?'],
    ])('asks to confirm %s, and Cancel runs nothing', async (_action, button, prompt) => {
      const reload = jest.fn();
      const { provider, onClearLocalCache, onClose } = await renderMenu({ reload });

      await fireEvent.press(screen.getByTestId(button));

      expect(screen.getByTestId('hidden-menu-confirm-text')).toHaveTextContent(prompt, { exact: false });
      expect(screen.queryByTestId('hidden-menu-reload')).toBeNull();

      await fireEvent.press(screen.getByTestId('hidden-menu-confirm-cancel'));

      expect(screen.queryByTestId('hidden-menu-confirm')).toBeNull();
      expect(screen.getByTestId(button)).toBeOnTheScreen();
      expect(reload).not.toHaveBeenCalled();
      expect(onClearLocalCache).not.toHaveBeenCalled();
      expect(provider.signOut).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('reloads once when Reload app is confirmed, even on a double tap', async () => {
      const reload = jest.fn();
      await renderMenu({ reload });

      await fireEvent.press(screen.getByTestId('hidden-menu-reload'));
      expect(reload).not.toHaveBeenCalled();
      const confirm = screen.getByTestId('hidden-menu-confirm-ok');
      await fireEvent.press(confirm);
      await fireEvent.press(confirm);

      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('hidden-menu-confirm-ok').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('reloads the page through window.location.reload by default', async () => {
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
      const locationReload = jest.fn();
      Object.defineProperty(globalThis, 'location', {
        value: { reload: locationReload },
        configurable: true,
        writable: true,
      });
      try {
        await renderMenu();

        await fireEvent.press(screen.getByTestId('hidden-menu-reload'));
        await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

        expect(locationReload).toHaveBeenCalledTimes(1);
      } finally {
        if (saved) {
          Object.defineProperty(globalThis, 'location', saved);
        } else {
          delete (globalThis as { location?: unknown }).location;
        }
      }
    });

    it('clears the local cache when Clear local cache is confirmed', async () => {
      const { onClearLocalCache, onClose } = await renderMenu();

      await fireEvent.press(screen.getByTestId('hidden-menu-clear-cache'));
      expect(onClearLocalCache).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

      expect(onClearLocalCache).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('hidden-menu-confirm')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('offers no Clear local cache without a handler', async () => {
      await renderMenu({ onClearLocalCache: null });

      expect(screen.queryByTestId('hidden-menu-clear-cache')).toBeNull();
      expect(screen.getByTestId('hidden-menu-reload')).toBeOnTheScreen();
    });

    it('signs the organizer out and closes when Sign out organizer is confirmed', async () => {
      const { provider, onClose } = await renderMenu();

      await fireEvent.press(screen.getByTestId('hidden-menu-sign-out'));
      expect(provider.signOut).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(provider.signOut).toHaveBeenCalledTimes(1);
    });

    it('still closes when the sign-out is refused', async () => {
      const { provider, onClose } = await renderMenu({
        provider: fakeProvider(() => Promise.reject(new Error('refused'))),
      });

      await fireEvent.press(screen.getByTestId('hidden-menu-sign-out'));
      await fireEvent.press(screen.getByTestId('hidden-menu-confirm-ok'));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(provider.signOut).toHaveBeenCalledTimes(1);
    });

    it('closes from the Close button', async () => {
      const { onClose } = await renderMenu();

      await fireEvent.press(screen.getByTestId('hidden-menu-close'));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
