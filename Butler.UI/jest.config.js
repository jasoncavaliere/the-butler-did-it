/**
 * Jest configuration for Butler.UI.
 *
 * Uses the Expo-recommended `jest-expo` preset (see the versioned Expo 57 docs:
 * https://docs.expo.dev/develop/unit-testing/). Coverage is gated per Engineering
 * Contract 7.7: 98% on all four metrics for the logic folders (`src/api/`,
 * `src/offline/`, `src/state/`, `src/auth/`) and for everything else collected
 * (`App.tsx`, `src/navigation/`, `src/pwa/`, `scripts/`), and 90% for the
 * presentation folders (`src/components/`, `src/screens/`) during the local demo
 * push. That exception is recorded in the 7.7 note "UI presentation exception
 * (demo push)" (#142) and is revisited after the first paid pilot.
 */
const LOGIC = { statements: 98, branches: 98, functions: 98, lines: 98 };
const PRESENTATION = { statements: 90, branches: 90, functions: 90, lines: 90 };

module.exports = {
  preset: 'jest-expo',
  // The first test in a suite absorbs module-transform/init overhead, which on a
  // cold CI runner can exceed Jest's 5s default even though the whole suite runs
  // in ~1s locally. Give real headroom so CI load never trips a false timeout; a
  // genuinely hung test still fails, just later.
  testTimeout: 15000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-screens|react-native-safe-area-context|@sentry/react-native|native-base|react-native-svg)',
  ],
  // App code plus the build tooling that decides whether the web export is an installable PWA
  // (O1) -- a broken `scripts/pwa-export.js` ships a hub that will not install, so it is held to
  // the same bar as the app.
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}', 'scripts/**/*.js', '!scripts/**/*.test.js'],
  // Directory keys (trailing slash) are checked on the combined coverage of the whole folder, and
  // files they match leave `global`, which then gates only what is left over. Do not switch these
  // to `**` globs: Jest checks glob keys per file, not per folder.
  coverageThreshold: {
    global: LOGIC,
    './src/api/': LOGIC,
    './src/offline/': LOGIC,
    './src/state/': LOGIC,
    './src/auth/': LOGIC,
    './src/components/': PRESENTATION,
    './src/screens/': PRESENTATION,
  },
};
