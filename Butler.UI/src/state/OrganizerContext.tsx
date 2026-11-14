import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type {
  IAuthProvider,
  OrganizerIdentity,
  OrganizerSession,
  SignInCredentials,
} from '../auth/authProvider';
import { createAuthProvider } from '../auth/createAuthProvider';
import { useAppConfig } from './AppConfigContext';

/**
 * The signed-in organizer, exposed to the whole tree (Engineering Contract 7.4,
 * client side). This is the single source of truth for "is an organizer signed
 * in": the F7 API client reads {@link token} to attach the bearer, and sensitive
 * UI affordances read {@link organizer} to decide whether to render. It is fully
 * independent of the participant tap-to-claim state - organizer auth and the
 * active participant are separate concepts on the shared device.
 */
export type OrganizerContextValue = {
  /** The signed-in organizer, or `null` in the participant-only state. */
  organizer: OrganizerIdentity | null;
  /** Bearer token for organizer-policy API calls, or `null` when signed out. */
  token: string | null;
  /** Convenience flag: whether an organizer session is active. */
  isSignedIn: boolean;
  /**
   * Start (or complete) organizer sign-in through the configured provider. The
   * PIN provider needs `credentials.pin` and rejects when the PIN is refused;
   * the rejection propagates so the PIN pad can show why.
   */
  signIn: (credentials?: SignInCredentials) => Promise<void>;
  /** Clear the organizer session, returning to the participant-only state. */
  signOut: () => Promise<void>;
  /**
   * Drop the local organizer session without calling the provider - used when
   * the API rejects the organizer token (expired). Referentially stable.
   */
  clearSession: () => void;
  /** The configured provider's kind (`dev`, `entra`, `pin`), so the UI can pick its sign-in affordance. */
  providerKind: string;
};

/**
 * Default value for consumers outside a provider: the participant-only state
 * with no-op sign-in/out. Mirrors {@link useAppConfig}'s forgiving default so a
 * component that only reads the organizer (e.g. the hub) renders safely without
 * an explicit provider in a test.
 */
const defaultValue: OrganizerContextValue = {
  organizer: null,
  token: null,
  isSignedIn: false,
  signIn: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
  clearSession: () => undefined,
  providerKind: 'dev',
};

const OrganizerContext = createContext<OrganizerContextValue>(defaultValue);

/**
 * Provides the organizer session. The concrete auth provider is selected from
 * {@link useAppConfig} (dev organizer, Entra OIDC/PKCE, or the demo PIN); tests inject a fake
 * provider through the same {@link IAuthProvider} seam, proving it is real.
 */
export function OrganizerProvider({
  children,
  authProvider,
}: {
  children: ReactNode;
  /** Override the config-selected provider (tests inject a fake here). */
  authProvider?: IAuthProvider;
}) {
  const { auth, apiBaseUrl } = useAppConfig();
  const provider = useMemo(
    () => authProvider ?? createAuthProvider(auth, undefined, { apiBaseUrl }),
    [authProvider, auth, apiBaseUrl],
  );
  const [session, setSession] = useState<OrganizerSession | null>(null);

  const signIn = useCallback(async (credentials?: SignInCredentials) => {
    const result = await provider.signIn(credentials);
    // A `null` result means a browser redirect is in flight; the session lands
    // on the return trip. Only a resolved session updates state.
    if (result) {
      setSession(result);
    }
  }, [provider]);

  const signOut = useCallback(async () => {
    await provider.signOut();
    setSession(null);
  }, [provider]);

  // Local only: the API already rejected the token, so there is nothing to revoke.
  const clearSession = useCallback(() => {
    setSession(null);
  }, []);

  const value = useMemo<OrganizerContextValue>(
    () => ({
      organizer: session?.organizer ?? null,
      token: session?.token ?? null,
      isSignedIn: session !== null,
      signIn,
      signOut,
      clearSession,
      providerKind: provider.kind,
    }),
    [session, signIn, signOut, clearSession, provider],
  );

  return <OrganizerContext.Provider value={value}>{children}</OrganizerContext.Provider>;
}

/** Read the current organizer session from context. */
export function useOrganizer(): OrganizerContextValue {
  return useContext(OrganizerContext);
}
