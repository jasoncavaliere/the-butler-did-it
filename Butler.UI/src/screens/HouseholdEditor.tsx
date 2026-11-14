import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { ApiError } from '../api/client';
import { describeApiError, isPreconditionFailed } from '../api/errors';
import type {
  ChoreResponse,
  CreateChoreRequest,
  CreateRoomRequest,
  RoomResponse,
  UpdateChoreRequest,
  UpdateRoomRequest,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { ActionButton, Chip, Field } from '../components/FormControls';
import { Screen, colors } from '../components/Screen';
import { useHousehold } from '../state/HouseholdContext';

/** The chore recurrence options the API accepts. */
const CADENCES = ['Daily', 'Weekly'] as const;

const COPY = {
  noHousehold: 'No household is selected.',
  removeBlocked: "Move this room's active chores to another room or deactivate them first.",
  stale: 'Someone else changed this household since it was loaded. Reload to see the latest.',
} as const;

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rooms: RoomResponse[]; chores: ChoreResponse[] };

/** The chore form's raw field values (numbers stay text until Save). */
type ChoreForm = {
  title: string;
  roomId: string;
  cadence: string;
  effort: string;
  minAge: string;
  active: boolean;
};

/**
 * The one editor open at a time. A chore form remembers where it was opened
 * (`anchor`: the room card for an add, the chore row for an edit) so it renders
 * there even when the organizer picks a different room in the form.
 */
type Editor =
  | { kind: 'rename-room'; roomId: string; name: string }
  | { kind: 'remove-room'; roomId: string }
  | { kind: 'add-chore'; anchorRoomId: string; form: ChoreForm }
  | { kind: 'edit-chore'; choreId: string; form: ChoreForm };

/** Parse a positive whole number, or `null` when the text is not one. */
function parseEffort(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

/** Parse an optional min age: blank is "any age" (`null`), else a whole number. */
function parseMinAge(text: string): { valid: boolean; value: number | null } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { valid: true, value: null };
  }
  return /^\d+$/.test(trimmed) ? { valid: true, value: Number(trimmed) } : { valid: false, value: null };
}

/** One readable line for a chore, e.g. "Weekly - effort 2 - min age 8 - Active". */
function choreMeta(chore: ChoreResponse): string {
  const age = chore.minAge === null ? 'any age' : `min age ${chore.minAge}`;
  return `${chore.cadence} - effort ${chore.effort} - ${age} - ${chore.active ? 'Active' : 'Inactive'}`;
}

function formFor(chore: ChoreResponse): ChoreForm {
  return {
    title: chore.title,
    roomId: chore.roomId,
    cadence: chore.cadence,
    effort: String(chore.effort),
    minAge: chore.minAge === null ? '' : String(chore.minAge),
    active: chore.active,
  };
}

/**
 * The organizer's Household editor (#112): the household's rooms, each with its
 * chores, and the edits an organizer makes after setup. Every write goes through
 * the F7 typed client and, on success, replaces the item with the response body,
 * so the next edit carries that item's fresh `eTag`. Renames and chore edits are
 * PUTs under `If-Match` (Engineering Contract 7.3); a stale ETag (`412`) shows a
 * reload prompt that re-reads both lists rather than re-sending the edit. Any
 * other failure shows the problem-details message and leaves the list as it was.
 *
 * Removing a room is refused on the client while it still has active chores: the
 * server DELETE does not check, and dropping a room under live chores would
 * strand them. Chores whose room no longer exists are listed under "Not in a
 * room" so they stay reachable.
 */
export function HouseholdEditor() {
  const client = useApiClient();
  const { householdId } = useHousehold();

  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [newRoomName, setNewRoomName] = useState('');

  const read = useCallback(async (): Promise<LoadState> => {
    if (householdId === null) {
      return { phase: 'error', message: COPY.noHousehold };
    }
    const [rooms, chores] = await Promise.all([
      client.get<RoomResponse[]>(`/households/${householdId}/rooms`),
      client.get<ChoreResponse[]>(`/households/${householdId}/chores`),
    ]);
    if (!rooms.ok) {
      return { phase: 'error', message: describeApiError(rooms.error) };
    }
    if (!chores.ok) {
      return { phase: 'error', message: describeApiError(chores.error) };
    }
    return { phase: 'ready', rooms: rooms.data, chores: chores.data };
  }, [client, householdId]);

  useEffect(() => {
    let active = true;
    read().then((next) => {
      if (active) {
        setLoad(next);
      }
    });
    return () => {
      active = false;
    };
  }, [read]);

  /** Re-read both lists (and their ETags); never re-sends the refused edit. */
  async function reload() {
    setBusy(true);
    const next = await read();
    setLoad(next);
    setStale(false);
    setNotice(null);
    setEditor(null);
    setBusy(false);
  }

  /** A failed write: a stale ETag prompts a reload; anything else is a message. */
  function fail(error: ApiError) {
    if (isPreconditionFailed(error)) {
      setStale(true);
      setNotice(null);
      return;
    }
    setNotice(describeApiError(error));
  }

  if (load.phase === 'loading') {
    return (
      <Screen testID="household-editor">
        <View style={styles.centeredRow} testID="household-loading">
          <ActivityIndicator color={colors.brass} />
          <Text style={styles.muted}>Loading your household...</Text>
        </View>
      </Screen>
    );
  }

  if (load.phase === 'error') {
    return (
      <Screen testID="household-editor">
        <Text style={styles.error} testID="household-load-error">
          {load.message}
        </Text>
        {householdId !== null ? (
          <ActionButton testID="household-reload" onPress={reload} disabled={busy} variant="secondary">
            Try again
          </ActionButton>
        ) : null}
      </Screen>
    );
  }

  const { rooms, chores } = load;
  const sortedRooms = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder);
  const roomIds = new Set(rooms.map((room) => room.roomId));
  const unroomed = chores.filter((chore) => !roomIds.has(chore.roomId));
  const base = `/households/${householdId}`;

  /** Begin a write: clear the last message and hold every write button. */
  function begin() {
    setNotice(null);
    setBusy(true);
  }

  async function addRoom() {
    const name = newRoomName.trim();
    begin();
    const body: CreateRoomRequest = {
      name,
      sortOrder: rooms.reduce((max, room) => Math.max(max, room.sortOrder + 1), 0),
    };
    const result = await client.update<RoomResponse>(`${base}/rooms`, body, { method: 'POST' });
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setLoad({ phase: 'ready', rooms: [...rooms, result.data], chores });
    setNewRoomName('');
  }

  async function renameRoom(room: RoomResponse, name: string) {
    begin();
    const body: UpdateRoomRequest = { name: name.trim(), sortOrder: room.sortOrder };
    const result = await client.update<RoomResponse>(`${base}/rooms/${room.roomId}`, body, {
      method: 'PUT',
      ifMatch: room.eTag,
    });
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setLoad({
      phase: 'ready',
      rooms: rooms.map((r) => (r.roomId === room.roomId ? result.data : r)),
      chores,
    });
    setEditor(null);
  }

  function requestRemoveRoom(room: RoomResponse) {
    const hasActive = chores.some((chore) => chore.roomId === room.roomId && chore.active);
    if (hasActive) {
      setEditor(null);
      setNotice(COPY.removeBlocked);
      return;
    }
    setNotice(null);
    setEditor({ kind: 'remove-room', roomId: room.roomId });
  }

  async function removeRoom(room: RoomResponse) {
    begin();
    const result = await client.update<void>(`${base}/rooms/${room.roomId}`, undefined, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setLoad({ phase: 'ready', rooms: rooms.filter((r) => r.roomId !== room.roomId), chores });
    setEditor(null);
  }

  async function saveChore(current: Extract<Editor, { kind: 'add-chore' | 'edit-chore' }>) {
    const { form } = current;
    const fields: CreateChoreRequest = {
      title: form.title.trim(),
      roomId: form.roomId,
      cadence: form.cadence,
      // Save is only enabled once both parse (see choreFormValid).
      effort: parseEffort(form.effort) as number,
      minAge: parseMinAge(form.minAge).value,
    };
    begin();
    if (current.kind === 'add-chore') {
      const result = await client.update<ChoreResponse>(`${base}/chores`, fields, { method: 'POST' });
      setBusy(false);
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setLoad({ phase: 'ready', rooms, chores: [...chores, result.data] });
      setEditor(null);
      return;
    }
    const chore = chores.find((c) => c.choreId === current.choreId) as ChoreResponse;
    const body: UpdateChoreRequest = { ...fields, active: form.active };
    const result = await client.update<ChoreResponse>(`${base}/chores/${chore.choreId}`, body, {
      method: 'PUT',
      ifMatch: chore.eTag,
    });
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setLoad({
      phase: 'ready',
      rooms,
      chores: chores.map((c) => (c.choreId === chore.choreId ? result.data : c)),
    });
    setEditor(null);
  }

  async function deactivateChore(chore: ChoreResponse) {
    begin();
    const result = await client.update<ChoreResponse>(
      `${base}/chores/${chore.choreId}/deactivate`,
      {},
      { method: 'POST' },
    );
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setLoad({
      phase: 'ready',
      rooms,
      chores: chores.map((c) => (c.choreId === chore.choreId ? result.data : c)),
    });
  }

  function choreFormValid(form: ChoreForm): boolean {
    return (
      form.title.trim() !== '' &&
      roomIds.has(form.roomId) &&
      parseEffort(form.effort) !== null &&
      parseMinAge(form.minAge).valid
    );
  }

  function updateForm(patch: Partial<ChoreForm>) {
    setEditor((current) =>
      current && (current.kind === 'add-chore' || current.kind === 'edit-chore')
        ? { ...current, form: { ...current.form, ...patch } }
        : current,
    );
  }

  function renderChoreForm(current: Extract<Editor, { kind: 'add-chore' | 'edit-chore' }>) {
    const { form } = current;
    return (
      <View style={styles.form} testID="chore-form">
        <Field
          label="Chore title"
          testID="chore-form-title"
          value={form.title}
          onChangeText={(title) => updateForm({ title })}
          placeholder="Take out the trash"
        />
        <Text style={styles.label}>Room</Text>
        <View style={styles.chips}>
          {sortedRooms.map((room) => (
            <Chip
              key={room.roomId}
              testID={`chore-form-room-${room.roomId}`}
              selected={form.roomId === room.roomId}
              onPress={() => updateForm({ roomId: room.roomId })}
            >
              {room.name}
            </Chip>
          ))}
        </View>
        <Text style={styles.label}>Cadence</Text>
        <View style={styles.chips}>
          {CADENCES.map((cadence) => (
            <Chip
              key={cadence}
              testID={`chore-form-cadence-${cadence}`}
              selected={form.cadence === cadence}
              onPress={() => updateForm({ cadence })}
            >
              {cadence}
            </Chip>
          ))}
        </View>
        <Field
          label="Effort"
          testID="chore-form-effort"
          value={form.effort}
          onChangeText={(effort) => updateForm({ effort })}
          placeholder="1"
          keyboardType="numeric"
        />
        <Field
          label="Min age (blank for any age)"
          testID="chore-form-min-age"
          value={form.minAge}
          onChangeText={(minAge) => updateForm({ minAge })}
          keyboardType="numeric"
        />
        {current.kind === 'edit-chore' ? (
          <View style={styles.switchRow}>
            <Text style={styles.label}>Active</Text>
            <Switch
              testID="chore-form-active"
              value={form.active}
              onValueChange={(active) => updateForm({ active })}
            />
          </View>
        ) : null}
        <View style={styles.actions}>
          <ActionButton
            testID="chore-form-save"
            onPress={() => saveChore(current)}
            disabled={busy || !choreFormValid(form)}
          >
            Save
          </ActionButton>
          <ActionButton testID="chore-form-cancel" onPress={() => setEditor(null)} variant="secondary">
            Cancel
          </ActionButton>
        </View>
      </View>
    );
  }

  function renderChore(chore: ChoreResponse) {
    if (editor?.kind === 'edit-chore' && editor.choreId === chore.choreId) {
      return <View key={chore.choreId}>{renderChoreForm(editor)}</View>;
    }
    return (
      <View key={chore.choreId} style={styles.chore} testID={`chore-${chore.choreId}`}>
        <Text style={[styles.choreTitle, !chore.active && styles.inactive]} testID={`chore-title-${chore.choreId}`}>
          {chore.title}
        </Text>
        <Text style={styles.muted} testID={`chore-meta-${chore.choreId}`}>
          {choreMeta(chore)}
        </Text>
        <View style={styles.links}>
          <LinkButton
            testID={`edit-chore-${chore.choreId}`}
            onPress={() => {
              setNotice(null);
              setEditor({ kind: 'edit-chore', choreId: chore.choreId, form: formFor(chore) });
            }}
          >
            Edit
          </LinkButton>
          {chore.active ? (
            <LinkButton
              testID={`deactivate-chore-${chore.choreId}`}
              onPress={() => deactivateChore(chore)}
              disabled={busy}
            >
              Deactivate
            </LinkButton>
          ) : null}
        </View>
      </View>
    );
  }

  function renderRoom(room: RoomResponse) {
    const roomChores = chores.filter((chore) => chore.roomId === room.roomId);
    const renaming = editor?.kind === 'rename-room' && editor.roomId === room.roomId ? editor : null;
    const removing = editor?.kind === 'remove-room' && editor.roomId === room.roomId;
    const adding = editor?.kind === 'add-chore' && editor.anchorRoomId === room.roomId ? editor : null;

    return (
      <View key={room.roomId} style={styles.room} testID={`room-${room.roomId}`}>
        {renaming ? (
          <View>
            <Field
              label="Room name"
              testID={`rename-room-input-${room.roomId}`}
              value={renaming.name}
              onChangeText={(name) => setEditor({ ...renaming, name })}
            />
            <View style={styles.actions}>
              <ActionButton
                testID={`rename-room-save-${room.roomId}`}
                onPress={() => renameRoom(room, renaming.name)}
                disabled={busy || renaming.name.trim() === ''}
              >
                Save
              </ActionButton>
              <ActionButton
                testID={`rename-room-cancel-${room.roomId}`}
                onPress={() => setEditor(null)}
                variant="secondary"
              >
                Cancel
              </ActionButton>
            </View>
          </View>
        ) : (
          <Text style={styles.roomName} accessibilityRole="header" testID={`room-name-${room.roomId}`}>
            {room.name}
          </Text>
        )}

        {roomChores.length === 0 ? <Text style={styles.muted}>No chores yet.</Text> : null}
        {roomChores.map(renderChore)}

        {adding ? renderChoreForm(adding) : null}

        {removing ? (
          <View style={styles.confirm}>
            <Text style={styles.body}>Remove {room.name}?</Text>
            <View style={styles.actions}>
              <ActionButton
                testID={`remove-room-confirm-${room.roomId}`}
                onPress={() => removeRoom(room)}
                disabled={busy}
              >
                Remove
              </ActionButton>
              <ActionButton
                testID={`remove-room-cancel-${room.roomId}`}
                onPress={() => setEditor(null)}
                variant="secondary"
              >
                Cancel
              </ActionButton>
            </View>
          </View>
        ) : null}

        <View style={styles.links}>
          <LinkButton
            testID={`add-chore-${room.roomId}`}
            onPress={() => {
              setNotice(null);
              setEditor({
                kind: 'add-chore',
                anchorRoomId: room.roomId,
                form: { title: '', roomId: room.roomId, cadence: 'Weekly', effort: '1', minAge: '', active: true },
              });
            }}
          >
            Add chore
          </LinkButton>
          <LinkButton
            testID={`rename-room-${room.roomId}`}
            onPress={() => {
              setNotice(null);
              setEditor({ kind: 'rename-room', roomId: room.roomId, name: room.name });
            }}
          >
            Rename
          </LinkButton>
          <LinkButton testID={`remove-room-${room.roomId}`} onPress={() => requestRemoveRoom(room)}>
            Remove room
          </LinkButton>
        </View>
      </View>
    );
  }

  return (
    <Screen testID="household-editor">
      <Text style={styles.eyebrow}>HOUSEHOLD</Text>
      <Text style={styles.title} accessibilityRole="header">
        Rooms and chores
      </Text>

      {stale ? (
        <View style={styles.stale} testID="household-stale">
          <Text style={styles.body}>{COPY.stale}</Text>
          <ActionButton testID="household-reload" onPress={reload} disabled={busy}>
            Reload
          </ActionButton>
        </View>
      ) : null}

      {notice !== null ? (
        <Text style={styles.error} testID="household-notice">
          {notice}
        </Text>
      ) : null}

      {sortedRooms.length === 0 ? <Text style={styles.muted}>No rooms yet. Add one below.</Text> : null}
      {sortedRooms.map(renderRoom)}

      {unroomed.length > 0 ? (
        <View style={styles.room} testID="household-unroomed">
          <Text style={styles.roomName} accessibilityRole="header">
            Not in a room
          </Text>
          {unroomed.map(renderChore)}
        </View>
      ) : null}

      <View style={styles.newRoom}>
        <Field
          label="New room"
          testID="new-room-name"
          value={newRoomName}
          onChangeText={setNewRoomName}
          placeholder="Kitchen"
        />
        <ActionButton
          testID="new-room-save"
          onPress={addRoom}
          disabled={busy || newRoomName.trim() === ''}
        >
          Add room
        </ActionButton>
      </View>
    </Screen>
  );
}

/** A compact text button for the per-room and per-chore actions. */
function LinkButton({
  testID,
  onPress,
  disabled,
  children,
}: {
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.linkDisabled : undefined}
    >
      <Text style={styles.link}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', marginTop: 8, marginBottom: 16 },
  body: { color: colors.ink, fontSize: 15, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, marginBottom: 16 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  centeredRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stale: {
    borderWidth: 1,
    borderColor: colors.brass,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  room: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
    marginBottom: 16,
  },
  roomName: { color: colors.ink, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  chore: { marginBottom: 10 },
  choreTitle: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  inactive: { color: colors.muted, textDecorationLine: 'line-through' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 6 },
  link: { color: colors.brass, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
  linkDisabled: { opacity: 0.5 },
  form: {
    backgroundColor: colors.page,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  actions: { gap: 8 },
  confirm: { marginTop: 8 },
  newRoom: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
});
