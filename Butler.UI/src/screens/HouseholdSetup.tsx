import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { describeApiError } from '../api/errors';
import type {
  ChoreResponse,
  CreateChoreRequest,
  CreateHouseholdRequest,
  CreatePersonRequest,
  CreateRoomRequest,
  HouseholdResponse,
  PersonResponse,
  RoomResponse,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { Screen, colors } from '../components/Screen';
import { useHousehold } from '../state/HouseholdContext';

/**
 * The onboarding flow as a discriminated state machine. Modelling the created
 * household id (and each step's running collection) into the state - rather than
 * a nullable field - means every step after "household" statically carries the
 * id it needs, so no step can run without one.
 */
type FlowState =
  | { step: 'household' }
  | { step: 'rooms'; householdId: string; rooms: RoomResponse[] }
  | { step: 'people'; householdId: string; rooms: RoomResponse[]; people: PersonResponse[] }
  | {
      step: 'chores';
      householdId: string;
      rooms: RoomResponse[];
      people: PersonResponse[];
      chores: ChoreResponse[];
    }
  | { step: 'done'; rooms: RoomResponse[]; people: PersonResponse[]; chores: ChoreResponse[] };

type RoomsState = Extract<FlowState, { step: 'rooms' }>;
type PeopleState = Extract<FlowState, { step: 'people' }>;
type ChoresState = Extract<FlowState, { step: 'chores' }>;

/** Preset claim colours an organizer can assign to a person's tile. */
const CLAIM_COLORS = ['#D9B25A', '#7FB2E5', '#E58B7F', '#8FD98F', '#C79FE5'] as const;

/** The chore recurrence options the API accepts. */
const CADENCES = ['Daily', 'Weekly'] as const;

/**
 * Organizer onboarding: a multi-step wizard that stands up a household on top of
 * the H1-H4 endpoints, driven entirely through the F7 typed API client (no
 * ad-hoc fetch). The steps run in order - create the household, add rooms, add
 * people (each with a child flag and claim colour), then map starter chores to
 * rooms. Each step POSTs to its endpoint; a failure surfaces the API's problem
 * details as an in-screen message and does not advance. The created household id
 * is carried through the flow so later steps can scope their paths, and is
 * published to {@link useHousehold} only on completion, so the rest of the app
 * then reads the correct household.
 */
export function HouseholdSetup() {
  const client = useApiClient();
  const { setHouseholdId: selectHousehold } = useHousehold();

  const [flow, setFlow] = useState<FlowState>({ step: 'household' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step-local form fields.
  const [householdName, setHouseholdName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [personName, setPersonName] = useState('');
  const [personIsChild, setPersonIsChild] = useState(false);
  const [personClaimColor, setPersonClaimColor] = useState<string | null>(null);
  const [choreTitle, setChoreTitle] = useState('');
  const [choreRoomId, setChoreRoomId] = useState<string | null>(null);
  const [choreCadence, setChoreCadence] = useState<(typeof CADENCES)[number]>('Weekly');
  const [choreEffort, setChoreEffort] = useState('1');

  async function submitHousehold() {
    const name = householdName.trim();
    if (!name) {
      setError('Enter a name for your household.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const body: CreateHouseholdRequest = { name };
    const result = await client.update<HouseholdResponse>('/households', body, { method: 'POST' });
    setSubmitting(false);
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setFlow({ step: 'rooms', householdId: result.data.householdId, rooms: [] });
  }

  async function addRoom(current: RoomsState) {
    const name = roomName.trim();
    if (!name) {
      setError('Enter a room name.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const body: CreateRoomRequest = { name, sortOrder: current.rooms.length };
    const result = await client.update<RoomResponse>(
      `/households/${current.householdId}/rooms`,
      body,
      { method: 'POST' },
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setFlow({ ...current, rooms: [...current.rooms, result.data] });
    setRoomName('');
  }

  function goToPeople(current: RoomsState) {
    if (current.rooms.length === 0) {
      setError('Add at least one room before continuing.');
      return;
    }
    setError(null);
    setFlow({ step: 'people', householdId: current.householdId, rooms: current.rooms, people: [] });
  }

  async function addPerson(current: PeopleState) {
    const displayName = personName.trim();
    if (!displayName) {
      setError('Enter a name.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const body: CreatePersonRequest = {
      displayName,
      role: 'Participant',
      isChild: personIsChild,
      claimColor: personClaimColor,
    };
    const result = await client.update<PersonResponse>(
      `/households/${current.householdId}/people`,
      body,
      { method: 'POST' },
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setFlow({ ...current, people: [...current.people, result.data] });
    setPersonName('');
    setPersonIsChild(false);
    setPersonClaimColor(null);
  }

  function goToChores(current: PeopleState) {
    setError(null);
    setFlow({
      step: 'chores',
      householdId: current.householdId,
      rooms: current.rooms,
      people: current.people,
      chores: [],
    });
  }

  async function addChore(current: ChoresState) {
    const title = choreTitle.trim();
    if (!title) {
      setError('Enter a chore title.');
      return;
    }
    if (!choreRoomId) {
      setError('Pick a room for this chore.');
      return;
    }
    const effort = Number.parseInt(choreEffort, 10);
    if (!Number.isFinite(effort) || effort <= 0) {
      setError('Effort must be a positive whole number.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const body: CreateChoreRequest = {
      title,
      roomId: choreRoomId,
      cadence: choreCadence,
      effort,
      minAge: null,
    };
    const result = await client.update<ChoreResponse>(
      `/households/${current.householdId}/chores`,
      body,
      { method: 'POST' },
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setFlow({ ...current, chores: [...current.chores, result.data] });
    setChoreTitle('');
  }

  function finish(current: ChoresState) {
    // Completion: publish the new household to app-wide context so every
    // subsequent screen reads the correct household.
    selectHousehold(current.householdId);
    setFlow({
      step: 'done',
      rooms: current.rooms,
      people: current.people,
      chores: current.chores,
    });
  }

  return (
    <Screen testID="household-setup">
      <Text style={styles.eyebrow}>BUTLER SETUP</Text>
      <StepHeading step={flow.step} />

      {error !== null && (
        <Text style={styles.error} testID="setup-error">
          {error}
        </Text>
      )}

      {flow.step === 'household' && (
        <View>
          <Field
            label="Household name"
            testID="input-household-name"
            value={householdName}
            onChangeText={setHouseholdName}
            placeholder="The Smith Household"
          />
          <ActionButton testID="submit-household" onPress={submitHousehold} disabled={submitting}>
            Create household
          </ActionButton>
        </View>
      )}

      {flow.step === 'rooms' && (
        <View>
          <Field
            label="Room name"
            testID="input-room-name"
            value={roomName}
            onChangeText={setRoomName}
            placeholder="Kitchen"
          />
          <ActionButton testID="add-room" onPress={() => addRoom(flow)} disabled={submitting}>
            Add room
          </ActionButton>
          <AddedList
            label="Rooms added"
            testIdPrefix="room-item"
            items={flow.rooms.map((room) => ({ id: room.roomId, text: room.name }))}
          />
          <ActionButton
            testID="continue-rooms"
            onPress={() => goToPeople(flow)}
            disabled={submitting}
            variant="secondary"
          >
            Continue to people
          </ActionButton>
        </View>
      )}

      {flow.step === 'people' && (
        <View>
          <Field
            label="Person name"
            testID="input-person-name"
            value={personName}
            onChangeText={setPersonName}
            placeholder="Alex"
          />
          <View style={styles.row}>
            <Text style={styles.label}>Child</Text>
            <Switch
              testID="input-person-child"
              value={personIsChild}
              onValueChange={setPersonIsChild}
            />
          </View>
          <Text style={styles.label}>Claim colour</Text>
          <View style={styles.swatches}>
            {CLAIM_COLORS.map((color) => (
              <Pressable
                key={color}
                testID={`claim-color-${color}`}
                accessibilityRole="button"
                accessibilityState={{ selected: personClaimColor === color }}
                onPress={() => setPersonClaimColor(color)}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  personClaimColor === color && styles.swatchSelected,
                ]}
              />
            ))}
          </View>
          <ActionButton testID="add-person" onPress={() => addPerson(flow)} disabled={submitting}>
            Add person
          </ActionButton>
          <AddedList
            label="People added"
            testIdPrefix="person-item"
            items={flow.people.map((person) => ({
              id: person.personId,
              text: person.isChild ? `${person.displayName} (child)` : person.displayName,
            }))}
          />
          <ActionButton
            testID="continue-people"
            onPress={() => goToChores(flow)}
            disabled={submitting}
            variant="secondary"
          >
            Continue to chores
          </ActionButton>
        </View>
      )}

      {flow.step === 'chores' && (
        <View>
          <Field
            label="Chore title"
            testID="input-chore-title"
            value={choreTitle}
            onChangeText={setChoreTitle}
            placeholder="Take out the trash"
          />
          <Text style={styles.label}>Room</Text>
          <View style={styles.swatches}>
            {flow.rooms.map((room) => (
              <Chip
                key={room.roomId}
                testID={`chore-room-${room.roomId}`}
                selected={choreRoomId === room.roomId}
                onPress={() => setChoreRoomId(room.roomId)}
              >
                {room.name}
              </Chip>
            ))}
          </View>
          <Text style={styles.label}>Cadence</Text>
          <View style={styles.swatches}>
            {CADENCES.map((cadence) => (
              <Chip
                key={cadence}
                testID={`cadence-${cadence}`}
                selected={choreCadence === cadence}
                onPress={() => setChoreCadence(cadence)}
              >
                {cadence}
              </Chip>
            ))}
          </View>
          <Field
            label="Effort"
            testID="input-chore-effort"
            value={choreEffort}
            onChangeText={setChoreEffort}
            placeholder="1"
            keyboardType="numeric"
          />
          <ActionButton testID="add-chore" onPress={() => addChore(flow)} disabled={submitting}>
            Add chore
          </ActionButton>
          <AddedList
            label="Chores added"
            testIdPrefix="chore-item"
            items={flow.chores.map((chore) => ({ id: chore.choreId, text: chore.title }))}
          />
          <ActionButton
            testID="finish-setup"
            onPress={() => finish(flow)}
            disabled={submitting}
            variant="secondary"
          >
            Finish setup
          </ActionButton>
        </View>
      )}

      {flow.step === 'done' && (
        <Text style={styles.body} testID="setup-done">
          Your household is ready: {flow.rooms.length} rooms, {flow.people.length} people, and{' '}
          {flow.chores.length} chores are set up.
        </Text>
      )}
    </Screen>
  );
}

/** The heading for the active step (also the step's stable testID). */
function StepHeading({ step }: { step: FlowState['step'] }) {
  const titles: Record<FlowState['step'], string> = {
    household: 'Create your household',
    rooms: 'Add rooms',
    people: 'Add people',
    chores: 'Map starter chores',
    done: 'All set',
  };
  return (
    <Text style={styles.title} accessibilityRole="header" testID={`step-${step}`}>
      {titles[step]}
    </Text>
  );
}

/** Labelled text input used across the steps. */
function Field({
  label,
  testID,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'numeric';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
      />
    </View>
  );
}

/** A pressable button in a primary or secondary style. */
function ActionButton({
  testID,
  onPress,
  disabled,
  variant = 'primary',
  children,
}: {
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={variant === 'secondary' ? styles.buttonSecondaryText : styles.buttonText}>
        {children}
      </Text>
    </Pressable>
  );
}

/** A selectable chip (room / cadence picker). */
function Chip({
  testID,
  selected,
  onPress,
  children,
}: {
  testID: string;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={selected ? styles.chipSelectedText : styles.chipText}>{children}</Text>
    </Pressable>
  );
}

/** Renders the running list of items added in the current step. */
function AddedList({
  label,
  testIdPrefix,
  items,
}: {
  label: string;
  testIdPrefix: string;
  items: { id: string; text: string }[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={styles.added}>
      <Text style={styles.label}>{label}</Text>
      {items.map((item) => (
        <Text key={item.id} testID={`${testIdPrefix}-${item.id}`} style={styles.addedItem}>
          {item.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', marginTop: 8, marginBottom: 16 },
  body: { color: colors.ink, fontSize: 16 },
  error: { color: '#E5A0A0', fontSize: 14, marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    color: colors.ink,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: colors.ink },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brass, borderColor: colors.brass },
  chipText: { color: colors.ink, fontSize: 14 },
  chipSelectedText: { color: colors.page, fontSize: 14, fontWeight: '700' },
  button: {
    backgroundColor: colors.brass,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.page, fontSize: 16, fontWeight: '700' },
  buttonSecondaryText: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  added: { marginBottom: 16 },
  addedItem: { color: colors.ink, fontSize: 15, marginBottom: 4 },
});
