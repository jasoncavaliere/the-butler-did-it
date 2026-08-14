/**
 * The hub's one Web Storage seam (Epic 60).
 *
 * Both offline modules persist to the same place - the read cache
 * ({@link ../offline/glanceCache}, O2) and the durable write queue
 * ({@link ../offline/writeQueue}, O3) - and both need the same two properties
 * from it, so the detection lives here once rather than in each:
 *
 * - it is **feature-detected, not platform-switched**, the same way
 *   `registerServiceWorker` feature-detects `navigator.serviceWorker`. Off web
 *   (and in Jest without a stub) there simply is no storage, so a caller no-ops
 *   without a `Platform.OS` branch.
 * - **looking** for it is guarded. In a browser with storage blocked - privacy
 *   mode, a locked-down kiosk profile - the property *access* itself throws
 *   `SecurityError`, so even probing has to be wrapped or the failure escapes
 *   into a caller's promise chain instead of degrading to "no storage".
 *
 * What the two modules do with "no storage" is where they part company, which is
 * why {@link sessionFallbackStorage} lives here too: a cache that cannot persist
 * is a cache miss, but a *write queue* that cannot persist would be discarding
 * taps, so the queue degrades to session memory rather than to nothing.
 */

/** The subset of the Web Storage API the offline modules use (no DOM lib dependency). */
export type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /**
   * Whether `key`'s last write survives a reload. Optional, and absent means
   * "yes" - a plain Web Storage object either stored the value or threw. Only
   * {@link sessionFallbackStorage} implements it, because it is the only store
   * that can accept a write it cannot make durable.
   */
  isDurable?(key: string): boolean;
};

/** The ambient browser storage, or `undefined` where there is none or it is blocked. */
export function defaultLocalStorage(): LocalStorageLike | undefined {
  try {
    const storage = (globalThis as { localStorage?: LocalStorageLike }).localStorage;
    return typeof storage?.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The session-memory half of {@link sessionFallbackStorage}: the values it holds,
 * and the keys for which it - rather than Web Storage - holds the latest one.
 */
const sessionValues = new Map<string, string>();
const sessionOnlyKeys = new Set<string>();

/**
 * Web Storage when there is usable Web Storage, and a session-memory stand-in
 * when there is not.
 *
 * The read cache (O2) can afford to lose a write to storage - a missing cache is
 * just a cache miss. The write queue (O3) cannot: a queued write that never lands
 * anywhere is a *user's tap* discarded, which is the one outcome the queue exists
 * to prevent, and it would happen on exactly the devices that need the queue most
 * (a React Native hub, or a kiosk/privacy profile with storage denied). So the
 * queue writes through this seam instead, which degrades one step at a time:
 *
 * - **Durable** when Web Storage takes the write - the value survives a reload,
 *   and reads come straight back off it.
 * - **Session-only** when there is no Web Storage, when probing it throws, or when
 *   it refuses the write (quota, private mode). The value is still held in memory,
 *   so the queue is still complete, still ordered, and still replays for the rest
 *   of this session; it simply does not survive a relaunch. {@link isDurable}
 *   reports which of the two happened, per key, so a caller that cares can tell.
 *
 * The two are tracked per key rather than globally because they can disagree: a
 * write refused for quota leaves a *stale* value in Web Storage, so that key must
 * read from memory afterwards even though the store is otherwise working. A later
 * write that Web Storage does accept makes it authoritative again.
 *
 * Deliberately a process-wide singleton: "this session" is the whole point, so the
 * value has to outlive the component that wrote it.
 */
export function sessionFallbackStorage(): LocalStorageLike {
  return fallbackStorage;
}

const fallbackStorage: LocalStorageLike = {
  getItem(key) {
    if (!sessionOnlyKeys.has(key)) {
      const ambient = defaultLocalStorage();
      if (ambient) {
        try {
          return ambient.getItem(key);
        } catch {
          // Reading is blocked too, so the session copy is all there is.
        }
      }
    }
    return sessionValues.get(key) ?? null;
  },
  setItem(key, value) {
    // Memory first, and unconditionally: whatever Web Storage does next, the
    // value is readable for the rest of this session.
    sessionValues.set(key, value);
    const ambient = defaultLocalStorage();
    if (ambient) {
      try {
        ambient.setItem(key, value);
        sessionOnlyKeys.delete(key);
        return;
      } catch {
        // Quota, private mode, a store that is present but disabled.
      }
    }
    sessionOnlyKeys.add(key);
  },
  isDurable(key) {
    return !sessionOnlyKeys.has(key);
  },
};

/**
 * Forget everything the session-memory fallback is holding.
 *
 * A test seam, and only that: the fallback is a process-wide singleton on
 * purpose, so without this one test's degraded run would leak into the next.
 */
export function resetSessionFallbackStorage(): void {
  sessionValues.clear();
  sessionOnlyKeys.clear();
}

/** A plain (non-null, non-array) object - the shape every persisted record must be. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
