import {
  DEFAULT_DEV_API_BASE_URL,
  apiBaseUrl,
  apiUrl,
  authConfig,
  resolveApiBaseUrl,
  buildTimeAuthEnv,
  resolveAuthConfig,
} from './config';

describe('resolveApiBaseUrl', () => {
  it('falls back to the dev default when the env value is undefined', () => {
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_DEV_API_BASE_URL);
    expect(DEFAULT_DEV_API_BASE_URL).toBe('http://localhost:5108');
  });

  it('falls back to the dev default when the env value is blank', () => {
    expect(resolveApiBaseUrl('   ')).toBe(DEFAULT_DEV_API_BASE_URL);
  });

  it('uses and trims an absolute env value', () => {
    expect(resolveApiBaseUrl('  https://api.butler.test  ')).toBe('https://api.butler.test');
  });

  it('returns a relative /api base unchanged', () => {
    expect(resolveApiBaseUrl('/api')).toBe('/api');
    expect(resolveApiBaseUrl('  /api  ')).toBe('/api');
  });

  it('reads process.env by default', () => {
    // No EXPO_PUBLIC_API_BASE_URL is set in the test env, so it defaults.
    expect(resolveApiBaseUrl()).toBe(DEFAULT_DEV_API_BASE_URL);
    expect(apiBaseUrl).toBe(DEFAULT_DEV_API_BASE_URL);
  });
});

describe('apiUrl', () => {
  it('joins a path that has no leading slash', () => {
    expect(apiUrl('api/hello', 'http://host:1')).toBe('http://host:1/api/hello');
  });

  it('joins a path that has a leading slash', () => {
    expect(apiUrl('/api/hello', 'http://host:1')).toBe('http://host:1/api/hello');
  });

  it('strips trailing slashes from the base URL', () => {
    expect(apiUrl('/api/hello', 'http://host:1///')).toBe('http://host:1/api/hello');
  });

  it('builds same-origin relative URLs from a relative /api base', () => {
    expect(apiUrl('/households', '/api')).toBe('/api/households');
    expect(apiUrl('households/hh-1', '/api/')).toBe('/api/households/hh-1');
    expect(apiUrl('/api/system/ping', '/api')).toBe('/api/api/system/ping');
  });

  it('defaults the base URL to the resolved apiBaseUrl', () => {
    expect(apiUrl('/api/hello')).toBe(`${apiBaseUrl}/api/hello`);
  });
});

describe('resolveAuthConfig', () => {
  it('defaults to dev mode with basic scopes when nothing is set', () => {
    const config = resolveAuthConfig({});
    expect(config.disableAuthentication).toBe(true);
    expect(config.authority).toBe('');
    expect(config.clientId).toBe('');
    expect(config.redirectUri).toBe('');
    expect(config.scopes).toEqual(['openid', 'profile']);
  });

  it('reads process.env by default (dev in the test env)', () => {
    expect(resolveAuthConfig().disableAuthentication).toBe(true);
    expect(authConfig.disableAuthentication).toBe(true);
  });

  it('enables live auth when the flag is "false" and trims OIDC values', () => {
    const config = resolveAuthConfig({
      EXPO_PUBLIC_DISABLE_AUTH: 'false',
      EXPO_PUBLIC_AUTH_AUTHORITY: '  https://tenant.ciamlogin.com/tid/v2.0  ',
      EXPO_PUBLIC_AUTH_CLIENT_ID: '  client-123  ',
      EXPO_PUBLIC_AUTH_REDIRECT_URI: '  https://hub.butler.test/callback  ',
      EXPO_PUBLIC_AUTH_SCOPES: '  openid profile  api://client-123/access  ',
    });
    expect(config.disableAuthentication).toBe(false);
    expect(config.authority).toBe('https://tenant.ciamlogin.com/tid/v2.0');
    expect(config.clientId).toBe('client-123');
    expect(config.redirectUri).toBe('https://hub.butler.test/callback');
    expect(config.scopes).toEqual(['openid', 'profile', 'api://client-123/access']);
  });

  it('treats "1" as disabling auth (dev) and a blank flag as dev too', () => {
    expect(resolveAuthConfig({ EXPO_PUBLIC_DISABLE_AUTH: '1' }).disableAuthentication).toBe(true);
    expect(resolveAuthConfig({ EXPO_PUBLIC_DISABLE_AUTH: '   ' }).disableAuthentication).toBe(true);
  });

  it('treats any non-true, non-1 value as enabling live auth', () => {
    expect(resolveAuthConfig({ EXPO_PUBLIC_DISABLE_AUTH: 'no' }).disableAuthentication).toBe(false);
  });

  it('selects the provider from EXPO_PUBLIC_AUTH_PROVIDER (case-insensitive, trimmed)', () => {
    const pin = resolveAuthConfig({ EXPO_PUBLIC_AUTH_PROVIDER: ' PIN ', EXPO_PUBLIC_DISABLE_AUTH: 'true' });
    expect(pin.provider).toBe('pin');
    expect(pin.disableAuthentication).toBe(false);
    expect(resolveAuthConfig({ EXPO_PUBLIC_AUTH_PROVIDER: 'entra' }).provider).toBe('entra');
    const dev = resolveAuthConfig({ EXPO_PUBLIC_AUTH_PROVIDER: 'dev', EXPO_PUBLIC_DISABLE_AUTH: 'false' });
    expect(dev.provider).toBe('dev');
    expect(dev.disableAuthentication).toBe(true);
  });

  it('falls back to EXPO_PUBLIC_DISABLE_AUTH when the provider is unset or unknown', () => {
    expect(resolveAuthConfig({}).provider).toBe('dev');
    expect(resolveAuthConfig({ EXPO_PUBLIC_DISABLE_AUTH: 'false' }).provider).toBe('entra');
    expect(resolveAuthConfig({ EXPO_PUBLIC_AUTH_PROVIDER: 'okta' }).provider).toBe('dev');
  });

  it('reads each auth variable with a direct process.env access, so Expo can inline it', () => {
    const saved = process.env.EXPO_PUBLIC_AUTH_PROVIDER;
    process.env.EXPO_PUBLIC_AUTH_PROVIDER = 'pin';
    try {
      expect(buildTimeAuthEnv().EXPO_PUBLIC_AUTH_PROVIDER).toBe('pin');
      expect(resolveAuthConfig().provider).toBe('pin');
    } finally {
      if (saved === undefined) {
        delete process.env.EXPO_PUBLIC_AUTH_PROVIDER;
      } else {
        process.env.EXPO_PUBLIC_AUTH_PROVIDER = saved;
      }
    }
  });
});
