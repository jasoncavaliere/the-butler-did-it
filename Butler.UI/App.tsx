import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation/RootNavigator';
import { AppConfigProvider } from './src/state/AppConfigContext';
import { HouseholdProvider } from './src/state/HouseholdContext';

/**
 * App entry: wires the config + household providers and the navigation root.
 * Screen content lives under `src/`; this file stays a thin composition root.
 */
export default function App() {
  return (
    <AppConfigProvider>
      <HouseholdProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </HouseholdProvider>
    </AppConfigProvider>
  );
}
