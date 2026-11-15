import { useEffect, useState } from 'react';

import {
  applyWaitingWorker,
  getUpdateContainer,
  watchForWaitingWorker,
  type UpdateContainerLike,
  type WorkerLike,
} from './serviceWorkerUpdate';

/**
 * Picks up a new build on the hub tablet, but only while the hub is idle (#108).
 *
 * The hub calls this with its own idle signal (no active participant, no unsynced writes). It
 * watches the service worker registration for a new build that has finished installing, and
 * when there is one and the hub is idle it hands over to it, which reloads the page once onto the
 * new build. An update found while the hub is busy waits, and applies as soon as it is idle again.
 *
 * Off web (and in Jest) there is no service worker container, and the whole hook is a no-op.
 * `options` lets a test inject the container and the reload.
 */
export function useServiceWorkerUpdate(
  idle: boolean,
  options: { container?: UpdateContainerLike; reload?: () => void } = {},
): void {
  const [container] = useState(() => options.container ?? getUpdateContainer());
  const [waiting, setWaiting] = useState<WorkerLike | null>(null);
  const { reload } = options;

  useEffect(() => (container ? watchForWaitingWorker(container, setWaiting) : undefined), [container]);

  useEffect(() => {
    if (idle && waiting !== null && container) {
      applyWaitingWorker(waiting, container, reload);
    }
  }, [idle, waiting, container, reload]);
}
