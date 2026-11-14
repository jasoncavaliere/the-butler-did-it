import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  GroceryCart,
  customOfferLabel,
  estimatedTotalLabel,
  heardLabel,
  readSuggestions,
  unpricedNote,
} from './GroceryCart';
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
const VOICE_PATH = `/households/${HOUSEHOLD}/capture/voice`;
const CONFIRM_PATH = `/households/${HOUSEHOLD}/carts/${WEEK}/confirm`;
const ITEMS_PATH = `/households/${HOUSEHOLD}/carts/${WEEK}/items`;

const oatMilk: CartItemView = {
  itemId: 'item-1',
  productId: 'heb-0016',
  displayName: 'H-E-B Oat Milk',
  quantity: 1,
  addedByPersonId: 'p1',
  sourceConnector: 'simulated-heb',
  indicativePrice: '$3.79',
  isCustom: false,
};

const eggs: CartItemView = {
  itemId: 'item-2',
  productId: 'heb-0003',
  displayName: 'H-E-B Grade A Large Eggs',
  quantity: 2,
  addedByPersonId: 'p2',
  sourceConnector: 'simulated-heb',
  indicativePrice: '$2.99',
  isCustom: false,
};

/** A custom line (#113): a name the catalog could not match, so no product and no price. */
function customLine(itemId: string, displayName: string): CartItemView {
  return {
    itemId,
    productId: null,
    displayName,
    quantity: 1,
    addedByPersonId: 'p1',
    sourceConnector: 'custom',
    indicativePrice: null,
    isCustom: true,
  };
}

const quinoa = customLine('item-9', 'quinoa flakes');

/** What the API computes for a cart read: catalog lines totalled, custom ones counted. */
function totals(items: CartItemView[]): Pick<CartResponse, 'estimatedTotal' | 'customItemCount'> {
  const priced = items.filter((item) => !item.isCustom);
  return {
    estimatedTotal: priced.reduce(
      (sum, item) => sum + item.quantity * Number((item.indicativePrice ?? '0').replace('$', '')),
      0,
    ),
    customItemCount: items.length - priced.length,
  };
}

/** The week's building cart, optionally already holding some lines. */
function building(items: CartItemView[] = []): CartResponse {
  return {
    weekIso: WEEK,
    status: 'Building',
    confirmedByPersonId: null,
    confirmedUtc: null,
    eTag: CART_ETAG,
    items,
    ...totals(items),
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
    ...totals(items),
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

/** The G3 answer when nothing in the catalog matched: a 200 NoMatch (#113). */
const noMatch = ok({
  outcome: 'NoMatch',
  captureSource: 'hub-text',
  resolvedTerm: 'quinoa flakes',
  weekIso: WEEK,
  item: null,
  suggestions: [],
});

const captureAdded = ok({
  outcome: 'Added',
  captureSource: 'hub-text',
  resolvedTerm: 'oat milk',
  weekIso: WEEK,
  item: oatMilk,
  suggestions: [],
});

const voiceAdded = ok({
  outcome: 'Added',
  captureSource: 'simulated-voice',
  resolvedTerm: 'oat milk',
  weekIso: WEEK,
  item: oatMilk,
  suggestions: [],
});

type ClientOpts = {
  /** Successive answers to the cart read; the last one repeats. */
  reads?: ApiResult<unknown>[];
  capture?: ApiResult<unknown>;
  /** The answer to the voice capture (#116); defaults to the same Added answer. */
  voiceCapture?: ApiResult<unknown>;
  confirm?: ApiResult<unknown>;
  /** The answer to the custom-item post (#113). */
  customItem?: ApiResult<unknown>;
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
      if (path.endsWith('/capture/voice')) {
        return opts.voiceCapture ?? voiceAdded;
      }
      if (path.endsWith('/items')) {
        return opts.customItem ?? ok(quinoa);
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
    clearSession: () => undefined,
    providerKind: 'dev',
  });
}

async function renderCart(
  client: ApiClient,
  {
    organizer = false,
    activePersonId = 'p1',
    onConfirmed,
  }: {
    organizer?: boolean;
    activePersonId?: string | null;
    onConfirmed?: (cart: CartResponse) => void;
  } = {},
) {
  useApiClientMock.mockReturnValue(client);
  setOrganizer(organizer);
  return render(
    <GroceryCart householdId={HOUSEHOLD} activePersonId={activePersonId} onConfirmed={onConfirmed} />,
  );
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

    // Nothing in the list yet, and the read went to the current-cart route. An
    // empty cart has no total to show.
    expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('grocery-cart-total')).toBeNull();
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
    // The field is cleared, ready for the next thing, and an Added capture
    // offers no custom item.
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', '');
    expect(screen.queryByTestId('grocery-add-custom')).toBeNull();
    expect(screen.queryByTestId('grocery-item-custom-item-1')).toBeNull();
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

  it('confirm-flow: a successful confirm reports the confirmed cart to onConfirmed', async () => {
    const body = confirmed([oatMilk, quinoa]);
    const onConfirmed = jest.fn();
    await renderCart(cartClient({ reads: [ok(building([oatMilk, quinoa]))], confirm: ok(body) }), {
      organizer: true,
      onConfirmed,
    });
    await whenLoaded();

    // Nothing is reported before the organizer's tap.
    expect(onConfirmed).not.toHaveBeenCalled();

    await press('grocery-confirm');

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(onConfirmed).toHaveBeenCalledWith(body);
    // The region's own Confirmed state is unchanged by the callback.
    expect(screen.getByTestId('grocery-cart-status')).toHaveTextContent(/Confirmed/);
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

  it('no-match-offer: a NoMatch capture offers to add the term as a custom item', async () => {
    const client = cartClient({ capture: noMatch });
    await renderCart(client);
    await whenLoaded();

    await type('add quinoa flakes');
    // Submitting from the keyboard is the same gesture as tapping Add.
    await act(async () => {
      fireEvent(screen.getByTestId('grocery-add-input'), 'submitEditing');
    });

    // The offer names what Butler heard, in the AC3 wording.
    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-add-custom')).toHaveTextContent(
      'Add "quinoa flakes" as a custom item',
    );
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'The store has nothing matching "quinoa flakes".',
    );
    expect(screen.queryByTestId('grocery-suggestions')).toBeNull();
    // Nothing was added yet: no re-read, and the term stays to be refined.
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', 'add quinoa flakes');
  });

  it('custom-add: tapping the offer posts the custom item and the re-read cart shows it', async () => {
    const client = cartClient({
      capture: noMatch,
      reads: [ok(building()), ok(building([quinoa]))],
    });
    await renderCart(client);
    await whenLoaded();

    await type('quinoa flakes');
    await press('grocery-add-submit');
    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());

    await press('grocery-add-custom');

    // The custom line carries the resolved term, the acting participant, and a
    // quantity of one, to the week's items route.
    expect(client.update).toHaveBeenCalledWith(
      ITEMS_PATH,
      { displayName: 'quinoa flakes', personId: 'p1', quantity: 1 },
      { method: 'POST' },
    );

    // The re-read cart shows it, tagged Custom, and the total says it is unpriced.
    await waitFor(() => expect(screen.getByTestId('grocery-item-item-9')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('grocery-item-item-9')).toHaveTextContent(/quinoa flakes/);
    expect(screen.getByTestId('grocery-item-custom-item-9')).toHaveTextContent('Custom');
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'Added quinoa flakes as a custom item.',
    );
    expect(screen.getByTestId('grocery-cart-total')).toHaveTextContent('Estimated total $0.00');
    expect(screen.getByTestId('grocery-cart-unpriced-note')).toHaveTextContent(
      'Plus 1 custom item, not priced.',
    );
    // The offer is spent and the field is cleared.
    expect(screen.queryByTestId('grocery-add-custom')).toBeNull();
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', '');
  });

  it('custom-add-failed: a failed custom post says why and keeps the offer to retry', async () => {
    await renderCart(cartClient({ capture: noMatch, customItem: unreachable }));
    await whenLoaded();

    await type('quinoa flakes');
    await press('grocery-add-submit');
    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());

    await press('grocery-add-custom');

    await waitFor(() =>
      expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(/unreachable/),
    );
    expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', 'quinoa flakes');
  });

  it('in-flight custom add: the offer cannot be double-tapped', async () => {
    const pending = deferred<ApiResult<unknown>>();
    const client = cartClient({
      updateImpl: (path) => (path.endsWith('/items') ? pending.promise : Promise.resolve(noMatch)),
    });
    await renderCart(client);
    await whenLoaded();

    await type('quinoa flakes');
    await press('grocery-add-submit');
    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());

    // Fire without awaiting the settle: the custom post is still in flight.
    await act(async () => {
      fireEvent.press(screen.getByTestId('grocery-add-custom'));
    });

    expect(screen.getByTestId('grocery-add-custom')).toBeDisabled();
    expect(screen.getByTestId('grocery-add-submit')).toBeDisabled();
    await press('grocery-add-custom');
    expect(client.update).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.resolve(ok(quinoa));
      await pending.promise;
    });

    await waitFor(() => expect(screen.queryByTestId('grocery-add-custom')).toBeNull());
    expect(screen.getByTestId('grocery-add-submit')).not.toBeDisabled();
  });

  it('a new add clears a stale custom offer', async () => {
    await renderCart(cartClient({ capture: noMatch }));
    await whenLoaded();

    await type('quinoa flakes');
    await press('grocery-add-submit');
    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());

    // The next submit (even one that goes nowhere) withdraws the old offer.
    await type('   ');
    await press('grocery-add-submit');

    expect(screen.queryByTestId('grocery-add-custom')).toBeNull();
  });

  it('unpriced-note: a cart with custom items shows the estimated total and an unpriced note', async () => {
    await renderCart(cartClient({ reads: [ok(building([oatMilk, quinoa]))] }));
    await whenLoaded();

    expect(screen.getByTestId('grocery-cart-total')).toHaveTextContent('Estimated total $3.79');
    expect(screen.getByTestId('grocery-cart-unpriced-note')).toHaveTextContent(
      'Plus 1 custom item, not priced.',
    );
    // Only the custom line is tagged.
    expect(screen.getByTestId('grocery-item-custom-item-9')).toHaveTextContent('Custom');
    expect(screen.queryByTestId('grocery-item-custom-item-1')).toBeNull();
  });

  it('unpriced-note-plural: several custom items are counted, on a confirmed cart too', async () => {
    const items = [oatMilk, quinoa, customLine('item-10', 'party hats')];
    await renderCart(
      cartClient({ reads: [ok(building(items))], confirm: ok(confirmed(items)) }),
      { organizer: true },
    );
    await whenLoaded();

    expect(screen.getByTestId('grocery-cart-unpriced-note')).toHaveTextContent(
      'Plus 2 custom items, not priced.',
    );

    await press('grocery-confirm');

    await waitFor(() => expect(screen.getByTestId('grocery-cart-status')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-cart-total')).toHaveTextContent('Estimated total $3.79');
    expect(screen.getByTestId('grocery-cart-unpriced-note')).toHaveTextContent(
      'Plus 2 custom items, not priced.',
    );
    expect(screen.getByTestId('grocery-item-custom-item-10')).toBeOnTheScreen();
  });

  it('priced-only: a cart with no custom items shows the total without the note', async () => {
    await renderCart(cartClient({ reads: [ok(building([oatMilk, eggs]))] }));
    await whenLoaded();

    expect(screen.getByTestId('grocery-cart-total')).toHaveTextContent('Estimated total $9.77');
    expect(screen.queryByTestId('grocery-cart-unpriced-note')).toBeNull();
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
    expect(screen.getByText("This week's list did not load. Tap Try again.")).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-cart-error')).not.toHaveTextContent(/unreachable/);
    expect(screen.queryByTestId('grocery-cart-list')).toBeNull();
  });

  describe('load states', () => {
    it('renders a skeleton while the cart loads', async () => {
      const pending = deferred<ApiResult<unknown>>();
      await renderCart(cartClient({ getImpl: () => pending.promise }));

      expect(screen.getByTestId('grocery-cart-loading')).toBeOnTheScreen();
      expect(screen.getByText("Checking this week's list...")).toBeOnTheScreen();
      expect(screen.getByText('Groceries')).toBeOnTheScreen();
    });

    it('renders the designed empty state for an empty building cart', async () => {
      await renderCart(cartClient());
      await whenLoaded();

      expect(screen.getByTestId('grocery-cart-empty')).toBeOnTheScreen();
      expect(screen.getByText('The list is clear.')).toBeOnTheScreen();
      expect(screen.getByText('Add the first thing you need.')).toBeOnTheScreen();
    });

    it('renders a friendly error, never the raw API text, when the load fails', async () => {
      const failed: ApiResult<never> = {
        ok: false,
        error: { kind: 'problem', status: 500, title: 'Server Error', detail: 'Cart table offline.' },
      };
      await renderCart(cartClient({ reads: [failed] }));

      await waitFor(() => expect(screen.getByTestId('grocery-cart-error')).toBeOnTheScreen());
      expect(screen.getByText("This week's list did not load. Tap Try again.")).toBeOnTheScreen();
      expect(screen.getByTestId('grocery-cart-retry')).toBeOnTheScreen();
      expect(screen.getByTestId('grocery-cart')).not.toHaveTextContent(/Cart table offline|Server Error/);
    });
  });

  describe('retry', () => {
    it('Try again re-reads the current cart', async () => {
      const client = cartClient({ reads: [unreachable, ok(building([oatMilk]))] });
      await renderCart(client);

      await waitFor(() => expect(screen.getByTestId('grocery-cart-error')).toBeOnTheScreen());
      expect(client.get).toHaveBeenCalledTimes(1);

      await press('grocery-cart-retry');

      await whenLoaded();
      expect(client.get).toHaveBeenCalledTimes(2);
      expect(client.get).toHaveBeenLastCalledWith(CART_PATH);
      expect(screen.getByTestId(`grocery-item-${oatMilk.itemId}`)).toBeOnTheScreen();
      expect(screen.queryByTestId('grocery-cart-error')).toBeNull();
    });
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

  it('failed-confirm: onConfirmed is not called when the confirm fails', async () => {
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
    const onConfirmed = jest.fn();
    await renderCart(cartClient({ reads: [ok(building([oatMilk]))], confirm: stale }), {
      organizer: true,
      onConfirmed,
    });
    await whenLoaded();

    await press('grocery-confirm');

    await waitFor(() => expect(screen.getByTestId('grocery-cart-notice')).toBeOnTheScreen());
    expect(onConfirmed).not.toHaveBeenCalled();
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

/**
 * A stand-in for the browser's speech recognizer (#116). Every instance is
 * recorded so a test can fire its events and check how it was driven.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onnomatch: ((event: unknown) => void) | null = null;
  onend: ((event: unknown) => void) | null = null;
  start = jest.fn();
  stop = jest.fn();
  abort = jest.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }
}

type SpeechGlobals = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

/** Give the "browser" a recognizer, under the prefixed name unless told otherwise. */
function installSpeech(name: keyof SpeechGlobals = 'webkitSpeechRecognition') {
  (globalThis as SpeechGlobals)[name] = FakeRecognition;
}

/** The recognizer the latest Speak tap created. */
function recognizer(): FakeRecognition {
  return FakeRecognition.instances[FakeRecognition.instances.length - 1];
}

/** The browser hearing `transcript`, then ending the session as Chrome does. */
async function hear(transcript: string) {
  const rec = recognizer();
  await act(async () => {
    rec.onresult?.({ resultIndex: 0, results: [[{ transcript }]] });
    rec.onend?.({});
  });
}

describe('GroceryCart voice capture', () => {
  afterEach(() => {
    FakeRecognition.instances = [];
    delete (globalThis as SpeechGlobals).SpeechRecognition;
    delete (globalThis as SpeechGlobals).webkitSpeechRecognition;
  });

  it('voice-unsupported: no speech recognition renders no mic button, and typing still adds', async () => {
    const client = cartClient({ reads: [ok(building()), ok(building([oatMilk]))] });
    await renderCart(client);
    await whenLoaded();

    expect(screen.queryByTestId('grocery-voice')).toBeNull();
    expect(screen.getByTestId('grocery-add-submit')).toBeOnTheScreen();

    await type('oat milk');
    await press('grocery-add-submit');

    expect(client.update).toHaveBeenCalledWith(
      CAPTURE_PATH,
      { utterance: 'oat milk', personId: 'p1', weekIso: WEEK, quantity: 1 },
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen());
  });

  it('voice-supported: a building cart renders the Speak button when webkitSpeechRecognition exists', async () => {
    installSpeech('webkitSpeechRecognition');
    await renderCart(cartClient());
    await whenLoaded();

    expect(screen.getByTestId('grocery-voice')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-voice')).toHaveTextContent('Speak');
    expect(screen.getByLabelText('Add an item by voice')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-voice')).not.toBeDisabled();
    // Nothing listens until the button is pressed.
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('voice-supported: the standard SpeechRecognition renders the Speak button too', async () => {
    installSpeech('SpeechRecognition');
    await renderCart(cartClient());
    await whenLoaded();

    expect(screen.getByTestId('grocery-voice')).toBeOnTheScreen();
  });

  it('voice-supported: there is no mic on a confirmed week, with nothing to add to', async () => {
    installSpeech();
    await renderCart(cartClient({ reads: [alreadyConfirmed] }));

    await waitFor(() => expect(screen.getByTestId('grocery-cart-week-confirmed')).toBeOnTheScreen());
    expect(screen.queryByTestId('grocery-voice')).toBeNull();
  });

  it('voice-listening: pressing Speak shows Listening... and disables the mic until recognition ends', async () => {
    installSpeech();
    const client = cartClient();
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');

    expect(recognizer().start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('grocery-voice-listening')).toHaveTextContent('Listening...');
    expect(screen.getByTestId('grocery-voice')).toBeDisabled();

    // Recognition ends (here with nothing heard): the listening state goes away.
    await act(async () => {
      recognizer().onend?.({});
    });

    expect(screen.queryByTestId('grocery-voice-listening')).toBeNull();
    expect(screen.getByTestId('grocery-voice')).toHaveTextContent('Speak');
    expect(screen.getByTestId('grocery-voice')).not.toBeDisabled();
  });

  it('voice-one-utterance: one recognized utterance stops recognition; a second press starts a new session', async () => {
    installSpeech();
    const client = cartClient({ reads: [ok(building()), ok(building([oatMilk]))] });
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    const first = recognizer();
    // One final result, one alternative: never continuous or interim.
    expect(first.continuous).toBe(false);
    expect(first.interimResults).toBe(false);
    expect(first.maxAlternatives).toBe(1);
    expect(first.lang).toBe('en-US');

    await act(async () => {
      first.onresult?.({ resultIndex: 0, results: [[{ transcript: 'oat milk' }]] });
    });
    expect(first.stop).toHaveBeenCalledTimes(1);

    // A late second result before the session ends posts nothing more.
    await act(async () => {
      first.onresult?.({ resultIndex: 0, results: [[{ transcript: 'eggs' }]] });
      first.onend?.({});
    });
    await waitFor(() =>
      expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent('Added H-E-B Oat Milk.'),
    );
    expect(client.update).toHaveBeenCalledTimes(1);

    // Only a new press listens again, on a new recognizer.
    await press('grocery-voice');
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(recognizer().start).toHaveBeenCalledTimes(1);
    expect(first.start).toHaveBeenCalledTimes(1);
  });

  it('voice-transcript-shown: the heard transcript is on screen while the voice capture is in flight and after it settles', async () => {
    installSpeech();
    const pending = deferred<ApiResult<unknown>>();
    const client = cartClient({ updateImpl: () => pending.promise });
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    await hear('  oat milk ');

    // Shown as the send starts, and what was sent is exactly what is shown.
    expect(screen.getByTestId('grocery-voice-transcript')).toHaveTextContent('Heard "oat milk"');
    expect(client.update).toHaveBeenCalledWith(
      VOICE_PATH,
      { utterance: 'oat milk', personId: 'p1', weekIso: WEEK, quantity: 1 },
      { method: 'POST' },
    );
    // While it is in flight, nothing can be sent twice.
    expect(screen.getByTestId('grocery-voice')).toBeDisabled();
    expect(screen.getByTestId('grocery-add-submit')).toBeDisabled();

    await act(async () => {
      pending.resolve(voiceAdded);
      await pending.promise;
    });

    await waitFor(() => expect(screen.getByTestId('grocery-voice')).not.toBeDisabled());
    expect(screen.getByTestId('grocery-voice-transcript')).toHaveTextContent('Heard "oat milk"');
  });

  it('voice-capture-posts: a transcript posts to /capture/voice and the added line renders like a typed add', async () => {
    installSpeech();
    const client = cartClient({ reads: [ok(building()), ok(building([oatMilk]))] });
    await renderCart(client);
    await whenLoaded();

    // Something half-typed stays where it is: the mic does not own the field.
    await type('eggs');
    await press('grocery-voice');
    await hear('please add oat milk to the list');

    expect(client.update).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledWith(
      VOICE_PATH,
      {
        utterance: 'please add oat milk to the list',
        personId: 'p1',
        weekIso: WEEK,
        quantity: 1,
      },
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen());
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('grocery-item-quantity-item-1')).toHaveTextContent('x1');
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent('Added H-E-B Oat Milk.');
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', 'eggs');
  });

  it('voice-no-match: a NoMatch voice capture offers the custom item like text does', async () => {
    installSpeech();
    const client = cartClient({ voiceCapture: noMatch });
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    await hear('quinoa flakes');

    await waitFor(() => expect(screen.getByTestId('grocery-add-custom')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-add-custom')).toHaveTextContent(
      'Add "quinoa flakes" as a custom item',
    );
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'The store has nothing matching "quinoa flakes".',
    );
    expect(client.get).toHaveBeenCalledTimes(1);

    await press('grocery-add-custom');
    expect(client.update).toHaveBeenCalledWith(
      ITEMS_PATH,
      { displayName: 'quinoa flakes', personId: 'p1', quantity: 1 },
      { method: 'POST' },
    );
  });

  it('voice-ambiguous: an ambiguous voice capture shows the suggestions like text does', async () => {
    installSpeech();
    await renderCart(cartClient({ voiceCapture: ambiguous }));
    await whenLoaded();

    await press('grocery-voice');
    await hear('milk');

    await waitFor(() => expect(screen.getByTestId('grocery-suggestions')).toBeOnTheScreen());
    expect(screen.getByTestId('grocery-suggestion-heb-0001')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-suggestion-heb-0016')).toBeOnTheScreen();
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(/Did you mean one of these\?/);
  });

  it('voice-error: a recognition error posts nothing, says so, and the cart stays usable', async () => {
    installSpeech();
    const client = cartClient({ reads: [ok(building()), ok(building([oatMilk]))] });
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    const rec = recognizer();
    // Chrome fires the error and then ends the session.
    await act(async () => {
      rec.onerror?.({ error: 'not-allowed' });
      rec.onend?.({});
    });

    expect(client.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'I did not catch that. Tap Speak to try again, or type it.',
    );
    expect(screen.queryByTestId('grocery-voice-transcript')).toBeNull();
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('editable', true);
    expect(screen.getByTestId('grocery-add-submit')).not.toBeDisabled();
    expect(screen.getByTestId('grocery-voice')).not.toBeDisabled();

    // Typing still works straight after.
    await type('oat milk');
    await press('grocery-add-submit');
    expect(client.update).toHaveBeenCalledWith(
      CAPTURE_PATH,
      { utterance: 'oat milk', personId: 'p1', weekIso: WEEK, quantity: 1 },
      { method: 'POST' },
    );
    await waitFor(() => expect(screen.getByTestId('grocery-item-item-1')).toBeOnTheScreen());
  });

  it('voice-empty: an empty transcript posts nothing and the cart stays usable', async () => {
    installSpeech();
    const client = cartClient();
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    await hear('   ');

    expect(client.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'I did not catch that. Tap Speak to try again, or type it.',
    );
    expect(screen.queryByTestId('grocery-voice-transcript')).toBeNull();
    expect(screen.getByTestId('grocery-voice')).not.toBeDisabled();
    expect(screen.getByTestId('grocery-add-submit')).not.toBeDisabled();
  });

  it('voice-empty: a session that ends with no result posts nothing', async () => {
    installSpeech();
    const client = cartClient();
    await renderCart(client);
    await whenLoaded();

    await press('grocery-voice');
    await act(async () => {
      recognizer().onend?.({});
    });

    expect(client.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'I did not catch that. Tap Speak to try again, or type it.',
    );
    expect(screen.getByTestId('grocery-voice')).not.toBeDisabled();
  });

  it('voice-no-participant: with nobody claimed the mic asks for a name and does not listen', async () => {
    installSpeech();
    const client = cartClient();
    await renderCart(client, { activePersonId: null });
    await whenLoaded();

    await press('grocery-voice');

    expect(FakeRecognition.instances).toHaveLength(0);
    expect(screen.getByTestId('grocery-cart-notice')).toHaveTextContent(
      'Tap your name first, then add to the list.',
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('a typed add clears what the mic heard', async () => {
    installSpeech();
    await renderCart(cartClient());
    await whenLoaded();

    await press('grocery-voice');
    await hear('oat milk');
    await waitFor(() => expect(screen.getByTestId('grocery-voice-transcript')).toBeOnTheScreen());

    await type('eggs');
    await press('grocery-add-submit');

    expect(screen.queryByTestId('grocery-voice-transcript')).toBeNull();
  });

  it('unmounting while listening aborts recognition', async () => {
    installSpeech();
    const view = await renderCart(cartClient());
    await whenLoaded();

    await press('grocery-voice');
    const rec = recognizer();

    await view.unmount();

    expect(rec.abort).toHaveBeenCalledTimes(1);
  });
});

describe('cart copy helpers', () => {
  it('words the custom offer as AC3 fixes it', () => {
    expect(customOfferLabel('unicorn steaks')).toBe('Add "unicorn steaks" as a custom item');
  });

  it('shows what the mic heard in quotes', () => {
    expect(heardLabel('oat milk')).toBe('Heard "oat milk"');
  });

  it('formats the estimated total to the cent', () => {
    expect(estimatedTotalLabel(9.47)).toBe('Estimated total $9.47');
    expect(estimatedTotalLabel(0)).toBe('Estimated total $0.00');
  });

  it('counts unpriced custom items in the singular and the plural', () => {
    expect(unpricedNote(1)).toBe('Plus 1 custom item, not priced.');
    expect(unpricedNote(3)).toBe('Plus 3 custom items, not priced.');
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
