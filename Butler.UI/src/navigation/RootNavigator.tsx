import { NavigationContainer } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { HouseholdScreen } from '../screens/HouseholdScreen';
import { HouseholdSetupScreen } from '../screens/HouseholdSetupScreen';
import { HubShell } from '../screens/HubShell';
import { InsightsScreen } from '../screens/InsightsScreen';
import { RosterScreen } from '../screens/RosterScreen';
import { YourDataScreen } from '../screens/YourDataScreen';
import { useHousehold } from '../state/HouseholdContext';

/** Route list for the root stack. Extend as screens are added. */
export type RootStackParamList = {
  Home: undefined;
  Household: undefined;
  HouseholdSetup: undefined;
  Insights: undefined;
  Roster: undefined;
  YourData: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The Home route: the hub shell with the organizer's Household, Edit roster,
 * Insights and Your data buttons wired to their routes. Navigation stays here so
 * {@link HubShell} itself never needs a navigation context.
 *
 * The native stack keeps Home mounted under a pushed route, so the hub would
 * otherwise show what it read before the organizer left. Each time Home regains
 * focus after a blur it bumps `refreshSignal`, which makes the hub re-read the
 * household and roster in place (#167). The first focus on mount has no blur
 * before it, so it does not double the initial load.
 */
function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    let away = false;
    const offBlur = navigation.addListener('blur', () => {
      away = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (away) {
        away = false;
        setRefreshSignal((previous) => previous + 1);
      }
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);

  return (
    <HubShell
      onEditHousehold={() => navigation.navigate('Household')}
      onEditRoster={() => navigation.navigate('Roster')}
      onShowInsights={() => navigation.navigate('Insights')}
      onShowYourData={() => navigation.navigate('YourData')}
      refreshSignal={refreshSignal}
    />
  );
}

/** The Roster route (#167): the organizer's people editor, whose Done returns to the hub. */
function RosterRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Roster'>) {
  return <RosterScreen onDone={() => navigation.goBack()} />;
}

/**
 * App navigation root. Until a household is selected the organizer is routed to
 * the onboarding flow (H5); once {@link useHousehold} holds a household id the
 * hub Home screen is mounted. Conditionally registering the screens (the React
 * Navigation auth-flow pattern) means the onboarding route is simply not present
 * once setup is complete. The Home route mounts the always-on {@link HubShell}
 * (T2) - the shared-device shell the rest of the product renders inside - and
 * the signed-in stack also holds the organizer's Household editor (#112),
 * Roster editor (#167), Insights screen (#123) and Your data page (#125),
 * opened from the Household, Edit roster, Insights and Your data buttons on the
 * hub's organizer bar.
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
            <Stack.Screen name="Roster" component={RosterRoute} options={{ title: 'Roster' }} />
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
