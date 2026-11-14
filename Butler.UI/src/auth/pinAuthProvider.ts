/**
 * Local demo PIN auth provider (#105): the client side of the API's
 * `POST /auth/pin/sign-in`. The organizer types the PIN on the {@link PinPad};
 * the API answers with a short-lived organizer token (sliding 15-minute idle
 * expiry) that the API client then sends as `Authorization: Bearer`. It is a
 * Demo-only provider - the API refuses the PIN provider outside Development and
 * Demo - selected with `EXPO_PUBLIC_AUTH_PROVIDER=pin`.
 *
 * The token lives only in memory here (and in the API): a reload or an API
 * restart signs the organizer out. The PIN itself is never stored.
 */

import { createApiClient } from '../api/client';
import { describeApiError } from '../api/errors';
import type { IAuthProvider, OrganizerSession, SignInCredentials } from './authProvider';

/** Why a PIN sign-in was refused. */
export type PinSignInFailure = 'invalid' | 'locked' | 'unavailable';

/** The rejection {@link createPinAuthProvider}'s `signIn` throws when the PIN is refused. */
export class PinSignInError extends Error {
  /** `invalid` (wrong or empty PIN), `locked` (too many tries), or `unavailable` (any other failure). */
  readonly reason: PinSignInFailure;
  /** Seconds until a PIN is accepted again, when {@link reason} is `locked`. */
  readonly retryAfterSeconds?: number;

  constructor(reason: PinSignInFailure, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'PinSignInError';
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Injected dependencies for the PIN provider. */
export type PinAuthDeps = {
  /** The API base URL (absolute or same-origin relative, e.g. `/api`). */
  apiBaseUrl: string;
  /** Fetch implementation; defaults to the global `fetch` (injectable for tests). */
  fetchImpl?: typeof fetch;
};

/** The body of a successful `POST /auth/pin/sign-in`. */
type PinSignInResponse = {
  token: string;
  subject: string;
  name: string;
  idleTimeoutSeconds: number;
};

const SIGN_IN_PATH = '/auth/pin/sign-in';
const SIGN_OUT_PATH = '/auth/pin/sign-out';

/** Build the demo PIN provider against the API at `deps.apiBaseUrl`. */
export function createPinAuthProvider(deps: PinAuthDeps): IAuthProvider {
  const { apiBaseUrl, fetchImpl } = deps;
  const client = createApiClient({ baseUrl: apiBaseUrl, fetchImpl });
  // The last issued token, so sign-out can revoke it server side.
  let currentToken: string | null = null;

  return {
    kind: 'pin',
    async signIn(credentials?: SignInCredentials): Promise<OrganizerSession> {
      const pin = credentials?.pin ?? '';
      if (!pin) {
        throw new PinSignInError('invalid', 'Enter the organizer PIN.');
      }

      const result = await client.update<PinSignInResponse>(SIGN_IN_PATH, { pin }, { method: 'POST' });
      if (result.ok) {
        currentToken = result.data.token;
        return {
          organizer: { subject: result.data.subject, name: result.data.name },
          token: result.data.token,
        };
      }

      const { error } = result;
      if (error.status === 401) {
        throw new PinSignInError('invalid', describeApiError(error));
      }
      if (error.status === 429) {
        const retryAfter = error.problem?.retryAfterSeconds;
        throw new PinSignInError(
          'locked',
          describeApiError(error),
          typeof retryAfter === 'number' ? retryAfter : undefined,
        );
      }
      throw new PinSignInError('unavailable', describeApiError(error));
    },
    async signOut(): Promise<void> {
      const token = currentToken;
      currentToken = null;
      if (!token) {
        return;
      }
      // Best effort: the local session ends regardless of the API's answer.
      const signOutClient = createApiClient({ baseUrl: apiBaseUrl, fetchImpl, getAuthToken: () => token });
      await signOutClient.update(SIGN_OUT_PATH, {}, { method: 'POST' });
    },
  };
}
