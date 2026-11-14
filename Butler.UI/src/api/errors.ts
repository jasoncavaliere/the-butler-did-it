/**
 * Turns a normalized {@link ApiError} into a single user-readable line. The F7
 * client already collapses every failure mode (HTTP status, RFC 7807 problem
 * details, unreachable API, unparseable body) into one shape; this picks the
 * most specific human message from it so screens surface validation/error
 * states (Engineering Contract 7.5) instead of failing silently.
 */

import type { ApiError } from './client';

/** Build a readable message for an API failure, preferring problem-details text. */
export function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case 'problem':
      // RFC 7807: `detail` is the human explanation (e.g. an unknown RoomId);
      // fall back to the title, then the status.
      return error.detail ?? error.title ?? `Request failed (${error.status}).`;
    case 'network':
      return 'The household service is unreachable. Check your connection and try again.';
    case 'parse':
      return 'The household service returned an unexpected response. Please try again.';
    case 'http':
    default:
      return error.title || `Request failed (${error.status}).`;
  }
}

/**
 * Fixed, friendly lines for a failed request (ADR-0007, the voice guide). They
 * never echo server text: a problem `detail` or `title` is meant for the
 * developer, not the household, so flows that must never show raw error text
 * (household setup) use these instead of {@link describeApiError}.
 */
export const FRIENDLY_ERROR = {
  network: 'We could not reach Butler. Check the connection, then tap Try again.',
  rejected: 'That did not go through. Check the details, then tap Try again.',
  failed: 'Butler could not finish that just now. Tap Try again.',
} as const;

/**
 * Map an API failure to one of the {@link FRIENDLY_ERROR} lines: unreachable is
 * `network`, a 4xx refusal is `rejected`, anything else is `failed`.
 */
export function friendlyApiError(error: ApiError): string {
  if (error.kind === 'network') return FRIENDLY_ERROR.network;
  if (error.status >= 400 && error.status <= 499) return FRIENDLY_ERROR.rejected;
  return FRIENDLY_ERROR.failed;
}

/**
 * True when a write was refused as stale (`412 Precondition Failed`): the
 * `If-Match` ETag no longer matches the stored item (Engineering Contract 7.3).
 * Screens answer it with a reload prompt instead of re-sending the edit.
 */
export function isPreconditionFailed(error: ApiError): boolean {
  return error.status === 412;
}
