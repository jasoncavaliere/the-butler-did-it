import { createApiClient } from './client';
import { apiBaseUrl } from './config';

const BASE = 'http://api.test:9000';

type MockResponseInit = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  /** Body returned by `text()`; omit for an empty body. */
  body?: string;
  /** When set, `text()` rejects with this cause (simulates a read failure). */
  textError?: unknown;
};

/** Build a minimal `Response`-like object with a case-insensitive header bag. */
function mockResponse(init: MockResponseInit = {}): Response {
  const headerEntries = Object.entries(init.headers ?? {}).map(
    ([k, v]) => [k.toLowerCase(), v] as const,
  );
  const headers = {
    get: (name: string): string | null => {
      const match = headerEntries.find(([k]) => k === name.toLowerCase());
      return match ? match[1] : null;
    },
  };
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers,
    text: async () => {
      if ('textError' in init) {
        throw init.textError;
      }
      return init.body ?? '';
    },
  } as unknown as Response;
}

describe('createApiClient', () => {
  it('exposes the configured base URL', () => {
    const client = createApiClient({ baseUrl: BASE, fetchImpl: jest.fn() });
    expect(client.baseUrl).toBe(BASE);
  });

  describe('get', () => {
    it('sends JSON accept headers to the joined base URL and returns parsed data', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({ body: JSON.stringify({ status: 'ok' }) }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get<{ status: string }>('/health');

      expect(fetchImpl).toHaveBeenCalledWith('http://api.test:9000/health', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      expect(result).toEqual({
        ok: true,
        status: 200,
        data: { status: 'ok' },
        etag: null,
      });
    });

    it('surfaces the response ETag on a read', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({ headers: { ETag: 'W/"v1"' }, body: JSON.stringify({ id: 1 }) }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms/1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.etag).toBe('W/"v1"');
      }
    });

    it('returns undefined data for a 204 response without reading the body', async () => {
      const text = jest.fn();
      const fetchImpl = jest.fn(async () => {
        const response = mockResponse({ status: 204 });
        (response as unknown as { text: unknown }).text = text;
        return response;
      });
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/things');

      expect(text).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, status: 204, data: undefined, etag: null });
    });

    it('returns undefined data for a 200 with an empty body', async () => {
      const fetchImpl = jest.fn(async () => mockResponse({ status: 200, body: '' }));
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/things');

      expect(result).toEqual({ ok: true, status: 200, data: undefined, etag: null });
    });

    it('normalizes a network failure (API unreachable) to a network error', async () => {
      const fetchImpl = jest.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/health');

      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'network',
          status: 0,
          title: 'The API is unreachable.',
          detail: 'Failed to fetch',
        },
      });
    });

    it('normalizes a non-Error network throw using String()', async () => {
      const fetchImpl = jest.fn(async () => {
        throw 'boom';
      });
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/health');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
        expect(result.error.detail).toBe('boom');
      }
    });

    it('normalizes an unparseable success body to a parse error', async () => {
      const fetchImpl = jest.fn(async () => mockResponse({ body: 'not-json{' }));
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/health');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('parse');
        expect(result.error.status).toBe(200);
        expect(result.error.title).toBe('The API response was not valid JSON.');
      }
    });

    it('normalizes a body-read failure on success to a parse error', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({ status: 200, textError: new Error('stream closed') }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/health');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('parse');
        expect(result.error.title).toBe('The API response could not be read.');
        expect(result.error.detail).toBe('stream closed');
      }
    });

    it('normalizes RFC 7807 problem details to a problem error', async () => {
      const problem = {
        type: 'https://butler.test/errors/not-found',
        title: 'Household not found',
        status: 404,
        detail: 'No household with that id.',
      };
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/problem+json' },
          body: JSON.stringify(problem),
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/households/x');

      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'problem',
          status: 404,
          title: 'Household not found',
          detail: 'No household with that id.',
          type: 'https://butler.test/errors/not-found',
          problem,
        },
      });
    });

    it('treats a JSON error body with a title as a problem even without the problem+json type', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Validation failed' }),
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('problem');
        expect(result.error.title).toBe('Validation failed');
        expect(result.error.detail).toBeUndefined();
        expect(result.error.type).toBeUndefined();
      }
    });

    it('falls back to the status text when a problem+json body omits a title', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: { 'content-type': 'application/problem+json' },
          body: JSON.stringify({ status: 409 }),
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms/1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('problem');
        expect(result.error.title).toBe('Conflict');
      }
    });

    it('normalizes a plain (non-JSON) error body to an http error', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
          body: 'boom',
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result).toEqual({
        ok: false,
        error: { kind: 'http', status: 500, title: 'Internal Server Error' },
      });
    });

    it('normalizes a JSON array error body (object but not problem-shaped) to an http error', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(['nope']),
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('http');
        expect(result.error.title).toBe('Unprocessable Entity');
      }
    });

    it('normalizes a non-object JSON error body to an http error', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify('just a string'),
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('http');
        expect(result.error.title).toBe('Bad Request');
      }
    });

    it('normalizes an unparseable error body to an http error', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'content-type': 'application/json' },
          body: '<<not json>>',
        }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('http');
        expect(result.error.title).toBe('Bad Gateway');
      }
    });

    it('handles an error response whose body cannot be read', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({ ok: false, status: 503, statusText: '', textError: new Error('gone') }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      const result = await client.get('/rooms');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Empty statusText falls back to `HTTP <status>`.
        expect(result.error).toEqual({ kind: 'http', status: 503, title: 'HTTP 503' });
      }
    });
  });

  describe('update', () => {
    it('sends JSON content-type and serialized body with a default PUT method', async () => {
      const fetchImpl = jest.fn(async () =>
        mockResponse({ body: JSON.stringify({ ok: true }) }),
      );
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      await client.update('/rooms/1', { name: 'Kitchen' });

      expect(fetchImpl).toHaveBeenCalledWith('http://api.test:9000/rooms/1', {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Kitchen' }),
      });
    });

    it('sends the captured ETag as an If-Match header', async () => {
      const fetchImpl = jest.fn(async () => mockResponse({ status: 204 }));
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      await client.update('/rooms/1', { name: 'Den' }, { ifMatch: 'W/"v7"' });

      expect(fetchImpl).toHaveBeenCalledWith('http://api.test:9000/rooms/1', {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'If-Match': 'W/"v7"',
        },
        body: JSON.stringify({ name: 'Den' }),
      });
    });

    it('honors a custom HTTP method', async () => {
      const fetchImpl = jest.fn(async () => mockResponse({ status: 204 }));
      const client = createApiClient({ baseUrl: BASE, fetchImpl });

      await client.update('/rooms/1', { name: 'Den' }, { method: 'PATCH' });

      expect(fetchImpl).toHaveBeenCalledWith(
        'http://api.test:9000/rooms/1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('default fetch implementation', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('falls back to the global fetch when no fetchImpl is provided', async () => {
      const globalFetch = jest.fn(async () =>
        mockResponse({ body: JSON.stringify({ status: 'ok' }) }),
      );
      globalThis.fetch = globalFetch as unknown as typeof fetch;

      const client = createApiClient({ baseUrl: BASE });
      const result = await client.get('/health');

      expect(globalFetch).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });

  it('defaults the base URL join to the resolved apiBaseUrl seam when constructed with it', async () => {
    const fetchImpl = jest.fn(async () => mockResponse({ body: '{}' }));
    const client = createApiClient({ baseUrl: apiBaseUrl, fetchImpl });

    await client.get('/health');

    expect(fetchImpl).toHaveBeenCalledWith(`${apiBaseUrl}/health`, expect.anything());
  });
});
