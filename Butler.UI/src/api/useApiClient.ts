/**
 * Hook that hands screens a shared {@link ApiClient} built from the app config.
 *
 * The client is memoized on the configured base URL so a component tree shares
 * one instance rather than constructing a client per render. Screens call this
 * instead of `createApiClient` directly, keeping the base URL a single seam.
 */

import { useMemo } from 'react';

import { useAppConfig } from '../state/AppConfigContext';
import { useOrganizer } from '../state/OrganizerContext';
import { createApiClient, type ApiClient } from './client';

/**
 * Return the shared API client for the current {@link useAppConfig} base URL,
 * threading the signed-in organizer's bearer token (T4) from
 * {@link useOrganizer}. The client is rebuilt when the base URL or the token
 * changes, so a sign-in/sign-out flips the bearer on subsequent requests.
 */
export function useApiClient(): ApiClient {
  const { apiBaseUrl } = useAppConfig();
  const { token } = useOrganizer();
  return useMemo(
    () => createApiClient({ baseUrl: apiBaseUrl, getAuthToken: () => token }),
    [apiBaseUrl, token],
  );
}
