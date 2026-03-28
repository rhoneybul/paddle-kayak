import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { getSession } from './src/services/authService';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: true,                // off in local dev, on in TestFlight + production
  tracesSampleRate: 0.2,        // capture 20% of transactions for performance
});

import SignInScreen       from './src/screens/SignInScreen';
import HomeScreen         from './src/screens/HomeScreen';
import TripSetupScreen    from './src/screens/TripSetupScreen';
import PlannerScreen      from './src/screens/PlannerScreen';
import WeatherScreen      from './src/screens/WeatherScreen';
import RoutesScreen       from './src/screens/RoutesScreen';
import CampsitesScreen    from './src/screens/CampsitesScreen';
import ActivePaddleScreen from './src/screens/ActivePaddleScreen';
import EmergencyScreen    from './src/screens/EmergencyScreen';
import HistoryScreen      from './src/screens/HistoryScreen';
import SavedRoutesScreen   from './src/screens/SavedRoutesScreen';
import YourPaddlesScreen   from './src/screens/YourPaddlesScreen';
import SavedSearchesScreen    from './src/screens/SavedSearchesScreen';
import CompletedPaddlesScreen from './src/screens/CompletedPaddlesScreen';
import WebWrapper             from './src/components/WebWrapper';

const Stack = createStackNavigator();

const slide = ({ current, layouts }) => ({
  cardStyle: {
    transform: [{
      translateX: current.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [layouts.screen.width * 0.25, 0],
      }),
    }],
    opacity: current.progress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, 0.8, 1],
    }),
  },
});

export default Sentry.wrap(function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    getSession().then(session => {
      setInitialRoute(session ? 'Home' : 'SignIn');
    });
  }, []);

  if (!initialRoute) return null; // brief splash while checking session

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <WebWrapper>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#f2f1ed' },
              cardStyleInterpolator: slide,
            }}
          >
            <Stack.Screen name="SignIn"        component={SignInScreen} />
            <Stack.Screen name="Home"          component={HomeScreen} />
            <Stack.Screen name="TripSetup"     component={TripSetupScreen} />
            <Stack.Screen name="Planner"       component={PlannerScreen} />
            <Stack.Screen name="Weather"       component={WeatherScreen} />
            <Stack.Screen name="Routes"        component={RoutesScreen} />
            <Stack.Screen name="Campsites"     component={CampsitesScreen} />
            <Stack.Screen name="ActivePaddle"  component={ActivePaddleScreen} />
            <Stack.Screen name="Emergency"     component={EmergencyScreen} />
            <Stack.Screen name="History"       component={HistoryScreen} />
            <Stack.Screen name="SavedRoutes"    component={SavedRoutesScreen} />
            <Stack.Screen name="YourPaddles"    component={YourPaddlesScreen} />
            <Stack.Screen name="SavedSearches"    component={SavedSearchesScreen} />
            <Stack.Screen name="CompletedPaddles" component={CompletedPaddlesScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </WebWrapper>
    </SafeAreaProvider>
  );
});
