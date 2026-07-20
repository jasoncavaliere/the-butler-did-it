/**
 * Typed fetch client for Butler.UI.
 *
 * This is the shared data-access seam (F7): every later UI ticket calls the API
 * through this client instead of reinventing `fetch`. It injects the base URL
 * (via {@link apiUrl}), sets JSON headers, surfaces the response `ETag` on reads
 * and sends it back as `If-Match` on updates, and normalizes every outcome --
 * success, HTTP error, RFC 7807 problem details, an unreachable API, or an
 * unparseable body -- to a single {@link ApiResult} discriminated union so
 * callers never have to catch a raw fetch error.
 *
 * Offline behavior (Epic 60) layers on top of this seam; it is out of scope here.
 */

import { apiUrl } from './config';

/**
 * RFC 7807 problem details payload (`application/problem+json`). Extra members
 * beyond the standard fields are allowed by the spec, hence the index signature.
 */
export type ProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
};

/**
 * The category of a normalized failure:
 * - `http` -- an error status with a non-problem (or empty) body.
 * - `problem` -- an error status carrying RFC 7807 problem details.
 * - `network` -- the request never completed (API unreachable / fetch threw).
 * - `parse` -- a success status whose body could not be read or parsed as JSON.
 */
export type ApiErrorKind = 'http' | 'problem' | 'network' | 'parse';

/** A normalized error, common to every failure mode the client can surface. */
export type ApiError = {
  kind: ApiErrorKind;
  /** HTTP status, or `0` for a network error that never reached the server. */
  status: number;
  title: string;
  detail?: string;
  type?: string;
  /** The full RFC 7807 payload when {@link kind} is `problem`. */
  problem?: ProblemDetails;
};

/** The result of any client call: a success carrying data, or a normalized error. */
export type ApiResult<T> =
  | { ok: true; status: number; data: T; etag: string | null }
  | { ok: false; error: ApiError };

/** Options for an update (write) call. */
export type UpdateOptions = {
  /** ETag captured from a prior read, sent as the `If-Match` header. */
  ifMatch?: string;
  /** HTTP method for the write; defaults to `PUT`. */
  method?: 'PUT' | 'PATCH' | 'POST' | 'DELETE';
};

/** The typed API client surface shared across the UI. */
export type ApiClient = {
  readonly baseUrl: string;
  /** GET `path`, returning parsed JSON plus the response ETag on success. */
  get<T>(path: string): Promise<ApiResult<T>>;
  /** Write `body` to `path` (PUT by default), sending `If-Match` when provided. */
  update<T>(path: string, body: unknown, options?: UpdateOptions): Promise<ApiResult<T>>;
};

/** Options for {@link createApiClient}. */
export type CreateApiClientOptions = {
  baseUrl: string;
  /** Fetch implementation; defaults to the global `fetch` (injectable for tests). */
  fetchImpl?: typeof fetch;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Build a normalized error from an error-status response. */
async function toErrorResult(response: Response): Promise<ApiResult<never>> {
  const statusText = response.statusText || `HTTP ${response.status}`;
  const contentType = response.headers.get('content-type') ?? '';

  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    rawText = '';
  }

  if (rawText) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    if (parsed && typeof parsed === 'object') {
      const problem = parsed as ProblemDetails;
      const looksLikeProblem =
        contentType.includes('application/problem+json') || typeof problem.title === 'string';

      if (looksLikeProblem) {
        return {
          ok: false,
          error: {
            kind: 'problem',
            status: response.status,
            title: problem.title ?? statusText,
            detail: problem.detail,
            type: problem.type,
            problem,
          },
        };
      }
    }
  }

  return { ok: false, error: { kind: 'http', status: response.status, title: statusText } };
}

/** Read + parse the body of a success response into a typed result. */
async function toSuccessResult<T>(response: Response): Promise<ApiResult<T>> {
  const etag = response.headers.get('ETag');

  if (response.status === 204) {
    return { ok: true, status: response.status, data: undefined as T, etag };
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: 'parse',
        status: response.status,
        title: 'The API response could not be read.',
        detail: messageOf(cause),
      },
    };
  }

  if (!rawText) {
    return { ok: true, status: response.status, data: undefined as T, etag };
  }

  try {
    return { ok: true, status: response.status, data: JSON.parse(rawText) as T, etag };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: 'parse',
        status: response.status,
        title: 'The API response was not valid JSON.',
        detail: messageOf(cause),
      },
    };
  }
}

/**
 * Create a typed API client bound to a base URL. Callers use {@link ApiClient.get}
 * and {@link ApiClient.update}; both always resolve to an {@link ApiResult} and
 * never reject.
 */
export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const { baseUrl } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  async function send<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const url = apiUrl(path, baseUrl);

    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch (cause) {
      return {
        ok: false,
        error: {
          kind: 'network',
          status: 0,
          title: 'The API is unreachable.',
          detail: messageOf(cause),
        },
      };
    }

    return response.ok ? toSuccessResult<T>(response) : toErrorResult(response);
  }

  return {
    baseUrl,
    get<T>(path: string): Promise<ApiResult<T>> {
      return send<T>(path, { method: 'GET', headers: { Accept: 'application/json' } });
    },
    update<T>(path: string, body: unknown, updateOptions: UpdateOptions = {}): Promise<ApiResult<T>> {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (updateOptions.ifMatch) {
        headers['If-Match'] = updateOptions.ifMatch;
      }
      return send<T>(path, {
        method: updateOptions.method ?? 'PUT',
        headers,
        body: JSON.stringify(body),
      });
    },
  };
}
