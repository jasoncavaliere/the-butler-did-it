/**
 * Hook that hands screens a shared {@link ApiClient} built from the app config.
 *
 * The client is memoized on the configured base URL so a component tree shares
 * one instance rather than constructing a client per render. Screens call this
 * instead of `createApiClient` directly, keeping the base URL a single seam.
 */

import { useMemo } from 'react';

import { useAppConfig } from '../state/AppConfigContext';
import { useHubDevice } from '../state/HubDeviceContext';
import { useOrganizer } from '../state/OrganizerContext';
import { createApiClient, type ApiClient } from './client';

/**
 * Return the shared API client for the current {@link useAppConfig} base URL,
 * threading whichever credential the shared device holds - exactly one per
 * request (#105).
 *
 * A signed-in organizer (T4) wins: its token goes as `Authorization: Bearer`
 * and satisfies every policy. With no organizer signed in - the always-on
 * tablet's normal state - the paired hub-device token (T5) from
 * {@link useHubDevice} goes on the `X-Device-Token` header (never as a bearer),
 * so household reads and the hub's own writes (generate a week C3,
 * tap-to-complete C4, capture) authenticate as "The Hub". When neither is
 * present (an unpaired tablet with no organizer) no credential is sent.
 *
 * When the API rejects the organizer token (expired after 15 idle minutes, or
 * revoked), the client calls {@link useOrganizer}'s `clearSession` and retries
 * that request once as the device, so the hub returns to participant-only mode
 * without an error. The client is rebuilt when the base URL, either token, or
 * `clearSession` changes (it is stable), so sign-in/sign-out or pair/unpair
 * flips the credential on subsequent requests.
 */
export function useApiClient(): ApiClient {
  const { apiBaseUrl } = useAppConfig();
  const { token: organizerToken, clearSession } = useOrganizer();
  const { deviceToken } = useHubDevice();
  return useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        getAuthToken: () => organizerToken,
        getDeviceToken: () => deviceToken,
        onUnauthorized: clearSession,
      }),
    [apiBaseUrl, organizerToken, deviceToken, clearSession],
  );
}
