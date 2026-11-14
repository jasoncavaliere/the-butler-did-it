import { NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { HouseholdScreen } from '../screens/HouseholdScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { HubShell } from '../screens/HubShell';
import { InsightsScreen } from '../screens/InsightsScreen';
import { YourDataScreen } from '../screens/YourDataScreen';
import { useHousehold } from '../state/HouseholdContext';

/** Route list for the root stack. Extend as screens are added. */
export type RootStackParamList = {
  Home: undefined;
  Household: undefined;
  HouseholdSetup: undefined;
  Insights: undefined;
  YourData: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The Home route: the hub shell with the organizer's Household, Insights and
 * Your data buttons wired to their routes. Navigation stays here so {@link HubShell}
 * itself never needs a navigation context.
 */
function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return (
    <HubShell
      onEditHousehold={() => navigation.navigate('Household')}
      onShowInsights={() => navigation.navigate('Insights')}
      onShowYourData={() => navigation.navigate('YourData')}
    />
  );
}

/**
 * App navigation root. Until a household is selected the organizer is routed to
 * the onboarding flow (H5); once {@link useHousehold} holds a household id the
 * hub Home screen is mounted. Conditionally registering the screens (the React
 * Navigation auth-flow pattern) means the onboarding route is simply not present
 * once setup is complete. The Home route mounts the always-on {@link HubShell}
 * (T2) - the shared-device shell the rest of the product renders inside - and
 * the signed-in stack also holds the organizer's Household editor (#112),
 * Insights screen (#123) and Your data page (#125), opened from the Household,
 * Insights and Your data buttons on the hub's organizer bar.
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
            <Stack.Screen
              name="Insights"
              component={InsightsScreen}
              options={{ title: 'Insights' }}
            />
            <Stack.Screen
              name="YourData"
              component={YourDataScreen}
              options={{ title: 'Your data' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
