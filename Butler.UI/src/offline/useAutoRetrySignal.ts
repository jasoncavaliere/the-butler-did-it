import { useEffect, useRef, useState } from 'react';

import { autoRetryDelayMs } from './autoRetry';

/**
 * The automatic retry signal behind the hub's reads (#109).
 *
 * While `failing`, the counter bumps on the {@link autoRetryDelayMs} schedule -
 * 2s, 4s, 8s ... capped at a minute - and a load effect that lists it in its
 * dependencies re-reads. Once a read succeeds the caller stops failing, the
 * timer is cleared, and the schedule starts over from the first step next time.
 *
 * The counter only ever increases: a decrease would be a dependency change too,
 * and would fire one more read on recovery. The caller must not show its
 * loading state on this path - the last-known state stays on screen while the
 * hub retries behind it, and a loading phase would also flip `failing` off and
 * restart the schedule on every step.
 */
export function useAutoRetrySignal(
  failing: boolean,
  delayFor: (attempt: number) => number = autoRetryDelayMs,
): number {
  const [signal, setSignal] = useState(0);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!failing) {
      attemptRef.current = 0;
      return undefined;
    }
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      setSignal((previous) => previous + 1);
    }, delayFor(attemptRef.current));
    return () => clearTimeout(timer);
  }, [failing, signal, delayFor]);

  return signal;
}
