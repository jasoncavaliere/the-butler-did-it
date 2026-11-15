import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  FakeContainer,
  FakeRegistration,
  FakeWorker,
  flushPromises,
  restoreNavigator,
  setNavigator,
} from './fakeServiceWorker.testing';
import {
  SKIP_WAITING_MESSAGE,
  UPDATE_CHECK_INTERVAL_MS,
  resetServiceWorkerUpdateForTests,
  type UpdateContainerLike,
} from './serviceWorkerUpdate';
import { useServiceWorkerUpdate } from './useServiceWorkerUpdate';

function Probe({
  idle,
  container,
  reload,
}: {
  idle: boolean;
  container?: UpdateContainerLike;
  reload?: () => void;
}) {
  useServiceWorkerUpdate(idle, { container, reload });
  return <Text testID="probe">hub</Text>;
}

/** A container whose registration already holds a waiting worker. */
function containerWithWaiting(): { container: FakeContainer; worker: FakeWorker } {
  const registration = new FakeRegistration();
  const worker = new FakeWorker('installed');
  registration.waiting = worker;
  return { container: new FakeContainer(registration), worker };
}

beforeEach(() => {
  resetServiceWorkerUpdateForTests();
});

afterEach(() => {
  jest.useRealTimers();
  restoreNavigator();
});

describe('useServiceWorkerUpdate', () => {
  it('posts SKIP_WAITING to the waiting worker when idle (AC2)', async () => {
    const { container, worker } = containerWithWaiting();
    const reload = jest.fn();

    await render(<Probe idle container={container} reload={reload} />);
    await act(flushPromises);

    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('posts once an update installs while the hub is idle', async () => {
    const container = new FakeContainer();
    await render(<Probe idle container={container} reload={jest.fn()} />);
    await act(flushPromises);

    const worker = container.registration.findUpdate() as FakeWorker;
    await act(async () => worker.moveTo('installed'));

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('defers while busy and applies as soon as idle (AC4)', async () => {
    const { container, worker } = containerWithWaiting();
    const reload = jest.fn();

    const view = await render(<Probe idle={false} container={container} reload={reload} />);
    await act(flushPromises);
    expect(worker.postMessage).not.toHaveBeenCalled();

    await view.rerender(<Probe idle container={container} reload={reload} />);

    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it('no update: watches but never posts and never reloads (AC5)', async () => {
    jest.useFakeTimers();
    const container = new FakeContainer();
    const reload = jest.fn();

    await render(<Probe idle container={container} reload={reload} />);
    await act(flushPromises);
    // It is watching: an updatefound listener is attached and update() is polled.
    expect(container.registration.listenerCount('updatefound')).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    });
    expect(container.registration.update).toHaveBeenCalledTimes(1);

    container.dispatch('controllerchange');
    expect(reload).not.toHaveBeenCalled();
    expect(container.listenerCount('controllerchange')).toBe(0);
  });

  it('a first install never posts and its controllerchange never reloads (AC5)', async () => {
    const registration = new FakeRegistration();
    const container = new FakeContainer(registration, null);
    const reload = jest.fn();

    await render(<Probe idle container={container} reload={reload} />);
    await act(flushPromises);
    const worker = registration.findUpdate() as FakeWorker;
    await act(async () => worker.moveTo('installed'));
    container.dispatch('controllerchange');

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops watching on unmount', async () => {
    const container = new FakeContainer();
    const view = await render(<Probe idle container={container} />);
    await act(flushPromises);
    expect(container.registration.listenerCount('updatefound')).toBe(1);

    await view.unmount();

    expect(container.registration.listenerCount('updatefound')).toBe(0);
  });

  it('reads the browser container when none is injected', async () => {
    const { container, worker } = containerWithWaiting();
    setNavigator({ serviceWorker: container });

    await render(<Probe idle reload={jest.fn()} />);
    await act(flushPromises);

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a service worker container (Jest, native)', async () => {
    setNavigator({});

    await render(<Probe idle />);
    await act(flushPromises);

    expect(screen.getByTestId('probe')).toBeOnTheScreen();
  });
});
