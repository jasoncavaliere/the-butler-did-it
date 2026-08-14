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
 */

/** The subset of the Web Storage API the offline modules use (no DOM lib dependency). */
export type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

/** A plain (non-null, non-array) object - the shape every persisted record must be. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
