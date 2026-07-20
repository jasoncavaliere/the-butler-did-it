import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { useHousehold } from '../state/HouseholdContext';

/** Route list for the root stack. Extend as screens are added. */
export type RootStackParamList = {
  Home: undefined;
  HouseholdSetup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * App navigation root. Until a household is selected the organizer is routed to
 * the onboarding flow (H5); once {@link useHousehold} holds a household id the
 * hub Home screen is mounted. Conditionally registering the screens (the React
 * Navigation auth-flow pattern) means the onboarding route is simply not present
 * once setup is complete.
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
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Butler' }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
