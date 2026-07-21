import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation/RootNavigator';
import { AppConfigProvider } from './src/state/AppConfigContext';
import { HouseholdProvider } from './src/state/HouseholdContext';
import { HubDeviceProvider } from './src/state/HubDeviceContext';
import { OrganizerProvider } from './src/state/OrganizerContext';

/**
 * App entry: wires the config, organizer, and household providers and the
 * navigation root. Screen content lives under `src/`; this file stays a thin
 * composition root. The organizer session (T4) sits above the household so the
 * API client and hub affordances can read it anywhere in the tree.
 */
export default function App() {
  return (
    <AppConfigProvider>
      <OrganizerProvider>
        <HouseholdProvider>
          <HubDeviceProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </HubDeviceProvider>
        </HouseholdProvider>
      </OrganizerProvider>
    </AppConfigProvider>
  );
}
