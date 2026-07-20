import { OrganizerGate } from '../auth/OrganizerGate';
import { HouseholdSetup } from './HouseholdSetup';

/**
 * The onboarding route: the organizer setup wizard behind the organizer auth
 * gate. An unauthenticated or non-organizer visitor is blocked by
 * {@link OrganizerGate} and never reaches the {@link HouseholdSetup} flow.
 */
export function HouseholdSetupScreen() {
  return (
    <OrganizerGate>
      <HouseholdSetup />
    </OrganizerGate>
  );
}
