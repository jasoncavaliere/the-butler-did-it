/**
 * The screen wake lock (#109).
 *
 * The hub lives on the kitchen wall, and a tablet that dims and sleeps is a hub
 * nobody can glance at. Browsers that support the Screen Wake Lock API let a
 * visible page ask the screen to stay on; this module is the request half, and
 * `useScreenWakeLock` decides when to ask.
 *
 * It is feature-detected rather than platform-switched, like
 * `registerServiceWorker`: on iOS/Android (and in Jest) there is no
 * `navigator.wakeLock`, so it reports `unsupported` without a `Platform.OS`
 * branch. A refused request - a hidden page, a battery saver, a browser policy -
 * is swallowed: a hub that dims is a degraded hub, never a broken one.
 */

/** The sliver of a `WakeLockSentinel` the hub needs (no DOM lib dependency). */
export type WakeLockSentinelLike = {
  readonly released?: boolean;
  release(): Promise<unknown>;
};

/** The sliver of `navigator.wakeLock` the hub needs. */
export type WakeLockLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

export type WakeLockOutcome =
  | { outcome: 'acquired'; sentinel: WakeLockSentinelLike }
  | { outcome: 'unsupported' }
  | { outcome: 'failed' };

/** The ambient `navigator.wakeLock`, or `undefined` where there is none (native, Jest). */
export function getWakeLock(): WakeLockLike | undefined {
  try {
    const nav = (globalThis as { navigator?: { wakeLock?: Partial<WakeLockLike> } }).navigator;
    const wakeLock = nav?.wakeLock;
    return typeof wakeLock?.request === 'function' ? (wakeLock as WakeLockLike) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ask for a screen wake lock. Always resolves - never rejects and never throws -
 * so a caller can fire it and forget it.
 */
export async function requestScreenWakeLock(
  wakeLock: WakeLockLike | undefined = getWakeLock(),
): Promise<WakeLockOutcome> {
  if (!wakeLock) {
    return { outcome: 'unsupported' };
  }
  try {
    const sentinel = await wakeLock.request('screen');
    return { outcome: 'acquired', sentinel };
  } catch {
    return { outcome: 'failed' };
  }
}
