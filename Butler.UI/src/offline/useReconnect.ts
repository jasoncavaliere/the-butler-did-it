import { useEffect, useState } from 'react';

/**
 * The reconnect signal behind the last-known cache (Epic 60 O2).
 *
 * A hub that fell back to the cached glance has to come back to life on its own.
 * The tablet lives on the wall: nobody reloads it, so without this the last-known
 * board would stay last-known until someone happened to refresh - which is not
 * only stale, it is dangerous, because a cached board carries the *cached* week
 * and the API resolves a completion by `(householdId, weekIso, choreId)`.
 *
 * So this hook turns the browser's `online` event into a dependency: while
 * `enabled` (i.e. while a surface is actually degraded) each reconnect bumps a
 * counter, and a load effect that lists the counter in its dependencies refetches.
 * Once the refetch succeeds the caller disables it again, so a healthy hub is not
 * listening for anything.
 *
 * It is feature-detected rather than platform-switched, the same way
 * `registerServiceWorker` feature-detects `navigator.serviceWorker`: off web (and
 * in Jest without a stub) there is no `addEventListener`, so the hook is inert
 * with no `Platform.OS` branch.
 */

/** The sliver of the DOM event-target API this hook needs (no DOM lib dependency). */
type ReconnectTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** The ambient event target, or `undefined` where there is none (native, Jest). */
export function defaultReconnectTarget(): ReconnectTarget | undefined {
  try {
    const target = globalThis as Partial<ReconnectTarget>;
    return typeof target.addEventListener === 'function' &&
      typeof target.removeEventListener === 'function'
      ? (target as ReconnectTarget)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A counter that increments on every reconnect while `enabled`. Starts at 0, and
 * is stable while disabled - so listing it in a load effect's dependencies
 * refetches on reconnect and never otherwise.
 */
export function useReconnectSignal(
  enabled: boolean,
  target: ReconnectTarget | undefined = defaultReconnectTarget(),
): number {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    if (!enabled || !target) {
      return undefined;
    }
    const onOnline = () => setSignal((previous) => previous + 1);
    target.addEventListener('online', onOnline);
    return () => target.removeEventListener('online', onOnline);
  }, [enabled, target]);

  return signal;
}
