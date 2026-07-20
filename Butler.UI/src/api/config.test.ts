import {
  DEFAULT_DEV_API_BASE_URL,
  apiBaseUrl,
  apiUrl,
  authConfig,
  resolveApiBaseUrl,
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

  it('uses and trims a provided env value', () => {
    expect(resolveApiBaseUrl('  https://api.butler.test  ')).toBe('https://api.butler.test');
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
});
