import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SERVICE_WORKER_URL } from './registerServiceWorker';
import { useServiceWorkerRegistration } from './useServiceWorkerRegistration';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function Probe() {
  useServiceWorkerRegistration();
  return <Text testID="probe">hub</Text>;
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

describe('useServiceWorkerRegistration', () => {
  it('registers the app-shell worker when the hub mounts', async () => {
    const register = jest.fn(async () => ({ scope: '/' }));
    setNavigator({ serviceWorker: { register } });

    await render(<Probe />);

    await waitFor(() => expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL));
    expect(screen.getByTestId('probe')).toBeOnTheScreen();
  });

  it('registers once, not on every re-render', async () => {
    const register = jest.fn(async () => ({ scope: '/' }));
    setNavigator({ serviceWorker: { register } });

    const view = await render(<Probe />);
    await view.rerender(<Probe />);
    await view.rerender(<Probe />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });

  it('mounts cleanly where the browser cannot install a worker', async () => {
    setNavigator({});

    await render(<Probe />);

    expect(screen.getByTestId('probe')).toBeOnTheScreen();
  });
});
