import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';

import { HubDeviceProvider, useHubDevice } from './HubDeviceContext';

function Probe() {
  const { deviceToken, isPaired, setDeviceToken } = useHubDevice();
  return (
    <>
      <Text testID="token">tok:{deviceToken ?? 'none'}</Text>
      <Text testID="paired">paired:{isPaired ? 'yes' : 'no'}</Text>
      <TouchableOpacity testID="set" onPress={() => setDeviceToken('tok-1')}>
        <Text>set</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="clear" onPress={() => setDeviceToken(null)}>
        <Text>clear</Text>
      </TouchableOpacity>
    </>
  );
}

describe('HubDeviceContext / useHubDevice', () => {
  it('defaults to unpaired outside a provider and its setter is a safe no-op', async () => {
    await render(<Probe />);

    expect(screen.getByTestId('token')).toHaveTextContent('tok:none');
    expect(screen.getByTestId('paired')).toHaveTextContent('paired:no');
    // The default no-op setter must not throw.
    fireEvent.press(screen.getByTestId('set'));
    expect(screen.getByTestId('token')).toHaveTextContent('tok:none');
  });

  it('seeds the initial token and reports it as paired', async () => {
    await render(
      <HubDeviceProvider initialDeviceToken="seed-token">
        <Probe />
      </HubDeviceProvider>,
    );

    expect(screen.getByTestId('token')).toHaveTextContent('tok:seed-token');
    expect(screen.getByTestId('paired')).toHaveTextContent('paired:yes');
  });

  it('stores and clears the token through the setter, tracking the paired flag', async () => {
    await render(
      <HubDeviceProvider>
        <Probe />
      </HubDeviceProvider>,
    );

    expect(screen.getByTestId('paired')).toHaveTextContent('paired:no');

    fireEvent.press(screen.getByTestId('set'));
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('tok:tok-1');
    });
    expect(screen.getByTestId('paired')).toHaveTextContent('paired:yes');

    fireEvent.press(screen.getByTestId('clear'));
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('tok:none');
    });
    expect(screen.getByTestId('paired')).toHaveTextContent('paired:no');
  });
});
