import { render, screen, waitFor } from '@testing-library/react-native';

import { VersionInfo } from './VersionInfo';
import type { ApiClient, ApiResult } from '../api/client';
import { useApiClient } from '../api/useApiClient';
import { VERSION_PATH } from '../api/version';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, etag: null });

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

/** A client whose version read resolves to `result`. */
function versionClient(result: ApiResult<unknown> | Promise<ApiResult<unknown>>): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (): Promise<ApiResult<unknown>> => result) as unknown as ApiClient['get'],
    update: jest.fn() as unknown as ApiClient['update'],
  };
}

const savedSha = process.env.EXPO_PUBLIC_BUILD_SHA;

/** Render with `EXPO_PUBLIC_BUILD_SHA` set to `uiSha` (unset when undefined). */
async function renderWith(client: ApiClient, uiSha: string | undefined) {
  if (uiSha === undefined) {
    delete process.env.EXPO_PUBLIC_BUILD_SHA;
  } else {
    process.env.EXPO_PUBLIC_BUILD_SHA = uiSha;
  }
  useApiClientMock.mockReturnValue(client);
  return await render(<VersionInfo />);
}

afterEach(() => {
  useApiClientMock.mockReset();
  if (savedSha === undefined) {
    delete process.env.EXPO_PUBLIC_BUILD_SHA;
  } else {
    process.env.EXPO_PUBLIC_BUILD_SHA = savedSha;
  }
});

describe('VersionInfo', () => {
  it('shows EXPO_PUBLIC_BUILD_SHA as the hub version', async () => {
    await renderWith(versionClient(ok({ sha: 'abc1234', buildTime: null })), 'abc1234');

    expect(screen.getByTestId('version-ui-sha')).toHaveTextContent('abc1234');
    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('abc1234'));
  });

  it('shows dev as the hub version when EXPO_PUBLIC_BUILD_SHA is unset', async () => {
    await renderWith(versionClient(ok({ sha: 'dev', buildTime: null })), undefined);

    expect(screen.getByTestId('version-ui-sha')).toHaveTextContent('dev');
    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('dev'));
  });

  it('fetches /api/system/version and shows the API sha and build time', async () => {
    const client = versionClient(ok({ sha: 'abc1234', buildTime: '2026-11-14T10:00:00Z' }));
    await renderWith(client, 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('abc1234'));
    expect(screen.getByTestId('version-api-build-time')).toHaveTextContent('2026-11-14T10:00:00Z');
    expect(client.get).toHaveBeenCalledWith(VERSION_PATH);
  });

  it('shows unknown when the API has no build time', async () => {
    await renderWith(versionClient(ok({ sha: 'abc1234', buildTime: null })), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-build-time')).toHaveTextContent('unknown'));
  });

  it('shows checking... while the request is in flight', async () => {
    let answer: (result: ApiResult<unknown>) => void = () => undefined;
    const pending = new Promise<ApiResult<unknown>>((resolve) => {
      answer = resolve;
    });
    await renderWith(versionClient(pending), 'abc1234');

    expect(screen.getByTestId('version-api-sha')).toHaveTextContent('checking...');
    expect(screen.queryByTestId('version-api-build-time')).toBeNull();
    expect(screen.queryByTestId('version-mismatch')).toBeNull();

    answer(ok({ sha: 'abc1234', buildTime: null }));
    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('abc1234'));
  });

  it('shows no mismatch when the shas match', async () => {
    await renderWith(versionClient(ok({ sha: 'abc1234', buildTime: '2026-11-14T10:00:00Z' })), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-build-time')).toBeOnTheScreen());
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
  });

  it('flags a mismatch when the hub and API shas differ', async () => {
    await renderWith(versionClient(ok({ sha: 'def5678', buildTime: '2026-11-14T10:00:00Z' })), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-mismatch')).toBeOnTheScreen());
    expect(screen.getByTestId('version-ui-sha')).toHaveTextContent('abc1234');
    expect(screen.getByTestId('version-api-sha')).toHaveTextContent('def5678');
  });

  it('shows the API version as unavailable and no mismatch when the request fails', async () => {
    await renderWith(versionClient(unreachable), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('unavailable'));
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
    expect(screen.queryByTestId('version-api-build-time')).toBeNull();
  });

  it('treats a malformed body as unavailable', async () => {
    await renderWith(versionClient(ok({ buildTime: '2026-11-14T10:00:00Z' })), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('unavailable'));
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
  });

  it('treats a rejected request as unavailable', async () => {
    await renderWith(versionClient(Promise.reject(new Error('boom'))), 'abc1234');

    await waitFor(() => expect(screen.getByTestId('version-api-sha')).toHaveTextContent('unavailable'));
    expect(screen.queryByTestId('version-mismatch')).toBeNull();
  });

  it('ignores an answer that arrives after unmount', async () => {
    let answer: (result: ApiResult<unknown>) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const late = new Promise<ApiResult<unknown>>((resolve) => {
      answer = resolve;
    });
    const lateFailure = new Promise<ApiResult<unknown>>((_resolve, reject) => {
      fail = reject;
    });

    const first = await renderWith(versionClient(late), 'abc1234');
    await first.unmount();
    answer(ok({ sha: 'abc1234', buildTime: null }));

    const second = await renderWith(versionClient(lateFailure), 'abc1234');
    await second.unmount();
    fail(new Error('late'));

    await expect(late).resolves.toBeDefined();
    await expect(lateFailure).rejects.toThrow('late');
  });
});
