import { FRIENDLY_ERROR, describeApiError, friendlyApiError, isPreconditionFailed } from './errors';

describe('describeApiError', () => {
  it('prefers the problem-details detail', () => {
    expect(
      describeApiError({
        kind: 'problem',
        status: 400,
        title: 'Bad Request',
        detail: "No room with id 'room-x' exists.",
      }),
    ).toBe("No room with id 'room-x' exists.");
  });

  it('falls back to the problem title when there is no detail', () => {
    expect(describeApiError({ kind: 'problem', status: 400, title: 'Validation failed' })).toBe(
      'Validation failed',
    );
  });

  it('falls back to the status when a problem has neither detail nor title', () => {
    expect(
      describeApiError({ kind: 'problem', status: 400, title: undefined as unknown as string }),
    ).toBe('Request failed (400).');
  });

  it('describes a network failure', () => {
    expect(describeApiError({ kind: 'network', status: 0, title: 'unreachable' })).toBe(
      'The household service is unreachable. Check your connection and try again.',
    );
  });

  it('describes a parse failure', () => {
    expect(describeApiError({ kind: 'parse', status: 200, title: 'bad json' })).toBe(
      'The household service returned an unexpected response. Please try again.',
    );
  });

  it('uses the title for a plain HTTP error', () => {
    expect(describeApiError({ kind: 'http', status: 500, title: 'Server Error' })).toBe(
      'Server Error',
    );
  });

  it('falls back to the status for an HTTP error with no title', () => {
    expect(describeApiError({ kind: 'http', status: 503, title: '' })).toBe(
      'Request failed (503).',
    );
  });
});

describe('isPreconditionFailed', () => {
  it('is true for a 412 stale-write refusal', () => {
    expect(isPreconditionFailed({ kind: 'problem', status: 412, title: 'Precondition Failed' })).toBe(
      true,
    );
  });

  it.each([
    ['a 400', { kind: 'problem' as const, status: 400, title: 'Bad Request' }],
    ['a 404', { kind: 'http' as const, status: 404, title: 'Not Found' }],
    ['a network failure', { kind: 'network' as const, status: 0, title: 'unreachable' }],
  ])('is false for %s', (_label, error) => {
    expect(isPreconditionFailed(error)).toBe(false);
  });
});

describe('friendlyApiError', () => {
  it('maps network, 4xx and other failures to fixed friendly lines and never echoes detail', () => {
    expect(friendlyApiError({ kind: 'network', status: 0, title: 'unreachable' })).toBe(
      FRIENDLY_ERROR.network,
    );
    const rejected = friendlyApiError({
      kind: 'problem',
      status: 400,
      title: 'Bad Request',
      detail: 'Effort must be positive.',
    });
    expect(rejected).toBe(FRIENDLY_ERROR.rejected);
    expect(rejected).not.toContain('Effort');
    expect(friendlyApiError({ kind: 'http', status: 499, title: 'Client Closed' })).toBe(
      FRIENDLY_ERROR.rejected,
    );
    expect(friendlyApiError({ kind: 'http', status: 500, title: 'Server Error' })).toBe(
      FRIENDLY_ERROR.failed,
    );
    expect(friendlyApiError({ kind: 'parse', status: 200, title: 'bad json' })).toBe(
      FRIENDLY_ERROR.failed,
    );
    expect(friendlyApiError({ kind: 'http', status: 399, title: 'Odd' })).toBe(FRIENDLY_ERROR.failed);
  });
});
