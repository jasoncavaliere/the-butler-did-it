import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { IAuthProvider, OrganizerIdentity, OrganizerSession } from '../auth/authProvider';
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
  /** Start (or complete) organizer sign-in through the configured provider. */
  signIn: () => Promise<void>;
  /** Clear the organizer session, returning to the participant-only state. */
  signOut: () => Promise<void>;
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
};

const OrganizerContext = createContext<OrganizerContextValue>(defaultValue);

/**
 * Provides the organizer session. The concrete auth provider is selected from
 * {@link useAppConfig} (dev organizer vs Entra OIDC/PKCE); tests inject a fake
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
  const { auth } = useAppConfig();
  const provider = useMemo(
    () => authProvider ?? createAuthProvider(auth),
    [authProvider, auth],
  );
  const [session, setSession] = useState<OrganizerSession | null>(null);

  const signIn = useCallback(async () => {
    const result = await provider.signIn();
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

  const value = useMemo<OrganizerContextValue>(
    () => ({
      organizer: session?.organizer ?? null,
      token: session?.token ?? null,
      isSignedIn: session !== null,
      signIn,
      signOut,
    }),
    [session, signIn, signOut],
  );

  return <OrganizerContext.Provider value={value}>{children}</OrganizerContext.Provider>;
}

/** Read the current organizer session from context. */
export function useOrganizer(): OrganizerContextValue {
  return useContext(OrganizerContext);
}
