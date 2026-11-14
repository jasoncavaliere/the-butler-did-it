import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation/RootNavigator';
import { useServiceWorkerRegistration } from './src/pwa/useServiceWorkerRegistration';
import { AppConfigProvider } from './src/state/AppConfigContext';
import { HubPairingProvider } from './src/state/HubPairingProvider';
import { OrganizerProvider } from './src/state/OrganizerContext';

/**
 * App entry: wires the config, organizer, and hub pairing providers and the
 * navigation root. Screen content lives under `src/`; this file stays a thin
 * composition root. The organizer session (T4) sits above the household so the
 * API client and hub affordances can read it anywhere in the tree. The hub pairing
 * provider holds the household and the hub device token and keeps them across a
 * page reload (#188); the organizer session is never kept. It also registers the PWA
 * service worker on web (O1), which is what makes the hub installable and lets a second load
 * succeed with the network down.
 */
export default function App() {
  useServiceWorkerRegistration();

  return (
    <AppConfigProvider>
      <OrganizerProvider>
        <HubPairingProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </HubPairingProvider>
      </OrganizerProvider>
    </AppConfigProvider>
  );
}
