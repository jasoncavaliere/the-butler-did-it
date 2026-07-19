import { DEFAULT_DEV_API_BASE_URL, apiBaseUrl, apiUrl, resolveApiBaseUrl } from './config';

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
