import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Holds the currently-selected household for the shared tablet. The household is
 * the product's shared spine, so screens read `householdId` from here rather
 * than threading it through props. Later tickets (tap-to-claim, session) build
 * richer participant state on top of this seam.
 */
export type HouseholdContextValue = {
  /** The active household, or `null` before one has been selected/claimed. */
  householdId: string | null;
  /** Replace the active household (or clear it with `null`). */
  setHouseholdId: (householdId: string | null) => void;
};

const HouseholdContext = createContext<HouseholdContextValue | undefined>(undefined);

/**
 * Provides {@link HouseholdContextValue} to descendants. `initialHouseholdId`
 * seeds the starting household (defaults to none) so tests and future
 * bootstrapping can preselect one.
 */
export function HouseholdProvider({
  children,
  initialHouseholdId = null,
}: {
  children: ReactNode;
  initialHouseholdId?: string | null;
}) {
  const [householdId, setHouseholdId] = useState<string | null>(initialHouseholdId);
  const value = useMemo<HouseholdContextValue>(
    () => ({ householdId, setHouseholdId }),
    [householdId],
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

/**
 * Read the current household from context. Throws when called outside a
 * {@link HouseholdProvider} so a missing provider fails loudly instead of
 * silently returning a stale default.
 */
export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext);
  if (!value) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return value;
}
