/**
 * Picking up a new build on the hub tablet (#108).
 *
 * The family tablet runs one long-lived tab, so a deployed build would otherwise never reach it:
 * `public/sw.js` installs a new worker and then waits, and nothing ever closes the tab to let it
 * take over. This module is the page's half of the handover:
 *
 * - {@link watchForWaitingWorker} notices a new build that has finished installing (one already
 *   waiting when the hub mounts, or one that installs while it runs) and asks the browser to look
 *   for a new build every {@link UPDATE_CHECK_INTERVAL_MS}.
 * - {@link applyWaitingWorker} tells that worker to take over, which the hub does only while it is
 *   idle, and reloads the page exactly once when the new worker takes control. It leaves a one-shot
 *   marker in session storage, so the reloaded hub can say which build it is now running.
 *
 * A worker that finishes installing while nothing controls the page is a *first* install, not an
 * update, and is never reported. The first install's `clients.claim()` also fires
 * `controllerchange`, which is why the page reloads only after it posted the message itself.
 *
 * Like `registerServiceWorker`, everything is feature-detected rather than platform-switched: off
 * web (and in Jest) there is no container, and every call degrades to a no-op instead of throwing.
 */
import type { LocalStorageLike } from '../offline/storage';

/** What the hub posts to a waiting worker to let it take over (`public/sw.js` listens for it). */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

/** How often the hub asks the browser to check for a new build. */
export const UPDATE_CHECK_INTERVAL_MS = 60_000;

/** The session storage key that marks "this load is the reload onto a new build". */
export const UPDATE_NOTICE_KEY = 'butler.swUpdated.v1';

type Listener = () => void;

/** The slice of a `ServiceWorker` the update flow uses (no DOM lib dependency). */
export type WorkerLike = {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: Listener): void;
  removeEventListener(type: 'statechange', listener: Listener): void;
};

/** The slice of a `ServiceWorkerRegistration` the update flow uses. */
export type RegistrationLike = {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: Listener): void;
  removeEventListener(type: 'updatefound', listener: Listener): void;
};

/** The slice of `navigator.serviceWorker` the update flow uses. */
export type UpdateContainerLike = {
  /** The worker controlling this page; `null` until the first install claims it. */
  controller: unknown;
  ready: Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: Listener): void;
};

const noop = () => {};

/** The browser's service worker container, or `undefined` where there is none (native, Jest). */
export function getUpdateContainer(): UpdateContainerLike | undefined {
  try {
    const container = globalThis.navigator?.serviceWorker as Partial<UpdateContainerLike> | undefined;
    return typeof container?.addEventListener === 'function' && container.ready !== undefined
      ? (container as UpdateContainerLike)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Watch `container`'s registration for a new build that is ready to take over, and report it to
 * `onWaiting`: one already waiting when the registration is ready, or one whose install finishes
 * (`updatefound`, then the installing worker reaches `installed`) while the page is watching. Both
 * are reported only while an older worker controls the page. Also asks the browser to check for a
 * new build every `intervalMs`. Returns a dispose that removes every listener and stops the checks.
 */
export function watchForWaitingWorker(
  container: UpdateContainerLike,
  onWaiting: (worker: WorkerLike) => void,
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): () => void {
  let disposed = false;
  let registration: RegistrationLike | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stateListeners: [WorkerLike, Listener][] = [];

  const report = (worker: WorkerLike) => {
    if (container.controller) {
      onWaiting(worker);
    }
  };

  const onUpdateFound = () => {
    const installing = registration?.installing;
    if (!installing) {
      return;
    }
    const onStateChange = () => {
      if (installing.state === 'installed') {
        report(installing);
      }
    };
    installing.addEventListener('statechange', onStateChange);
    stateListeners.push([installing, onStateChange]);
  };

  container.ready.then((ready) => {
    if (disposed) {
      return;
    }
    registration = ready;
    if (ready.waiting) {
      report(ready.waiting);
    }
    ready.addEventListener('updatefound', onUpdateFound);
    timer = setInterval(() => {
      // A failed check (offline, a 404 on sw.js) just waits for the next one.
      Promise.resolve()
        .then(() => ready.update())
        .catch(noop);
    }, intervalMs);
  }, noop);

  return () => {
    disposed = true;
    clearInterval(timer);
    registration?.removeEventListener('updatefound', onUpdateFound);
    for (const [worker, listener] of stateListeners) {
      worker.removeEventListener('statechange', listener);
    }
  };
}

// Module scope, not per component: the hub body remounts when the dataset guard bumps its
// revision, and a per-instance flag would post twice or lose the reload.
let updateApplied = false;
let reloaded = false;

function defaultReload(): void {
  (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
}

/**
 * Hand over to `worker`: listen for the new worker taking control, then post it
 * {@link SKIP_WAITING_MESSAGE}. When control changes, write the update notice marker and reload,
 * once. Idempotent: only the first call posts.
 */
export function applyWaitingWorker(
  worker: WorkerLike,
  container: UpdateContainerLike,
  reload: () => void = defaultReload,
  storage: LocalStorageLike | undefined = defaultSessionStorage(),
): void {
  if (updateApplied) {
    return;
  }
  updateApplied = true;
  // Before posting, so even an instant handover is heard.
  container.addEventListener('controllerchange', () => {
    if (reloaded) {
      return;
    }
    reloaded = true;
    try {
      storage?.setItem(UPDATE_NOTICE_KEY, '1');
    } catch {
      // No notice after the reload is fine; a missed reload is not.
    }
    reload();
  });
  worker.postMessage(SKIP_WAITING_MESSAGE);
}

/** The ambient session storage, or `undefined` where there is none or it is blocked. */
export function defaultSessionStorage(): LocalStorageLike | undefined {
  try {
    const storage = (globalThis as { sessionStorage?: LocalStorageLike }).sessionStorage;
    return typeof storage?.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether this load is the reload onto a new build. A pure read; see {@link clearUpdateNotice}. */
export function readUpdateNotice(storage: LocalStorageLike | undefined = defaultSessionStorage()): boolean {
  try {
    return (storage?.getItem(UPDATE_NOTICE_KEY) ?? null) !== null;
  } catch {
    return false;
  }
}

/** Remove the one-shot marker, so a later manual reload shows no notice. */
export function clearUpdateNotice(storage: LocalStorageLike | undefined = defaultSessionStorage()): void {
  try {
    storage?.removeItem?.(UPDATE_NOTICE_KEY);
  } catch {
    // Blocked storage: nothing was persisted to clear.
  }
}

/** A test seam: forget that an update was applied or a reload ran. */
export function resetServiceWorkerUpdateForTests(): void {
  updateApplied = false;
  reloaded = false;
}
