// ESLint flat config for Butler.UI, using the Expo-recommended shared config.
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    // Build tooling for the web export (O1): plain CommonJS Node scripts, plus their Jest specs.
    // App code is TypeScript, where `no-undef` is off, so these globals only need declaring here.
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    // The PWA service worker runs in a worker scope, not a document scope (`self`, `caches`,
    // `clients`, no `window`).
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.serviceworker,
    },
  },
  {
    ignores: ['dist/*', 'node_modules/*'],
  },
]);
