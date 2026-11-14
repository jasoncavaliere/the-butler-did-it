import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Holds the paired hub device token (T5) for the shared tablet. Pairing is an
 * organizer-gated action that mints a long-lived, household-scoped token; once
 * paired, the hub keeps that token here so later reads and completion writes can
 * present it. It is deliberately separate from the organizer session and the
 * active participant: the device is its own long-lived actor (the "The Hub"
 * persona), weaker than an organizer JWT and stronger than an anonymous caller.
 *
 * The token itself lives in React state here. `HubPairingProvider`
 * seeds it from, and persists it to, Web Storage alongside the household id, so
 * a paired hub stays paired across a page reload (#188). The organizer session is
 * never persisted.
 */
export type HubDeviceContextValue = {
  /** The paired device token, or `null` before this tablet has been paired. */
  deviceToken: string | null;
  /** Store the token returned by a successful pair (or clear it with `null`). */
  setDeviceToken: (token: string | null) => void;
  /** Convenience flag: whether this tablet is paired as a hub device. */
  isPaired: boolean;
  /**
   * Drop the device token because the API refused it (revoked, unknown, or for a
   * household it no longer belongs to), and tell the provider's owner via
   * `onDeviceRejected` so the pairing as a whole is forgotten (#188).
   * Referentially stable: the API client's memo depends on it.
   */
  rejectDevice: () => void;
};

const defaultValue: HubDeviceContextValue = {
  deviceToken: null,
  setDeviceToken: () => undefined,
  isPaired: false,
  rejectDevice: () => undefined,
};

const HubDeviceContext = createContext<HubDeviceContextValue>(defaultValue);

/**
 * Provides the paired {@link HubDeviceContextValue} to descendants.
 * `initialDeviceToken` seeds the starting token (defaults to unpaired) so tests
 * and the stored pairing (#188) can preset one. `onDeviceRejected` is called by
 * {@link HubDeviceContextValue.rejectDevice} after the token is cleared; pass a
 * stable callback, since it is part of `rejectDevice`'s identity.
 */
export function HubDeviceProvider({
  children,
  initialDeviceToken = null,
  onDeviceRejected,
}: {
  children: ReactNode;
  initialDeviceToken?: string | null;
  onDeviceRejected?: () => void;
}) {
  const [deviceToken, setDeviceToken] = useState<string | null>(initialDeviceToken);
  const rejectDevice = useCallback(() => {
    setDeviceToken(null);
    onDeviceRejected?.();
  }, [onDeviceRejected]);
  const value = useMemo<HubDeviceContextValue>(
    () => ({ deviceToken, setDeviceToken, isPaired: deviceToken !== null, rejectDevice }),
    [deviceToken, rejectDevice],
  );

  return <HubDeviceContext.Provider value={value}>{children}</HubDeviceContext.Provider>;
}

/** Read the current paired device token from context. */
export function useHubDevice(): HubDeviceContextValue {
  return useContext(HubDeviceContext);
}
