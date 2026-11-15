/**
 * The hub's automatic read retry schedule (#109).
 *
 * A hub read that fails - the shell's household and roster, the chore board,
 * the balance, the cart - is retried by itself on this schedule, so a tablet
 * nobody touches recovers from a blip without a tap on "Try again". It is not
 * the write queue's `backoffDelayMs`: that one counts attempts from 1 and
 * caps lower because each step there is a write the household is waiting on;
 * here each step is only a re-read, and the cap keeps a long outage to one read
 * a minute.
 */

/** First retry delay, doubling per attempt. */
export const AUTO_RETRY_BASE_MS = 2_000;

/** Retry ceiling, so a long outage settles into one read a minute. */
export const AUTO_RETRY_MAX_MS = 60_000;

/**
 * Delay before retry number `attempt` (0-based): 2s, 4s, 8s, 16s, 32s, then
 * {@link AUTO_RETRY_MAX_MS} from there on. Deterministic (no jitter) - a single
 * wall tablet is not a thundering herd, and a fixed schedule is one a test can
 * assert on.
 */
export function autoRetryDelayMs(attempt: number): number {
  const step = Math.max(0, attempt);
  return Math.min(AUTO_RETRY_BASE_MS * 2 ** step, AUTO_RETRY_MAX_MS);
}
