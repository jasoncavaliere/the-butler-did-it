import { createContext, useContext, type ReactNode } from 'react';

import { apiBaseUrl, authConfig, type AuthConfig } from '../api/config';

/**
 * App-wide configuration surfaced to the component tree. Intentionally small:
 * this is the config seam only. The richer household/session provider is F7.
 */
export type AppConfig = {
  apiBaseUrl: string;
  /** Organizer authentication config (dev bypass vs OIDC/PKCE provider). */
  auth: AuthConfig;
};

/** Default config derived from the build-time API base URL and auth env. */
export const defaultAppConfig: AppConfig = {
  apiBaseUrl,
  auth: authConfig,
};

const AppConfigContext = createContext<AppConfig>(defaultAppConfig);

/** Provides {@link AppConfig} to descendants; falls back to the default. */
export function AppConfigProvider({
  children,
  value = defaultAppConfig,
}: {
  children: ReactNode;
  value?: AppConfig;
}) {
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

/** Read the current {@link AppConfig} from context. */
export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
