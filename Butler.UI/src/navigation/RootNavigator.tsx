import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { HouseholdScreen } from '../screens/HouseholdScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { HubShell } from '../screens/HubShell';
import { useHousehold } from '../state/HouseholdContext';

/** Route list for the root stack. Extend as screens are added. */
export type RootStackParamList = {
  Home: undefined;
  Household: undefined;
  HouseholdSetup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The Home route: the hub shell with the organizer's Household button wired to
 * the Household route. Navigation stays here so {@link HubShell} itself never
 * needs a navigation context.
 */
function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return <HubShell onEditHousehold={() => navigation.navigate('Household')} />;
}

/**
 * App navigation root. Until a household is selected the organizer is routed to
 * the onboarding flow (H5); once {@link useHousehold} holds a household id the
 * hub Home screen is mounted. Conditionally registering the screens (the React
 * Navigation auth-flow pattern) means the onboarding route is simply not present
 * once setup is complete. The Home route mounts the always-on {@link HubShell}
 * (T2) - the shared-device shell the rest of the product renders inside - and
 * the signed-in stack also holds the organizer's Household editor (#112), opened
 * from the Household button on the hub's organizer bar.
 */
export function RootNavigator() {
  const { householdId } = useHousehold();

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {householdId === null ? (
          <Stack.Screen
            name="HouseholdSetup"
            component={HouseholdSetupScreen}
            options={{ title: 'Set up Butler' }}
          />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Butler' }} />
            <Stack.Screen
              name="Household"
              component={HouseholdScreen}
              options={{ title: 'Household' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
