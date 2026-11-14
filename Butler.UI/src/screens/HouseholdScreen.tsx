import { OrganizerGate } from '../auth/OrganizerGate';
import { HouseholdEditor } from './HouseholdEditor';

/**
 * The Household route (#112): the organizer's room and chore editor behind the
 * organizer auth gate. A visitor the API does not accept as the organizer is
 * blocked by {@link OrganizerGate} and never reaches {@link HouseholdEditor}.
 */
export function HouseholdScreen() {
  return (
    <OrganizerGate>
      <HouseholdEditor />
    </OrganizerGate>
  );
}
