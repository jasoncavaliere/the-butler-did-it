/**
 * Test doubles for the service worker update flow (#108), shared by the module,
 * hook and HubShell suites. Jest has no `navigator.serviceWorker`, so these
 * stand in for the container, its registration and the workers it reports, and
 * let a test drive the browser's events by hand: `updatefound`, a worker's
 * `statechange`, and the container's `controllerchange`.
 *
 * Test-only: nothing in the app imports it, so it never reaches the bundle.
 */

type Listener = () => void;

/** The `addEventListener` half of an EventTarget, plus a way to fire an event. */
class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Fire `type` at every listener currently attached. */
  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }

  /** How many listeners are attached for `type`. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export class FakeWorker extends FakeTarget {
  readonly postMessage = jest.fn();

  constructor(public state: string = 'installing') {
    super();
  }

  /** Move the worker to `state` and fire its `statechange`. */
  moveTo(state: string): void {
    this.state = state;
    this.dispatch('statechange');
  }
}

export class FakeRegistration extends FakeTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = jest.fn(async (): Promise<unknown> => undefined);

  /** A new worker starts installing: set `installing` and fire `updatefound`. */
  findUpdate(worker: FakeWorker | null = new FakeWorker()): FakeWorker | null {
    this.installing = worker;
    this.dispatch('updatefound');
    return worker;
  }
}

export class FakeContainer extends FakeTarget {
  ready: Promise<FakeRegistration>;

  constructor(
    public readonly registration: FakeRegistration = new FakeRegistration(),
    /** The worker controlling the page; `null` is a first install. */
    public controller: object | null = { scriptURL: '/sw.js' },
  ) {
    super();
    this.ready = Promise.resolve(registration);
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

/** Install `value` as `globalThis.navigator` (undo with {@link restoreNavigator}). */
export function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

/** Put back whatever `navigator` Jest started with. */
export function restoreNavigator(): void {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

/** A Map-backed Web Storage stand-in with `removeItem`. */
export function memoryStorage(): {
  getItem: jest.Mock<string | null, [string]>;
  setItem: jest.Mock<void, [string, string]>;
  removeItem: jest.Mock<void, [string]>;
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: jest.fn((key: string) => entries.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      entries.delete(key);
    }),
  };
}

/** Let pending promise callbacks (the container's `ready`) run. */
export async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
