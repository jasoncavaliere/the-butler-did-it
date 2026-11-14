import { OrganizerGate } from '../auth/OrganizerGate';
import { RosterEditor } from './RosterEditor';

/**
 * The Roster route (#167): the organizer's people editor behind the organizer
 * auth gate. A visitor the API does not accept as the organizer is blocked by
 * {@link OrganizerGate} and never reaches {@link RosterEditor}. `onDone` (from
 * the navigator) renders a Done button that returns to the hub.
 */
export function RosterScreen({ onDone }: { onDone?: () => void }) {
  return (
    <OrganizerGate>
      <RosterEditor onDone={onDone} />
    </OrganizerGate>
  );
}
