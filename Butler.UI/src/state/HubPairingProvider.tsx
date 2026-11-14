import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { HouseholdProvider, useHousehold } from './HouseholdContext';
import { HubDeviceProvider, useHubDevice } from './HubDeviceContext';
import { clearHubPairing, readHubPairing, writeHubPairing } from './hubPairingStorage';

/**
 * Keeps the hub paired across a page reload (#188).
 *
 * Wraps {@link HouseholdProvider} and {@link HubDeviceProvider} and seeds both
 * from the stored pairing, read once on mount. From then on one effect mirrors
 * the pair back to storage: when the tablet has both a household and a device
 * token the record is written, and when either is gone it is cleared. That single
 * rule covers pairing, deleting the household, and the API refusing the device
 * token, so none of those call sites need to know about storage.
 *
 * Only the household id and the device token are stored. The organizer session
 * is not: a reload always signs the organizer out, and the hub comes back in its
 * participant-only mode on the device token.
 *
 * When storage is missing or throws, the read yields nothing and the writes are
 * no-ops, so the hub pairs in memory for the session exactly as it did before.
 */
export function HubPairingProvider({ children }: { children: ReactNode }) {
  const [restored] = useState(() => readHubPairing());

  return (
    <HouseholdProvider initialHouseholdId={restored?.householdId ?? null}>
      <PairedDevice initialDeviceToken={restored?.deviceToken ?? null}>{children}</PairedDevice>
    </HouseholdProvider>
  );
}

/**
 * The device half: a rejected device token also forgets the household, which
 * returns the navigator to the unpaired setup route.
 */
function PairedDevice({
  children,
  initialDeviceToken,
}: {
  children: ReactNode;
  initialDeviceToken: string | null;
}) {
  const { setHouseholdId } = useHousehold();
  const forget = useCallback(() => setHouseholdId(null), [setHouseholdId]);

  return (
    <HubDeviceProvider initialDeviceToken={initialDeviceToken} onDeviceRejected={forget}>
      <HubPairingSync />
      {children}
    </HubDeviceProvider>
  );
}

/** Mirrors the in-memory pairing to storage; renders nothing. */
function HubPairingSync() {
  const { householdId } = useHousehold();
  const { deviceToken } = useHubDevice();

  useEffect(() => {
    if (householdId !== null && deviceToken !== null) {
      writeHubPairing({ householdId, deviceToken });
    } else {
      clearHubPairing();
    }
  }, [householdId, deviceToken]);

  return null;
}
