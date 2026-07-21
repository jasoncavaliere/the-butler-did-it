import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Holds the paired hub device token (T5) for the shared tablet. Pairing is an
 * organizer-gated action that mints a long-lived, household-scoped token; once
 * paired, the hub keeps that token here so later reads and completion writes can
 * present it. It is deliberately separate from the organizer session and the
 * active participant: the device is its own long-lived actor (the "The Hub"
 * persona), weaker than an organizer JWT and stronger than an anonymous caller.
 *
 * The token lives in memory for the process lifetime, mirroring the other hub
 * session state (organizer, active participant). Durable persistence across app
 * restarts is a later concern and layers on top of this seam.
 */
export type HubDeviceContextValue = {
  /** The paired device token, or `null` before this tablet has been paired. */
  deviceToken: string | null;
  /** Store the token returned by a successful pair (or clear it with `null`). */
  setDeviceToken: (token: string | null) => void;
  /** Convenience flag: whether this tablet is paired as a hub device. */
  isPaired: boolean;
};

const defaultValue: HubDeviceContextValue = {
  deviceToken: null,
  setDeviceToken: () => undefined,
  isPaired: false,
};

const HubDeviceContext = createContext<HubDeviceContextValue>(defaultValue);

/**
 * Provides the paired {@link HubDeviceContextValue} to descendants.
 * `initialDeviceToken` seeds the starting token (defaults to unpaired) so tests
 * and future bootstrapping can preset one.
 */
export function HubDeviceProvider({
  children,
  initialDeviceToken = null,
}: {
  children: ReactNode;
  initialDeviceToken?: string | null;
}) {
  const [deviceToken, setDeviceToken] = useState<string | null>(initialDeviceToken);
  const value = useMemo<HubDeviceContextValue>(
    () => ({ deviceToken, setDeviceToken, isPaired: deviceToken !== null }),
    [deviceToken],
  );

  return <HubDeviceContext.Provider value={value}>{children}</HubDeviceContext.Provider>;
}

/** Read the current paired device token from context. */
export function useHubDevice(): HubDeviceContextValue {
  return useContext(HubDeviceContext);
}
