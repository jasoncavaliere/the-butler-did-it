import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeApiError, isPreconditionFailed } from '../api/errors';
import type {
  CreatePersonRequest,
  PersonResponse,
  RosterEntryResponse,
  UpdatePersonRequest,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { ActionButton } from '../components/FormControls';
import { PersonFields, type PersonDraft } from '../components/PersonFields';
import { Screen, colors } from '../components/Screen';
import { useHousehold } from '../state/HouseholdContext';

const COPY = {
  noHousehold: 'No household is selected.',
  stale: 'Someone else changed this person since it was loaded. Reload to see the latest.',
} as const;

/** The role a person added here gets; an edit keeps the role from its read. */
const ADDED_ROLE = 'Participant';

const EMPTY_DRAFT: PersonDraft = { displayName: '', isChild: false, claimColor: null };

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; people: RosterEntryResponse[] };

/**
 * The one editor open at a time. An edit first reads the person
 * (`edit-loading`), because the roster list carries neither the role nor the
 * concurrency ETag; the `edit` form then holds that read (`person`) so Save
 * sends its role unchanged under its `eTag`.
 */
type Editor =
  | { kind: 'add'; draft: PersonDraft }
  | { kind: 'edit-loading'; personId: string }
  | { kind: 'edit'; personId: string; person: PersonResponse; draft: PersonDraft; stale: boolean }
  | { kind: 'remove'; personId: string };

/** The roster-list projection of a person response. */
function toEntry(person: PersonResponse): RosterEntryResponse {
  return {
    personId: person.personId,
    displayName: person.displayName,
    claimColor: person.claimColor,
    isChild: person.isChild,
  };
}

function draftFor(person: PersonResponse): PersonDraft {
  return { displayName: person.displayName, isChild: person.isChild, claimColor: person.claimColor };
}

/**
 * The organizer's Roster editor (#167): the household's people, and the edits an
 * organizer makes after setup. It follows the {@link HouseholdEditor} pattern.
 * The list comes from the roster read (`GET .../people`), which carries no role
 * and no ETag, so opening a person reads `GET .../people/{personId}` and the
 * form saves a `PUT` under `If-Match` with that read's `eTag` and its role
 * unchanged (there is no role control). A stale ETag (`412`) shows a reload
 * prompt that re-reads that person rather than re-sending the edit; any other
 * failure shows the problem-details message and leaves the list as it was.
 *
 * Add person uses the onboarding people-step fields ({@link PersonFields}) and
 * always adds a Participant. Remove asks for a confirmation that names the
 * person, then sends a `DELETE`; their chores this week stay on the board as
 * Unassigned.
 */
export function RosterEditor({ onDone }: { onDone?: () => void }) {
  const client = useApiClient();
  const { householdId } = useHousehold();

  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);

  // The open editor as of the last commit, so an async person read can tell
  // whether the editor it was started for is still open.
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const read = useCallback(async (): Promise<LoadState> => {
    if (householdId === null) {
      return { phase: 'error', message: COPY.noHousehold };
    }
    const people = await client.get<RosterEntryResponse[]>(`/households/${householdId}/people`);
    if (!people.ok) {
      return { phase: 'error', message: describeApiError(people.error) };
    }
    return { phase: 'ready', people: people.data };
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

  async function retryLoad() {
    setBusy(true);
    setLoad(await read());
    setBusy(false);
  }

  if (load.phase === 'loading') {
    return (
      <Screen testID="roster-editor">
        <View style={styles.centeredRow} testID="roster-loading">
          <ActivityIndicator color={colors.brass} />
          <Text style={styles.muted}>Loading your household...</Text>
        </View>
      </Screen>
    );
  }

  if (load.phase === 'error') {
    return (
      <Screen testID="roster-editor">
        <Text style={styles.error} testID="roster-load-error">
          {load.message}
        </Text>
        {householdId !== null ? (
          <ActionButton testID="roster-retry" onPress={retryLoad} disabled={busy} variant="secondary">
            Try again
          </ActionButton>
        ) : null}
        {onDone ? <DoneButton onDone={onDone} /> : null}
      </Screen>
    );
  }

  const { people } = load;
  const base = `/households/${householdId}/people`;

  /** True while the edit editor for `personId` is still the one open. */
  function editingStill(personId: string): boolean {
    const current = editorRef.current;
    return (
      current !== null &&
      (current.kind === 'edit-loading' || current.kind === 'edit') &&
      current.personId === personId
    );
  }

  /** Begin a write: clear the last message and hold every write button. */
  function begin() {
    setNotice(null);
    setBusy(true);
  }

  async function openEdit(personId: string) {
    setNotice(null);
    const opening: Editor = { kind: 'edit-loading', personId };
    editorRef.current = opening;
    setEditor(opening);
    const result = await client.get<PersonResponse>(`${base}/${personId}`);
    if (!editingStill(personId)) {
      return;
    }
    if (!result.ok) {
      setNotice(describeApiError(result.error));
      setEditor(null);
      return;
    }
    setEditor({ kind: 'edit', personId, person: result.data, draft: draftFor(result.data), stale: false });
  }

  /** After a 412: re-read the person and its ETag; never re-sends the refused edit. */
  async function reloadPerson(personId: string) {
    begin();
    const result = await client.get<PersonResponse>(`${base}/${personId}`);
    setBusy(false);
    if (!editingStill(personId)) {
      return;
    }
    if (!result.ok) {
      setNotice(describeApiError(result.error));
      setEditor(null);
      setLoad(await read());
      return;
    }
    const fresh = result.data;
    setLoad({
      phase: 'ready',
      people: people.map((p) => (p.personId === personId ? toEntry(fresh) : p)),
    });
    setEditor({ kind: 'edit', personId, person: fresh, draft: draftFor(fresh), stale: false });
  }

  async function saveEdit(current: Extract<Editor, { kind: 'edit' }>) {
    const { person, draft } = current;
    begin();
    const body: UpdatePersonRequest = {
      displayName: draft.displayName.trim(),
      role: person.role,
      isChild: draft.isChild,
      claimColor: draft.claimColor,
    };
    const result = await client.update<PersonResponse>(`${base}/${person.personId}`, body, {
      method: 'PUT',
      ifMatch: person.eTag,
    });
    setBusy(false);
    if (!result.ok) {
      if (isPreconditionFailed(result.error)) {
        setEditor({ ...current, stale: true });
        return;
      }
      setNotice(describeApiError(result.error));
      return;
    }
    const saved = result.data;
    setLoad({
      phase: 'ready',
      people: people.map((p) => (p.personId === saved.personId ? toEntry(saved) : p)),
    });
    setEditor(null);
  }

  async function saveAdd(draft: PersonDraft) {
    begin();
    const body: CreatePersonRequest = {
      displayName: draft.displayName.trim(),
      role: ADDED_ROLE,
      isChild: draft.isChild,
      claimColor: draft.claimColor,
    };
    const result = await client.update<PersonResponse>(base, body, { method: 'POST' });
    setBusy(false);
    if (!result.ok) {
      setNotice(describeApiError(result.error));
      return;
    }
    setLoad({ phase: 'ready', people: [...people, toEntry(result.data)] });
    setEditor(null);
  }

  async function remove(person: RosterEntryResponse) {
    begin();
    const result = await client.update<void>(`${base}/${person.personId}`, undefined, {
      method: 'DELETE',
    });
    setBusy(false);
    setEditor(null);
    if (!result.ok) {
      setNotice(describeApiError(result.error));
      return;
    }
    setLoad({ phase: 'ready', people: people.filter((p) => p.personId !== person.personId) });
  }

  function updateDraft(draft: PersonDraft) {
    setEditor((current) =>
      current && (current.kind === 'add' || current.kind === 'edit') ? { ...current, draft } : current,
    );
  }

  function renderForm(current: Extract<Editor, { kind: 'add' | 'edit' }>) {
    const onSave = current.kind === 'add' ? () => saveAdd(current.draft) : () => saveEdit(current);
    return (
      <View style={styles.form} testID="roster-form">
        <PersonFields value={current.draft} onChange={updateDraft} />
        <View style={styles.actions}>
          <ActionButton
            testID="roster-form-save"
            onPress={onSave}
            disabled={busy || current.draft.displayName.trim() === ''}
          >
            {current.kind === 'add' ? 'Add person' : 'Save'}
          </ActionButton>
          <ActionButton testID="roster-form-cancel" onPress={() => setEditor(null)} variant="secondary">
            Cancel
          </ActionButton>
        </View>
      </View>
    );
  }

  function renderPerson(person: RosterEntryResponse) {
    const id = person.personId;
    const mine = editor !== null && editor.kind !== 'add' && editor.personId === id ? editor : null;

    if (mine?.kind === 'edit') {
      return <View key={id}>{renderForm(mine)}</View>;
    }

    return (
      <View key={id} style={styles.person} testID={`roster-person-${id}`}>
        <View style={styles.personRow}>
          <View
            testID={`roster-color-${id}`}
            accessibilityLabel={person.claimColor ?? 'No colour'}
            style={[
              styles.dot,
              person.claimColor !== null ? { backgroundColor: person.claimColor } : styles.dotEmpty,
            ]}
          />
          <View style={styles.personText}>
            <Text style={styles.personName} testID={`roster-name-${id}`}>
              {person.displayName}
            </Text>
            <Text style={styles.muted} testID={`roster-child-${id}`}>
              {person.isChild ? 'Child' : 'Adult'}
            </Text>
          </View>
        </View>

        {mine?.kind === 'edit-loading' ? (
          <View style={styles.centeredRow} testID="roster-edit-loading">
            <ActivityIndicator color={colors.brass} />
            <Text style={styles.muted}>Loading {person.displayName}...</Text>
          </View>
        ) : null}

        {mine?.kind === 'remove' ? (
          <View style={styles.confirm}>
            <Text style={styles.body} testID={`roster-remove-confirmation-${id}`}>
              Remove {person.displayName}? Their chores this week will show as Unassigned.
            </Text>
            <View style={styles.actions}>
              <ActionButton
                testID={`roster-remove-confirm-${id}`}
                onPress={() => remove(person)}
                disabled={busy}
              >
                Remove
              </ActionButton>
              <ActionButton
                testID={`roster-remove-cancel-${id}`}
                onPress={() => setEditor(null)}
                variant="secondary"
              >
                Cancel
              </ActionButton>
            </View>
          </View>
        ) : null}

        <View style={styles.links}>
          <LinkButton testID={`roster-edit-${id}`} onPress={() => openEdit(id)}>
            Edit
          </LinkButton>
          <LinkButton
            testID={`roster-remove-${id}`}
            onPress={() => {
              setNotice(null);
              setEditor({ kind: 'remove', personId: id });
            }}
          >
            Remove
          </LinkButton>
        </View>
      </View>
    );
  }

  const staleEditor = editor?.kind === 'edit' && editor.stale ? editor : null;

  return (
    <Screen testID="roster-editor">
      <Text style={styles.eyebrow}>ROSTER</Text>
      <Text style={styles.title} accessibilityRole="header">
        People
      </Text>

      {staleEditor ? (
        <View style={styles.stale} testID="roster-stale">
          <Text style={styles.body}>{COPY.stale}</Text>
          <ActionButton
            testID="roster-reload"
            onPress={() => reloadPerson(staleEditor.personId)}
            disabled={busy}
          >
            Reload
          </ActionButton>
        </View>
      ) : null}

      {notice !== null ? (
        <Text style={styles.error} testID="roster-notice">
          {notice}
        </Text>
      ) : null}

      {people.length === 0 ? (
        <Text style={styles.muted} testID="roster-empty">
          No people yet. Add one below.
        </Text>
      ) : null}
      {people.map(renderPerson)}

      <View style={styles.add}>
        {editor?.kind === 'add' ? (
          renderForm(editor)
        ) : (
          <ActionButton
            testID="roster-add-person"
            onPress={() => {
              setNotice(null);
              setEditor({ kind: 'add', draft: EMPTY_DRAFT });
            }}
          >
            Add person
          </ActionButton>
        )}
      </View>

      {onDone ? <DoneButton onDone={onDone} /> : null}
    </Screen>
  );
}

function DoneButton({ onDone }: { onDone: () => void }) {
  return (
    <ActionButton testID="roster-done" onPress={onDone} variant="secondary">
      Done
    </ActionButton>
  );
}

/** A compact text button for the per-person actions. */
function LinkButton({
  testID,
  onPress,
  children,
}: {
  testID: string;
  onPress: () => void;
  children: string;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress}>
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
  centeredRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  stale: {
    borderWidth: 1,
    borderColor: colors.brass,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  person: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginBottom: 12,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personText: { flex: 1 },
  personName: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  dot: { width: 20, height: 20, borderRadius: 10 },
  dotEmpty: { borderWidth: 2, borderColor: colors.border },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 6 },
  link: { color: colors.brass, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
  form: {
    backgroundColor: colors.page,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  actions: { gap: 8 },
  confirm: { marginTop: 8 },
  add: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
});
