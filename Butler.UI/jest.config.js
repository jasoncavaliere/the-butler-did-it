/**
 * Jest configuration for Butler.UI.
 *
 * Uses the Expo-recommended `jest-expo` preset (see the versioned Expo 57 docs:
 * https://docs.expo.dev/develop/unit-testing/). Coverage is gated at 98% for
 * all metrics per Engineering Contract 7.7 -- the first UI ticket sets the bar,
 * so everything under `src/` and the `App.tsx` composition root is covered.
 */
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-screens|react-native-safe-area-context|@sentry/react-native|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
  coverageThreshold: {
    global: {
      statements: 98,
      branches: 98,
      functions: 98,
      lines: 98,
    },
  },
};
