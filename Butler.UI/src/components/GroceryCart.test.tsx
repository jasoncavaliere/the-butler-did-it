import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { GroceryCart, readSuggestions } from './GroceryCart';
import type { ApiClient, ApiResult } from '../api/client';
import type { CartItemView, CartResponse, StoreProductView } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { useOrganizer } from '../state/OrganizerContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
jest.mock('../state/OrganizerContext', () => ({ useOrganizer: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;
const useOrganizerMock = useOrganizer as jest.MockedFunction<typeof useOrganizer>;

const HOUSEHOLD = 'hh-1';
const WEEK = '2026-W29';
const CART_ETAG = 'W/"cart-1"';
const CART_PATH = `/households/${HOUSEHOLD}/carts/current`;
const CAPTURE_PATH = `/households/${HOUSEHOLD}/capture/text`;
const CONFIRM_PATH = `/households/${HOUSEHOLD}/carts/${WEEK}/confirm`;

const oatMilk: CartItemView = {
  itemId: 'item-1',
  productId: 'heb-0016',
  displayName: 'H-E-B Oat Milk',
  quantity: 1,
  addedByPersonId: 'p1',
  sourceConnector: 'simulated-heb',
};

const eggs: CartItemView = {
  itemId: 'item-2',
  productId: 'heb-0003',
  displayName: 'H-E-B Grade A Large Eggs',
  quantity: 2,
  addedByPersonId: 'p2',
  sourceConnector: 'simulated-heb',
};

/** The week's building cart, optionally already holding some lines. */
function building(items: CartItemView[] = []): CartResponse {
  return {
    weekIso: WEEK,
    status: 'Building',
    confirmedByPersonId: null,
    confirmedUtc: null,
    eTag: CART_ETAG,
    items,
  };
}

/** The same cart after a successful G4 confirm. */
function confirmed(items: CartItemView[] = [oatMilk]): CartResponse {
  return {
    weekIso: WEEK,
    status: 'Confirmed',
    confirmedByPersonId: 'p-organizer',
    confirmedUtc: '2026-07-20T18:00:00Z',
    eTag: 'W/"cart-2"',
    items,
  };
}

const suggestionMilk: StoreProductView = {
  productId: 'heb-0001',
  displayName: 'H-E-B Whole Milk',
  size: '1',
  unit: 'gal',
  indicativePrice: '$3.29',
  sourceConnector: 'simulated-heb',
};

const suggestionOat: StoreProductView = {
  productId: 'heb-0016',
  displayName: 'H-E-B Oat Milk',
  size: '64',
  unit: 'oz',
  indicativePrice: '$4.19',
  sourceConnector: 'simulated-heb',
};

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, etag: null });

const unreachable: ApiResult<never> = {
  ok: false,
  error: { kind: 'network', status: 0, title: 'The API is unreachable.' },
};

/** The G2 answer for a week whose cart has already been confirmed. */
const alreadyConfirmed: ApiResult<never> = {
  ok: false,
  error: {
    kind: 'problem',
    status: 409,
    title: "The week's cart is already confirmed.",
    detail: `The cart for week '${WEEK}' has already been confirmed.`,
    problem: { status: 409, title: "The week's cart is already confirmed." },
  },
};

/** The G3 answer when a term matched several products. */
const ambiguous: ApiResult<never> = {
  ok: false,
  error: {
    kind: 'problem',
    status: 400,
    title: 'The utterance matched more than one product.',
    detail: "'milk' matched 2 products. Pick one of the suggestions.",
    problem: {
      status: 400,
      title: 'The utterance matched more than one product.',
      captureSource: 'hub-text',
      resolvedTerm: 'milk',
      suggestions: [suggestionMilk, suggestionOat],
    },
  },
};

/** The G3 answer when nothing in the catalog matched. */
const noMatch: ApiResult<never> = {
  ok: false,
  error: {
    kind: 'problem',
    status: 404,
    title: 'No product matched.',
    detail: "The store has no product matching 'quinoa flakes'.",
    problem: {
      status: 404,
      title: 'No product matched.',
      captureSource: 'hub-text',
      resolvedTerm: 'quinoa flakes',
      suggestions: [],
    },
  },
};

const captureAdded = ok({
  captureSource: 'hub-text',
  resolvedTerm: 'oat milk',
  weekIso: WEEK,
  item: oatMilk,
});

type ClientOpts = {
  /** Successive answers to the cart read; the last one repeats. */
  reads?: ApiResult<unknown>[];
  capture?: ApiResult<unknown>;
  confirm?: ApiResult<unknown>;
  /** Replaces the cart read entirely (used to hold a read pending). */
  getImpl?: (path: string) => Promise<ApiResult<unknown>>;
  /** Replaces the capture/confirm write entirely (used to hold a write pending). */
  updateImpl?: (path: string) => Promise<ApiResult<unknown>>;
};

/**
 * A client answering the three calls the region makes: the G2 current-cart read,
 * the G3 capture write, and the G4 confirm write. `reads` is a queue so a test
 * can show the cart before and after an add.
 */
function cartClient(opts: ClientOpts = {}): ApiClient {
  const reads = [...(opts.reads ?? [ok(building())])];
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (opts.getImpl) {
        return opts.getImpl(path);
      }
      return reads.length > 1 ? reads.shift()! : reads[0];
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (opts.updateImpl) {
        return opts.updateImpl(path);
      }
      if (path.endsWith('/capture/text')) {
        return opts.capture ?? captureAdded;
      }
      return opts.confirm ?? ok(confirmed());
    }) as unknown as ApiClient['update'],
  };
}

function setOrganizer(isSignedIn: boolean) {
  useOrganizerMock.mockReturnValue({
    organizer: isSignedIn ? { subject: 'oid-1', name: 'Robin Organizer' } : null,
    token: isSignedIn ? 'bearer-abc' : null,
    isSignedIn,
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  });
}

async function renderCart(
  client: ApiClient,
  { organizer = false, activePersonId = 'p1' }: { organizer?: boolean; activePersonId?: string | null } = {},
) {
  useApiClientMock.mockReturnValue(client);
  setOrganizer(organizer);
  return render(<GroceryCart householdId={HOUSEHOLD} activePersonId={activePersonId} />);
}

/** Wait until the initial cart read has settled into a rendered list. */
async function whenLoaded() {
  await waitFor(() => expect(screen.getByTestId('grocery-cart-list')).toBeOnTheScreen());
}

async function type(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('grocery-add-input'), text);
  });
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** A promise a test resolves by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  useApiClientMock.mockReset();
  useOrganizerMock.mockReset();
});

describe('GroceryCart', () => {
  it('add-item-renders: a typed term resolves through G3 and appears in the cart', async () => {
    const client = cartClient({ reads: [ok(building()), ok(building([oatMilk]))] });
    await renderCart(client);
    await whenLoaded();

    // Nothing in the list yet, and the read went to the current-cart route.
    expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
    expect(client.get).toHaveBeenCalledWith(CART_PATH);

    await type('oat milk');
    await press('grocery-add-submit');

    // The capture carried the term, the acting participant, the cart's week, and
    // a quantity of one.
    expect(client.update).toHaveBeenCalledWith(
      CAPTURE_PATH,
      { utterance: 'oat milk', personId: 'p1', weekIso: WEEK, quantity: 1 },
      { method: 'POST' },
    );

    // The resolved item is in the cart, with its name and quantity (AC2).
    await waitFor(() => expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-item-item-1')).toHaveTextContent(/H-E-B Oat Milk/);
    expect(screen.getByTestId('grocery-item-quantity-item-1')).toHaveTextContent('x1');
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent('Added H-E-B Oat Milk.');
    // The field is cleared, ready for the next thing.
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', '');
  });

  it('confirm-hidden-without-organizer: no organizer means no Confirm action at all', async () => {
    // A participant has claimed a name and the cart has something in it - the
    // only thing missing is an organizer.
    await renderCart(cartClient({ reads: [ok(building([oatMilk]))] }), {
      organizer: false,
      activePersonId: 'p1',
    });
    await whenLoaded();

    expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('grocery-confirm')).toBeNull();
    // Adding stays open to everyone; only confirming is gated.
    expect(screen.getByTestId('grocery-add-submit')).toBeOnTheScreen();
  });

  it('confirm-hidden-without-organizer: an unauthenticated hub session sees no Confirm either', async () => {
    await renderCart(cartClient({ reads: [ok(building([oatMilk]))] }), {
      organizer: false,
      activePersonId: null,
    });
    await whenLoaded();

    expect(screen.queryByTestId('grocery-confirm')).toBeNull();
  });

  it('confirm-flow: an organizer confirms and the cart reads as Confirmed', async () => {
    const client = cartClient({ reads: [ok(building([oatMilk]))] });
    await renderCart(client, { organizer: true });
    await whenLoaded();

    expect(screen.getByTestId('grocery-confirm')).toBeOnTheScreen();
    expect(screen.queryByTestId('grocery-cart-status')).toBeNull();

    await press('grocery-confirm');

    // The confirm went to G4 under the cart's own ETag (Contract 7.3).
    expect(client.update).toHaveBeenCalledWith(CONFIRM_PATH, {}, { method: 'POST', ifMatch: CART_ETAG });

    // The cart now reads as Confirmed, and neither adding nor confirming again
    // is offered.
    await waitFor(() => expect(screen.getByTestId('grocery-cart-status')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-cart-status')).toHaveTextContent(/Confirmed/);
    expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('grocery-confirm')).toBeNull();
    expect(screen.queryByTestId('grocery-add-input')).toBeNull();
  });

  it('ambiguous-add: several matches surface the G3 suggestions and a next step', async () => {
    await renderCart(cartClient({ capture: ambiguous }));
    await whenLoaded();

    await type('milk');
    await press('grocery-add-submit');

    await waitFor(() => expect(screen.getByTestId('grocery-suggestions')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-suggestion-heb-0001')).toHaveTextContent(
      'H-E-B Whole Milk (1 gal)',
    );
    expect(screen.getByTestId('grocery-suggestion-heb-0016')).toHaveTextContent(
      'H-E-B Oat Milk (64 oz)',
    );
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(/Did you mean one of these\?/);
    // The term stays put so it can be refined rather than retyped.
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', 'milk');
  });

  it('no-match-add: nothing matched says so plainly, with no suggestions', async () => {
    await renderCart(cartClient({ capture: noMatch }));
    await whenLoaded();

    await type('quinoa flakes');
    // Submitting from the keyboard is the same gesture as tapping Add.
    await act(async () => {
      fireEvent(screen.getByTestId('grocery-add-input'), 'submitEditing');
    });

    await waitFor(() =>
      expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
        "The store has no product matching 'quinoa flakes'.",
      ),
    );
    expect(screen.queryByTestId('grocery-suggestions')).toBeNull();
  });

  it('failed-add: an unreachable API surfaces a readable line, never silence', async () => {
    await renderCart(cartClient({ capture: unreachable }));
    await whenLoaded();

    await type('oat milk');
    await press('grocery-add-submit');

    await waitFor(() =>
      expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(/unreachable/),
    );
    expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
  });

  it('empty-term: submitting nothing asks for a term and calls no endpoint', async () => {
    const client = cartClient();
    await renderCart(client);
    await whenLoaded();

    await type('   ');
    await press('grocery-add-submit');

    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'Type what to add, for example "oat milk".',
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('no-active-participant: adding asks for a name first rather than spending a 400', async () => {
    const client = cartClient();
    await renderCart(client, { activePersonId: null });
    await whenLoaded();

    await type('oat milk');
    await press('grocery-add-submit');

    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'Tap your name first, then add to the list.',
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('already-confirmed-week: a 409 on load is a calm confirmed state, not an error', async () => {
    await renderCart(cartClient({ reads: [alreadyConfirmed] }), { organizer: true });

    await waitFor(() => expect(screen.getByTestId('grocery-cart-status')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-cart-week-confirmed')).toBeOnTheScreen();
    expect(screen.queryByTestId('grocery-cart-error')).toBeNull();
    // Nothing to add to and nothing to confirm, even for an organizer.
    expect(screen.queryByTestId('grocery-add-input')).toBeNull();
    expect(screen.queryByTestId('grocery-confirm')).toBeNull();
    expect(screen.queryByTestId('grocery-cart-list')).toBeNull();
  });

  it('unreachable-load: the region shows one readable line instead of a blank card', async () => {
    await renderCart(cartClient({ reads: [unreachable] }));

    await waitFor(() => expect(screen.getByTestId('grocery-cart-error')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-cart-error')).toHaveTextContent(/unreachable/);
    expect(screen.queryByTestId('grocery-cart-list')).toBeNull();
  });

  it('failed-confirm: the cart stays Building and says what to do next', async () => {
    const stale: ApiResult<never> = {
      ok: false,
      error: {
        kind: 'problem',
        status: 412,
        title: 'The resource was modified by another request.',
        detail: 'The cart changed since it was read. Review it and confirm again.',
        problem: { status: 412 },
      },
    };
    await renderCart(cartClient({ reads: [ok(building([oatMilk]))], confirm: stale }), {
      organizer: true,
    });
    await whenLoaded();

    await press('grocery-confirm');

    await waitFor(() =>
      expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
        /The cart changed since it was read\./,
      ),
    );
    expect(screen.queryByTestId('grocery-cart-status')).toBeNull();
    expect(screen.getByTestId('grocery-confirm')).toBeOnTheScreen();
  });

  it('renders every line with its display name and quantity', async () => {
    await renderCart(cartClient({ reads: [ok(building([oatMilk, eggs]))] }));
    await whenLoaded();

    expect(screen.getByTestId('grocery-item-item-1')).toHaveTextContent(/H-E-B Oat Milk/);
    expect(screen.getByTestId('grocery-item-quantity-item-1')).toHaveTextContent('x1');
    expect(screen.getByTestId('grocery-item-item-2')).toHaveTextContent(/H-E-B Grade A Large Eggs/);
    expect(screen.getByTestId('grocery-item-quantity-item-2')).toHaveTextContent('x2');
  });

  it('in-flight add: the controls are disabled until the capture settles', async () => {
    const pending = deferred<ApiResult<unknown>>();
    await renderCart(cartClient({ updateImpl: () => pending.promise }));
    await whenLoaded();

    await type('oat milk');
    // Fire without awaiting the settle: the write is still in flight.
    await act(async () => {
      fireEvent.press(screen.getByTestId('grocery-add-submit'));
    });

    expect(screen.getByTestId('grocery-add-submit')).toBeDisabled();
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('editable', false);

    await act(async () => {
      pending.resolve(captureAdded);
      await pending.promise;
    });

    await waitFor(() => expect(screen.getByTestId('grocery-add-submit')).not.toBeDisabled());
  });

  it('in-flight confirm: the sensitive action cannot be double-tapped', async () => {
    const pending = deferred<ApiResult<unknown>>();
    const client = cartClient({
      reads: [ok(building([oatMilk]))],
      updateImpl: () => pending.promise,
    });
    await renderCart(client, { organizer: true });
    await whenLoaded();

    // Fire without awaiting the settle: the confirm is still in flight.
    await act(async () => {
      fireEvent.press(screen.getByTestId('grocery-confirm'));
    });

    expect(screen.getByTestId('grocery-confirm')).toBeDisabled();
    // A second tap while the first is in flight sends nothing more.
    await press('grocery-confirm');
    expect(client.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(ok(confirmed()));
      await pending.promise;
    });

    await waitFor(() => expect(screen.getByTestId('grocery-cart-status')).toBeOnTheScreen());
  });

  it('unmounting before the read settles leaves no state behind', async () => {
    const pending = deferred<ApiResult<unknown>>();
    const view = await renderCart(cartClient({ getImpl: () => pending.promise }));

    expect(screen.getByTestId('grocery-cart-loading')).toBeOnTheScreen();

    await view.unmount();
    await act(async () => {
      pending.resolve(ok(building([oatMilk])));
      await pending.promise;
    });

    expect(screen.queryByTestId('grocery-cart')).toBeNull();
  });
});

describe('readSuggestions', () => {
  it('returns the problem-details candidates when the API supplied any', () => {
    expect(readSuggestions(ambiguous.error)).toEqual([suggestionMilk, suggestionOat]);
  });

  it('returns none for a failure carrying no problem document', () => {
    expect(readSuggestions(unreachable.error)).toEqual([]);
  });

  it('returns none when the problem document has no suggestions member', () => {
    expect(
      readSuggestions({ kind: 'problem', status: 400, title: 'Bad', problem: { status: 400 } }),
    ).toEqual([]);
  });
});
