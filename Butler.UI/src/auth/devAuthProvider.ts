/**
 * Development auth provider: the client-side counterpart to the F6
 * `DevOrganizerAuthenticationHandler`. When `DisableAuthentication` is set the
 * UI "signs in" as a deterministic dev organizer with no token, so local and CI
 * runs need no live Entra tenant and no committed secrets. The API's dev handler
 * authenticates every request as the same dev organizer, so a `null` token is
 * correct - the bearer would be ignored server side anyway.
 */

import type { IAuthProvider, OrganizerSession } from './authProvider';

/**
 * The deterministic dev organizer, matching the API's
 * `OrganizerAuthorization.DevOrganizerSubject` / `DevOrganizerName` so dev-mode
 * identity is consistent across the UI and API.
 */
export const DEV_ORGANIZER_SESSION: OrganizerSession = {
  organizer: {
    subject: 'dev-organizer-00000000-0000-0000-0000-000000000000',
    name: 'Development Organizer',
  },
  token: null,
};

/** Build a dev auth provider that signs in as {@link DEV_ORGANIZER_SESSION}. */
export function createDevAuthProvider(
  session: OrganizerSession = DEV_ORGANIZER_SESSION,
): IAuthProvider {
  return {
    kind: 'dev',
    signIn() {
      return Promise.resolve(session);
    },
    signOut() {
      // No external session to revoke in dev mode.
      return Promise.resolve();
    },
  };
}
