import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation/RootNavigator';
import { AppConfigProvider } from './src/state/AppConfigContext';

/**
 * App entry: wires the config provider and the navigation root. Screen content
 * lives under `src/`; this file stays a thin composition root.
 */
export default function App() {
  return (
    <AppConfigProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AppConfigProvider>
  );
}
