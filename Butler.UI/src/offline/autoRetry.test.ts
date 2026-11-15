import { AUTO_RETRY_BASE_MS, AUTO_RETRY_MAX_MS, autoRetryDelayMs } from './autoRetry';

describe('autoRetryDelayMs', () => {
  it('grows from the base and stops at the cap (AC4)', () => {
    const delays = Array.from({ length: 8 }, (_, attempt) => autoRetryDelayMs(attempt));

    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(delays[0]).toBe(AUTO_RETRY_BASE_MS);
    expect(Math.max(...delays)).toBe(AUTO_RETRY_MAX_MS);
  });

  it('stays at the cap for a very long outage', () => {
    expect(autoRetryDelayMs(1_000)).toBe(AUTO_RETRY_MAX_MS);
  });

  it('treats a negative attempt as the first', () => {
    expect(autoRetryDelayMs(-3)).toBe(AUTO_RETRY_BASE_MS);
  });
});
