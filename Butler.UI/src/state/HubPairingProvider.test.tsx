import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import type { IAuthProvider, OrganizerSession } from '../auth/authProvider';
import type { LocalStorageLike } from '../offline/storage';
import { useHousehold } from './HouseholdContext';
import { useHubDevice } from './HubDeviceContext';
import { HubPairingProvider } from './HubPairingProvider';
import { HUB_PAIRING_KEY } from './hubPairingStorage';
import { OrganizerProvider, useOrganizer } from './OrganizerContext';

/** An in-memory stand-in for Web Storage, with the raw map exposed to assert on. */
function fakeStorage(seed: Record<string, string> = {}): LocalStorageLike & {
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function setGlobalStorage(storage: LocalStorageLike | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function stored(storage: { entries: Map<string, string> }): unknown {
  const raw = storage.entries.get(HUB_PAIRING_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

const PAIRED = JSON.stringify({ householdId: 'hh-1', deviceToken: 'dev-1' });

function Probe() {
  const { householdId, setHouseholdId } = useHousehold();
  const { deviceToken, setDeviceToken, rejectDevice } = useHubDevice();
  return (
    <>
      <Text testID="household">hh:{householdId ?? 'none'}</Text>
      <Text testID="token">tok:{deviceToken ?? 'none'}</Text>
      <Pressable
        testID="pair"
        onPress={() => {
          setHouseholdId('hh-9');
          setDeviceToken('dev-9');
        }}
      >
        <Text>pair</Text>
      </Pressable>
      <Pressable testID="forget-household" onPress={() => setHouseholdId(null)}>
        <Text>forget</Text>
      </Pressable>
      <Pressable testID="reject" onPress={() => rejectDevice()}>
        <Text>reject</Text>
      </Pressable>
    </>
  );
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(() => {
  setGlobalStorage(undefined);
});

afterEach(() => {
  setGlobalStorage(undefined);
});

describe('HubPairingProvider (#188)', () => {
  it('seeds the device token and household id from the stored pairing', async () => {
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: PAIRED });
    setGlobalStorage(storage);

    await render(
      <HubPairingProvider>
        <Probe />
      </HubPairingProvider>,
    );

    expect(screen.getByTestId('household')).toHaveTextContent('hh:hh-1');
    expect(screen.getByTestId('token')).toHaveTextContent('tok:dev-1');
    // The restored pairing is kept, not cleared, on mount.
    expect(stored(storage)).toEqual({ householdId: 'hh-1', deviceToken: 'dev-1' });
  });

  it('starts unpaired with nothing stored, and writes the pairing once both halves are set', async () => {
    const storage = fakeStorage();
    setGlobalStorage(storage);

    await render(
      <HubPairingProvider>
        <Probe />
      </HubPairingProvider>,
    );

    expect(screen.getByTestId('household')).toHaveTextContent('hh:none');
    expect(screen.getByTestId('token')).toHaveTextContent('tok:none');
    expect(stored(storage)).toBeUndefined();

    await press('pair');

    expect(stored(storage)).toEqual({ householdId: 'hh-9', deviceToken: 'dev-9' });
  });

  it('clears the stored pairing when the household is dropped (teardown)', async () => {
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: PAIRED });
    setGlobalStorage(storage);

    await render(
      <HubPairingProvider>
        <Probe />
      </HubPairingProvider>,
    );
    await press('forget-household');

    expect(screen.getByTestId('household')).toHaveTextContent('hh:none');
    expect(stored(storage)).toBeUndefined();
  });

  it('rejectDevice clears the stored pairing and the household id', async () => {
    const storage = fakeStorage({ [HUB_PAIRING_KEY]: PAIRED });
    setGlobalStorage(storage);

    await render(
      <HubPairingProvider>
        <Probe />
      </HubPairingProvider>,
    );
    await press('reject');

    expect(screen.getByTestId('household')).toHaveTextContent('hh:none');
    expect(screen.getByTestId('token')).toHaveTextContent('tok:none');
    expect(stored(storage)).toBeUndefined();
  });

  it('with storage throwing, pairing works in memory and nothing crashes', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: access to localStorage is denied');
      },
      configurable: true,
    });

    await render(
      <HubPairingProvider>
        <Probe />
      </HubPairingProvider>,
    );
    expect(screen.getByTestId('household')).toHaveTextContent('hh:none');

    await press('pair');
    expect(screen.getByTestId('household')).toHaveTextContent('hh:hh-9');
    expect(screen.getByTestId('token')).toHaveTextContent('tok:dev-9');

    await press('reject');
    expect(screen.getByTestId('household')).toHaveTextContent('hh:none');
  });

  it('never stores the organizer token', async () => {
    const storage = fakeStorage();
    setGlobalStorage(storage);
    const session: OrganizerSession = {
      organizer: { subject: 'oid-1', name: 'Robin' },
      token: 'organizer-bearer-secret',
    };
    const provider: IAuthProvider = {
      kind: 'fake',
      signIn: () => Promise.resolve(session),
      signOut: () => Promise.resolve(),
    };
    function SignIn() {
      const { signIn } = useOrganizer();
      return (
        <Pressable testID="sign-in" onPress={() => void signIn()}>
          <Text>sign in</Text>
        </Pressable>
      );
    }

    await render(
      <OrganizerProvider authProvider={provider}>
        <HubPairingProvider>
          <SignIn />
          <Probe />
        </HubPairingProvider>
      </OrganizerProvider>,
    );
    await press('sign-in');
    await press('pair');

    expect(Object.keys(stored(storage) as object).sort()).toEqual(['deviceToken', 'householdId']);
    for (const value of storage.entries.values()) {
      expect(value).not.toContain('organizer-bearer-secret');
    }
  });
});
