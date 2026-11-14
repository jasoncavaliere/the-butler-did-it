/**
 * The hub's persisted pairing (#188).
 *
 * A paired tablet keeps two facts across a page reload: which household it shows
 * and the long-lived device token (T5) that household minted for it. Both live in
 * one Web Storage record so they can never drift apart - a household id with no
 * device token would leave a reloaded hub with no credential to read its own
 * household, and nothing to reject, so the pair is written and cleared together.
 *
 * The organizer session is never part of this record. A reload always signs the
 * organizer out; only the device's pairing survives.
 *
 * Like the read cache ({@link ../offline/glanceCache}) every function here
 * degrades instead of throwing: no storage, a blocked store, a quota error or a
 * hand-edited record all read as "not paired" and the hub falls back to its
 * in-memory pairing for the session.
 */

import { defaultLocalStorage, isRecord, type LocalStorageLike } from '../offline/storage';

/** The Web Storage key holding the pairing record. Versioned so a later shape can move on. */
export const HUB_PAIRING_KEY = 'butler.hubPairing.v1';

/** The persisted pairing: the household this tablet shows and its device token. */
export type StoredHubPairing = {
  householdId: string;
  deviceToken: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Read the stored pairing, or `null` when there is nothing usable: no storage, no
 * record, an unreadable or unparseable one, or one missing either field. The
 * result is rebuilt from the two fields, so nothing else stored alongside them is
 * ever returned.
 */
export function readHubPairing(
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): StoredHubPairing | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(HUB_PAIRING_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !isNonEmptyString(parsed.householdId) ||
      !isNonEmptyString(parsed.deviceToken)
    ) {
      return null;
    }
    return { householdId: parsed.householdId, deviceToken: parsed.deviceToken };
  } catch {
    return null;
  }
}

/**
 * Store the pairing. Only the two named fields are written, whatever object is
 * passed in. A storage failure is swallowed: the pairing still holds in memory
 * for this session, it just will not survive a reload.
 */
export function writeHubPairing(
  pairing: StoredHubPairing,
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): void {
  if (!storage) {
    return;
  }
  const record: StoredHubPairing = {
    householdId: pairing.householdId,
    deviceToken: pairing.deviceToken,
  };
  try {
    storage.setItem(HUB_PAIRING_KEY, JSON.stringify(record));
  } catch {
    // Quota, private mode, a disabled store: the in-memory pairing still works.
  }
}

/**
 * Forget the stored pairing. Deletes the record where the store can, and
 * otherwise overwrites it with `null`, which {@link readHubPairing} reads as
 * unpaired. Never throws.
 */
export function clearHubPairing(
  storage: LocalStorageLike | undefined = defaultLocalStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(HUB_PAIRING_KEY);
    } else {
      storage.setItem(HUB_PAIRING_KEY, 'null');
    }
  } catch {
    // Nothing more can be done; the next successful write replaces it anyway.
  }
}
