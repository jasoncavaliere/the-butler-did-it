import { useCallback, useEffect, useState } from 'react';

import { currentWeekIso, msUntilNextWeekIso } from './weekIso';

/**
 * The ISO week the hub is in, as React state that changes at the boundary (#89).
 *
 * A board's rows carry the week they were loaded with, and the API resolves a
 * completion by `(householdId, weekIso, choreId)` with no current-week check, so
 * a board that outlives its week must stop being a control. The tap itself
 * re-reads the clock ({@link isCurrentWeek}), which is what actually guards the
 * write; but whether a row *reads* as a control is decided at render time, and
 * render time is only as fresh as the last state change. The wall tablet is
 * never reloaded and may sit untouched across Sunday midnight, so without this
 * hook a live board would keep drawing last week's rows as tappable until
 * something unrelated happened to re-render it.
 *
 * So this holds the current week in state and arms one timer for the next
 * Monday 00:00 UTC ({@link msUntilNextWeekIso}). When it fires the week is
 * re-read, the board re-renders, and a surface that lists `currentWeek` in its
 * load effect's dependencies reloads the new week - the same trigger-only
 * contract as {@link useReconnectSignal}.
 *
 * The timer is re-armed off a tick counter rather than off `currentWeek`: a
 * timer that fires a moment early re-reads the *same* week, React skips that
 * state update, and an effect keyed on the week alone would never arm another.
 * A sleeping tablet can also fire the timer late, which is what `recheck` is
 * for - a surface that finds the week has turned (a refused tap) calls it so the
 * render catches up at once rather than waiting for the timer.
 */
export function useCurrentWeekIso(): { currentWeek: string; recheck: () => void } {
  const [currentWeek, setCurrentWeek] = useState(() => currentWeekIso());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentWeek(currentWeekIso());
      setTick((previous) => previous + 1);
    }, msUntilNextWeekIso(new Date()));
    return () => clearTimeout(timer);
  }, [tick]);

  const recheck = useCallback(() => setCurrentWeek(currentWeekIso()), []);

  return { currentWeek, recheck };
}
