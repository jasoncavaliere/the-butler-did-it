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
 * threading whichever bearer the shared device holds.
 *
 * Precedence is organizer over paired hub device: a signed-in organizer (T4)
 * always wins because it is the stronger actor, and its token satisfies every
 * policy. With no organizer signed in - the always-on tablet's normal state -
 * the client falls back to the paired hub-device token (T5) from
 * {@link useHubDevice}, so household reads and the hub's own writes (generate a
 * week C3, tap-to-complete C4) authenticate as "The Hub" rather than going out
 * anonymous and getting a 401/403. When neither is present (an unpaired tablet
 * with no organizer) no bearer is sent and those endpoints stay unauthorized -
 * completion actors still travel in the request body, never as this bearer.
 *
 * The client is rebuilt when the base URL or either token changes, so a
 * sign-in/sign-out or a pair/unpair flips the bearer on subsequent requests.
 */
export function useApiClient(): ApiClient {
  const { apiBaseUrl } = useAppConfig();
  const { token: organizerToken } = useOrganizer();
  const { deviceToken } = useHubDevice();
  const authToken = organizerToken ?? deviceToken;
  return useMemo(
    () => createApiClient({ baseUrl: apiBaseUrl, getAuthToken: () => authToken }),
    [apiBaseUrl, authToken],
  );
}
