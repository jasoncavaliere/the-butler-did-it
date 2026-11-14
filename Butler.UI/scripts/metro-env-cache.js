/**
 * Metro transform-cache key for the build-time public env (#126).
 *
 * In a production export Expo inlines every direct `process.env.EXPO_PUBLIC_*` read as a literal
 * while it transforms the module, but Metro's transform cache is keyed on the file's contents and
 * the transformer config, not on env values. A module whose source did not change (for example
 * `src/api/config.ts`, which reads `EXPO_PUBLIC_BUILD_SHA`) is then served from the cache with the
 * value of an earlier export: the demo hub would report a stale build SHA. Folding every
 * `EXPO_PUBLIC_*` value into Metro's `cacheVersion` (part of its global cache key) makes the cache
 * miss exactly when one of those values changes, and hit as before otherwise.
 *
 * CLI: none; `metro.config.js` calls {@link withPublicEnvCacheVersion}.
 */

const PUBLIC_PREFIX = 'EXPO_PUBLIC_';

/**
 * A stable string of every `EXPO_PUBLIC_*` variable in `env`, sorted by name. Unset and empty
 * values are left out, so an unset variable and an empty one share a key (Expo inlines both as a
 * value the app treats as missing).
 */
function publicEnvCacheVersion(env) {
  return Object.keys(env)
    .filter((key) => key.startsWith(PUBLIC_PREFIX) && env[key])
    .sort()
    .map((key) => `${key}=${env[key]}`)
    .join('\n');
}

/** Returns `config` with the public env folded into its `cacheVersion` (the base version kept). */
function withPublicEnvCacheVersion(config, env = process.env) {
  const base = config.cacheVersion ?? '';
  return { ...config, cacheVersion: `${base}|${publicEnvCacheVersion(env)}` };
}

module.exports = { publicEnvCacheVersion, withPublicEnvCacheVersion };
