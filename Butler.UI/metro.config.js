// Metro config for Butler.UI: Expo's default, plus a transform-cache key over the build-time
// EXPO_PUBLIC_* values (#126), so a changed value (such as EXPO_PUBLIC_BUILD_SHA) is never served
// from an earlier export's cache. See scripts/metro-env-cache.js.
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const { withPublicEnvCacheVersion } = require('./scripts/metro-env-cache');

module.exports = withPublicEnvCacheVersion(getDefaultConfig(__dirname));
