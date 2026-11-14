/**
 * The React seam over the dataset guard (#100 D7).
 *
 * {@link checkDataset} is a plain function; this hook decides when it runs and
 * tells the hub what to do with the answer:
 *
 * - **On startup** - when a household is selected (the hub does not persist its
 *   household, so "startup" is the shell mounting with one) and whenever it
 *   changes. `checking` is `true` until that first check settles, so the hub can
 *   hold its board, its cache, and its queue's mount drain until the guard has
 *   had its say.
 * - **On every reconnect** - the browser's `online` event, whether the hub is
 *   live or degraded, because a reseed can happen during any outage.
 * - **On demand** - `verify` runs a check and reports it; the write queue's drain
 *   gate calls it before replaying anything, which covers an API-only outage
 *   (a demo reset) that never fires `online`.
 *
 * Whichever path sees `changed`, `revision` increments. The hub keys its body on
 * it, so a change remounts everything below: every household read reloads from
 * the API, and the write queue re-hydrates from the storage the guard just
 * emptied.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '../api/client';
import { checkDataset, type DatasetCheck } from './datasetGuard';
import { useReconnectSignal } from './useReconnect';

/** What the hub gets from the guard. */
export type DatasetGuardState = {
  /** Whether the startup check for the current household has not settled yet. */
  checking: boolean;
  /** Increments once per `changed` check; key the household's UI on it. */
  revision: number;
  /** Run a check now and report it; `unverified` when no household is selected. */
  verify: () => Promise<DatasetCheck>;
};

export function useDatasetGuard(householdId: string | null, client: ApiClient): DatasetGuardState {
  const [revision, setRevision] = useState(0);
  // The household whose startup check has settled. `checking` is derived from it
  // rather than set in the effect, so the effect never sets state synchronously.
  const [settledFor, setSettledFor] = useState<string | null>(null);

  // Held in a ref so `verify` stays stable across client identity changes; it is
  // a dependency of the queue's drain, which must not restart on every render.
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reconnectSignal = useReconnectSignal(householdId !== null);

  const verify = useCallback(async (): Promise<DatasetCheck> => {
    if (householdId === null) {
      return 'unverified';
    }
    const result = await checkDataset(householdId, clientRef.current);
    if (result === 'changed' && mounted.current) {
      setRevision((previous) => previous + 1);
    }
    return result;
  }, [householdId]);

  useEffect(() => {
    if (householdId === null) {
      return undefined;
    }
    let active = true;
    void verify().then(() => {
      if (active) {
        setSettledFor(householdId);
      }
    });
    return () => {
      active = false;
    };
  }, [householdId, verify, reconnectSignal]);

  return { checking: householdId !== null && settledFor !== householdId, revision, verify };
}
