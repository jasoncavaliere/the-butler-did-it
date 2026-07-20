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
