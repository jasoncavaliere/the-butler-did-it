/**
 * Tests for the Metro cache key over the build-time public env (#126): a changed
 * `EXPO_PUBLIC_*` value must change the key, so an export never serves an inlined value from an
 * earlier build; anything else must not.
 */

const { publicEnvCacheVersion, withPublicEnvCacheVersion } = require('./metro-env-cache');

describe('publicEnvCacheVersion', () => {
  it('lists only EXPO_PUBLIC_ variables, sorted by name', () => {
    expect(
      publicEnvCacheVersion({
        EXPO_PUBLIC_BUILD_SHA: 'abc1234',
        PATH: '/usr/bin',
        EXPO_PUBLIC_API_BASE_URL: '/api',
      }),
    ).toBe('EXPO_PUBLIC_API_BASE_URL=/api\nEXPO_PUBLIC_BUILD_SHA=abc1234');
  });

  it('changes when a public value changes', () => {
    expect(publicEnvCacheVersion({ EXPO_PUBLIC_BUILD_SHA: 'abc1234' })).not.toBe(
      publicEnvCacheVersion({ EXPO_PUBLIC_BUILD_SHA: 'def5678' }),
    );
  });

  it('treats unset and empty values alike', () => {
    expect(publicEnvCacheVersion({ EXPO_PUBLIC_BUILD_SHA: '' })).toBe(publicEnvCacheVersion({}));
    expect(publicEnvCacheVersion({})).toBe('');
  });
});

describe('withPublicEnvCacheVersion', () => {
  it('keeps the base cacheVersion and the rest of the config', () => {
    const config = { cacheVersion: 'base', projectRoot: '/app' };

    const result = withPublicEnvCacheVersion(config, { EXPO_PUBLIC_BUILD_SHA: 'abc1234' });

    expect(result).toEqual({ cacheVersion: 'base|EXPO_PUBLIC_BUILD_SHA=abc1234', projectRoot: '/app' });
    expect(config.cacheVersion).toBe('base');
  });

  it('works without a base cacheVersion', () => {
    expect(withPublicEnvCacheVersion({}, {}).cacheVersion).toBe('|');
  });

  it('reads process.env by default', () => {
    const saved = process.env.EXPO_PUBLIC_BUILD_SHA;
    try {
      process.env.EXPO_PUBLIC_BUILD_SHA = 'f00dbab';
      expect(withPublicEnvCacheVersion({}).cacheVersion).toContain('EXPO_PUBLIC_BUILD_SHA=f00dbab');
    } finally {
      if (saved === undefined) {
        delete process.env.EXPO_PUBLIC_BUILD_SHA;
      } else {
        process.env.EXPO_PUBLIC_BUILD_SHA = saved;
      }
    }
  });
});
