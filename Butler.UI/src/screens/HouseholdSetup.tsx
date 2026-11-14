import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { ApiError } from '../api/client';
import { friendlyApiError } from '../api/errors';
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
import { ActionButton, Chip, Field } from '../components/FormControls';
import { Screen, colors } from '../components/Screen';
import { WidgetError } from '../components/WidgetState';
import {
  templatesForRoom,
  toCreateChoreRequest,
  type StarterTemplate,
} from '../setup/starterTemplates';
import { useHousehold } from '../state/HouseholdContext';
import { claimColors } from '../theme/theme';

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

/**
 * What "Try again" re-sends after a failed request: the current step's own
 * submit, or the starter-chore add. `null` means the message on screen is the
 * client's own validation, which a retry cannot fix.
 */
type RetryKind = 'step' | 'templates' | null;

/** The line shown beside the spinner while a step's request is in flight. */
const LOADING_LINES: Record<Exclude<FlowState['step'], 'done'>, string> = {
  household: 'Setting up your household...',
  rooms: 'Adding the room...',
  people: 'Adding them to the household...',
  chores: 'Adding the chores...',
};

/** The chore recurrence options the API accepts. */
const CADENCES = ['Daily', 'Weekly'] as const;

/** Selection key for a starter template under one created room. */
function templateKey(room: RoomResponse, template: StarterTemplate): string {
  return `${room.roomId}:${template.id}`;
}

/** Chip label for a starter template, e.g. "Wipe the counters (Daily, effort 1, age 8+)". */
function templateLabel(template: StarterTemplate): string {
  const age = template.minAge !== null ? `, age ${template.minAge}+` : '';
  return `${template.title} (${template.cadence}, effort ${template.effort}${age})`;
}

/**
 * Organizer onboarding: a multi-step wizard that stands up a household on top of
 * the H1-H4 endpoints, driven entirely through the F7 typed API client (no
 * ad-hoc fetch). The steps run in order - create the household, add rooms, add
 * people (each with a child flag and claim colour), then map starter chores to
 * rooms. The claim colour is one of the six design-token claim colours
 * ({@link claimColors}), stored as its dark-variant hex because the hub is
 * dark-only (#120). The chores step offers starter chores from the bundled catalog
 * (`src/setup/`) under each created room whose name or alias matches a catalog
 * room; the organizer toggles the ones they want and adds them in one tap, next
 * to the custom-chore form. Each step POSTs to its endpoint. While a request is
 * in flight the flow shows a step-specific loading line (P8, ADR-0007); a failed
 * request shows a friendly message ({@link friendlyApiError}, never the server's
 * raw text) with a "Try again" that re-sends the current form, and does not
 * advance. Validation the client does itself shows its plain message with no
 * retry. The
 * created household id is carried through the flow so later steps can scope
 * their paths, and is published to {@link useHousehold} only on completion, so
 * the rest of the app then reads the correct household.
 */
export function HouseholdSetup() {
  const client = useApiClient();
  const { setHouseholdId: selectHousehold } = useHousehold();

  const [flow, setFlow] = useState<FlowState>({ step: 'household' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKind, setRetryKind] = useState<RetryKind>(null);

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
  // Starter-template keys (`${roomId}:${templateId}`) toggled on, and ones already created.
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [addedTemplates, setAddedTemplates] = useState<string[]>([]);

  /** Show the client's own validation message: nothing to retry. */
  function invalid(message: string) {
    setError(message);
    setRetryKind(null);
  }

  /** Clear any message, at the start of an attempt or a step change. */
  function clearError() {
    setError(null);
    setRetryKind(null);
  }

  /** Show a failed request in friendly words, with a retry of `kind`. */
  function failed(apiError: ApiError, kind: Exclude<RetryKind, null>) {
    setError(friendlyApiError(apiError));
    setRetryKind(kind);
  }

  async function submitHousehold() {
    const name = householdName.trim();
    if (!name) {
      invalid('Enter a name for your household.');
      return;
    }
    clearError();
    setSubmitting(true);
    const body: CreateHouseholdRequest = { name };
    const result = await client.update<HouseholdResponse>('/households', body, { method: 'POST' });
    setSubmitting(false);
    if (!result.ok) {
      failed(result.error, 'step');
      return;
    }
    setFlow({ step: 'rooms', householdId: result.data.householdId, rooms: [] });
  }

  async function addRoom(current: RoomsState) {
    const name = roomName.trim();
    if (!name) {
      invalid('Enter a room name.');
      return;
    }
    clearError();
    setSubmitting(true);
    const body: CreateRoomRequest = { name, sortOrder: current.rooms.length };
    const result = await client.update<RoomResponse>(
      `/households/${current.householdId}/rooms`,
      body,
      { method: 'POST' },
    );
    setSubmitting(false);
    if (!result.ok) {
      failed(result.error, 'step');
      return;
    }
    setFlow({ ...current, rooms: [...current.rooms, result.data] });
    setRoomName('');
  }

  function goToPeople(current: RoomsState) {
    if (current.rooms.length === 0) {
      invalid('Add at least one room before continuing.');
      return;
    }
    clearError();
    setFlow({ step: 'people', householdId: current.householdId, rooms: current.rooms, people: [] });
  }

  async function addPerson(current: PeopleState) {
    const displayName = personName.trim();
    if (!displayName) {
      invalid('Enter a name.');
      return;
    }
    clearError();
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
      failed(result.error, 'step');
      return;
    }
    setFlow({ ...current, people: [...current.people, result.data] });
    setPersonName('');
    setPersonIsChild(false);
    setPersonClaimColor(null);
  }

  function goToChores(current: PeopleState) {
    clearError();
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
      invalid('Enter a chore title.');
      return;
    }
    if (!choreRoomId) {
      invalid('Pick a room for this chore.');
      return;
    }
    const effort = Number.parseInt(choreEffort, 10);
    if (!Number.isFinite(effort) || effort <= 0) {
      invalid('Effort must be a positive whole number.');
      return;
    }
    clearError();
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
      failed(result.error, 'step');
      return;
    }
    setFlow({ ...current, chores: [...current.chores, result.data] });
    setChoreTitle('');
  }

  function toggleTemplate(key: string) {
    setSelectedTemplates((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    );
  }

  async function addTemplates(current: ChoresState) {
    // Rooms order, then catalog order: a deterministic create order.
    const work = current.rooms.flatMap((room) =>
      templatesForRoom(room.name)
        .filter((template) => selectedTemplates.includes(templateKey(room, template)))
        .map((template) => ({ room, template })),
    );
    if (work.length === 0) {
      invalid('Pick at least one starter chore.');
      return;
    }
    clearError();
    setSubmitting(true);
    const created: ChoreResponse[] = [];
    const createdKeys: string[] = [];
    // Sequential, not Promise.all: stop on the first failure and keep the rest selected.
    for (const { room, template } of work) {
      const result = await client.update<ChoreResponse>(
        `/households/${current.householdId}/chores`,
        toCreateChoreRequest(template, room.roomId),
        { method: 'POST' },
      );
      if (!result.ok) {
        failed(result.error, 'templates');
        break;
      }
      created.push(result.data);
      createdKeys.push(templateKey(room, template));
    }
    setSubmitting(false);
    setFlow({ ...current, chores: [...current.chores, ...created] });
    setAddedTemplates((keys) => [...keys, ...createdKeys]);
    setSelectedTemplates((keys) => keys.filter((k) => !createdKeys.includes(k)));
  }

  function finish(current: ChoresState) {
    // Completion: publish the new household to app-wide context so every
    // subsequent screen reads the correct household.
    selectHousehold(current.householdId);
    clearError();
    setFlow({
      step: 'done',
      rooms: current.rooms,
      people: current.people,
      chores: current.chores,
    });
  }

  // "Try again" re-sends whatever failed, with the form fields as they stand now.
  // Manual only; automatic retry is #109.
  async function retry() {
    switch (flow.step) {
      case 'household':
        await submitHousehold();
        break;
      case 'rooms':
        await addRoom(flow);
        break;
      case 'people':
        await addPerson(flow);
        break;
      case 'chores':
        await (retryKind === 'templates' ? addTemplates(flow) : addChore(flow));
        break;
    }
  }

  return (
    <Screen testID="household-setup">
      <Text style={styles.eyebrow}>BUTLER SETUP</Text>
      <StepHeading step={flow.step} />

      {error !== null &&
        (retryKind !== null ? (
          <View style={styles.errorBlock}>
            <WidgetError
              testID="setup-error"
              message={error}
              onRetry={() => {
                void retry();
              }}
              retryTestID="setup-retry"
            />
          </View>
        ) : (
          <Text style={styles.error} testID="setup-error">
            {error}
          </Text>
        ))}

      {submitting && flow.step !== 'done' && (
        <View style={styles.loading} testID="setup-loading" accessibilityRole="progressbar">
          <ActivityIndicator color={colors.brass} />
          <Text style={styles.loadingText}>{LOADING_LINES[flow.step]}</Text>
        </View>
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
            {claimColors.map((color) => (
              <Pressable
                key={color.name}
                testID={`claim-color-${color.name}`}
                accessibilityRole="button"
                accessibilityLabel={color.name}
                accessibilityState={{ selected: personClaimColor === color.dark }}
                onPress={() => setPersonClaimColor(color.dark)}
                style={[
                  styles.swatch,
                  { backgroundColor: color.dark },
                  personClaimColor === color.dark && styles.swatchSelected,
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
          <StarterChores
            rooms={flow.rooms}
            selected={selectedTemplates}
            added={addedTemplates}
            onToggle={toggleTemplate}
            onAdd={() => addTemplates(flow)}
            disabled={submitting}
          />
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

/**
 * The "Starter chores" section of the chores step: one group per created room
 * (in creation order) that matches a catalog room, listing its not-yet-added
 * templates as toggle chips, plus one "Add selected" button. Renders nothing
 * when no created room matches the catalog.
 */
function StarterChores({
  rooms,
  selected,
  added,
  onToggle,
  onAdd,
  disabled,
}: {
  rooms: RoomResponse[];
  selected: string[];
  added: string[];
  onToggle: (key: string) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  const groups = rooms
    .map((room) => ({
      room,
      templates: templatesForRoom(room.name).filter(
        (template) => !added.includes(templateKey(room, template)),
      ),
    }))
    .filter((group) => group.templates.length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <View style={styles.starter}>
      <Text style={styles.label}>Starter chores</Text>
      {groups.map(({ room, templates }) => (
        <View key={room.roomId} testID={`template-room-${room.roomId}`}>
          <Text style={styles.starterRoom}>{room.name}</Text>
          <View style={styles.swatches}>
            {templates.map((template) => {
              const key = templateKey(room, template);
              return (
                <Chip
                  key={key}
                  testID={`template-${room.roomId}-${template.id}`}
                  selected={selected.includes(key)}
                  onPress={() => onToggle(key)}
                >
                  {templateLabel(template)}
                </Chip>
              );
            })}
          </View>
        </View>
      ))}
      <ActionButton testID="add-templates" onPress={onAdd} disabled={disabled}>
        Add selected
      </ActionButton>
    </View>
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
  errorBlock: { marginBottom: 16 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  loadingText: { color: colors.muted, fontSize: 15 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: colors.ink },
  added: { marginBottom: 16 },
  starter: { marginBottom: 24 },
  starterRoom: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  addedItem: { color: colors.ink, fontSize: 15, marginBottom: 4 },
});
