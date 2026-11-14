/**
 * Drop everything the hub keeps offline for one household.
 *
 * This is the one place the hub forgets a household's offline state. Two flows
 * call it: the dataset guard, when the API serves a different dataset (#100 D7),
 * and household teardown, after the API has deleted the household (#168). Both
 * need the same thing - nothing from a household that is gone may be shown as
 * last-known or replayed later.
 *
 * The write queue is cleared before the glance, so a queued write can never
 * outlive the cache it was rendered over. The household's last-seen dataset id
 * (`butler.dataset.v1.*`) is deliberately left alone: it holds no household
 * data, and the dataset guard owns it.
 */

import { clearGlance } from './glanceCache';
import { clearWriteQueue } from './writeQueue';

/** Clear `householdId`'s write queue, then its cached glance. Never throws. */
export function forgetHouseholdOffline(householdId: string): void {
  clearWriteQueue(householdId);
  clearGlance(householdId);
}
