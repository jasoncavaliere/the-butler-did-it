/**
 * Hook that hands screens a shared {@link ApiClient} built from the app config.
 *
 * The client is memoized on the configured base URL so a component tree shares
 * one instance rather than constructing a client per render. Screens call this
 * instead of `createApiClient` directly, keeping the base URL a single seam.
 */

import { useMemo } from 'react';

import { useAppConfig } from '../state/AppConfigContext';
import { createApiClient, type ApiClient } from './client';

/** Return the shared API client for the current {@link useAppConfig} base URL. */
export function useApiClient(): ApiClient {
  const { apiBaseUrl } = useAppConfig();
  return useMemo(() => createApiClient({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
}
