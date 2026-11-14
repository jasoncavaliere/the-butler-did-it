import { fireEvent, render, screen } from '@testing-library/react-native';

import { OrderReceipt, addedByName, customNote, handOffLine, storeName } from './OrderReceipt';
import type { CartItemView, CartResponse, RosterEntryResponse } from '../api/models';

const WEEK = '2026-W29';

const people: RosterEntryResponse[] = [
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
  { personId: 'p2', displayName: 'Sam', claimColor: null, isChild: true },
];

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
function customLine(itemId: string, displayName: string, addedByPersonId = 'p1'): CartItemView {
  return {
    itemId,
    productId: null,
    displayName,
    quantity: 1,
    addedByPersonId,
    sourceConnector: 'custom',
    indicativePrice: null,
    isCustom: true,
  };
}

const quinoa = customLine('item-9', 'quinoa flakes', 'p2');

/**
 * The confirm response (G4). The totals are given, never derived: the receipt
 * must show what the API computed, so the fixture's estimatedTotal is
 * deliberately not the sum of the item prices.
 */
function confirmed(
  items: CartItemView[],
  { estimatedTotal = 12.34, customItemCount = 0 }: { estimatedTotal?: number; customItemCount?: number } = {},
): CartResponse {
  return {
    weekIso: WEEK,
    status: 'Confirmed',
    confirmedByPersonId: 'p-organizer',
    confirmedUtc: '2026-07-20T18:00:00Z',
    eTag: 'W/"cart-2"',
    items,
    estimatedTotal,
    customItemCount,
  };
}

async function renderReceipt(cart: CartResponse, onDismiss: () => void = jest.fn()) {
  return render(<OrderReceipt cart={cart} people={people} onDismiss={onDismiss} />);
}

describe('OrderReceipt', () => {
  it('renders the confirmed heading', async () => {
    await renderReceipt(confirmed([oatMilk]));

    expect(screen.getByTestId('order-receipt')).toBeOnTheScreen();
    expect(screen.getByTestId('order-receipt-heading')).toHaveTextContent('Order confirmed');
    expect(screen.getByRole('header')).toHaveTextContent('Order confirmed');
  });

  it('lists each item with its quantity', async () => {
    await renderReceipt(confirmed([oatMilk, eggs]));

    expect(screen.getByTestId('order-receipt-item-item-1')).toHaveTextContent(/H-E-B Oat Milk/);
    expect(screen.getByTestId('order-receipt-item-quantity-item-1')).toHaveTextContent('x1');
    expect(screen.getByTestId('order-receipt-item-item-2')).toHaveTextContent(/H-E-B Grade A Large Eggs/);
    expect(screen.getByTestId('order-receipt-item-quantity-item-2')).toHaveTextContent('x2');
    expect(screen.queryByTestId('order-receipt-empty')).toBeNull();
  });

  it('shows who added each item by roster name', async () => {
    await renderReceipt(
      confirmed([oatMilk, eggs, customLine('item-7', 'mystery', 'p-gone')], { customItemCount: 1 }),
    );

    expect(screen.getByTestId('order-receipt-item-added-by-item-1')).toHaveTextContent('Added by Alex');
    expect(screen.getByTestId('order-receipt-item-added-by-item-2')).toHaveTextContent('Added by Sam');
    // Someone no longer on the roster is still a calm line, never a raw id.
    expect(screen.getByTestId('order-receipt-item-added-by-item-7')).toHaveTextContent('Added by someone');
  });

  it("shows the store name from the items' sourceConnector", async () => {
    await renderReceipt(confirmed([quinoa, oatMilk], { customItemCount: 1 }));

    expect(screen.getByTestId('order-receipt-store')).toHaveTextContent('Store: H-E-B');
  });

  it("shows the confirm response's estimatedTotal", async () => {
    // 1 x 3.79 + 2 x 2.99 would be 9.77; the receipt shows the API's figure.
    await renderReceipt(confirmed([oatMilk, eggs], { estimatedTotal: 12.34 }));

    expect(screen.getByTestId('order-receipt-total')).toHaveTextContent('Estimated total $12.34');
  });

  it('marks custom items and says how many are not in the estimated total', async () => {
    await renderReceipt(confirmed([oatMilk, quinoa], { customItemCount: 1 }));

    expect(screen.getByTestId('order-receipt-item-custom-item-9')).toHaveTextContent('Custom');
    expect(screen.queryByTestId('order-receipt-item-custom-item-1')).toBeNull();
    expect(screen.getByTestId('order-receipt-custom-note')).toHaveTextContent(
      '1 custom item is not in the estimated total.',
    );
  });

  it('uses the plural custom note for several custom items', async () => {
    await renderReceipt(
      confirmed([oatMilk, quinoa, customLine('item-8', 'kombu')], { customItemCount: 2 }),
    );

    expect(screen.getByTestId('order-receipt-item-custom-item-8')).toHaveTextContent('Custom');
    expect(screen.getByTestId('order-receipt-custom-note')).toHaveTextContent(
      '2 custom items are not in the estimated total.',
    );
  });

  it('omits the custom note when there are no custom items', async () => {
    await renderReceipt(confirmed([oatMilk], { customItemCount: 0 }));

    expect(screen.queryByTestId('order-receipt-custom-note')).toBeNull();
  });

  it('says no money has moved and the order is ready to hand off to H-E-B', async () => {
    await renderReceipt(confirmed([oatMilk]));

    expect(screen.getByTestId('order-receipt-handoff')).toHaveTextContent(
      'No money has moved. This order is ready to hand off to H-E-B.',
    );
  });

  it('Back to the hub calls onDismiss', async () => {
    const onDismiss = jest.fn();
    await renderReceipt(confirmed([oatMilk]), onDismiss);

    const dismiss = screen.getByTestId('order-receipt-dismiss');
    expect(dismiss).toHaveTextContent('Back to the hub');
    expect(screen.getByRole('button', { name: 'Back to the hub' })).toBeOnTheScreen();

    fireEvent.press(dismiss);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders a calm empty state for an order with no items', async () => {
    await renderReceipt(confirmed([], { estimatedTotal: 0 }));

    expect(screen.getByTestId('order-receipt-empty')).toHaveTextContent('No items on this order.');
    expect(screen.getByTestId('order-receipt-store')).toHaveTextContent('Store: the store');
    expect(screen.getByTestId('order-receipt-total')).toHaveTextContent('Estimated total $0.00');
    expect(screen.getByTestId('order-receipt-handoff')).toHaveTextContent(
      'No money has moved. This order is ready to hand off to the store.',
    );
  });
});

describe('storeName', () => {
  it('maps simulated-heb to H-E-B', () => {
    expect(storeName([oatMilk])).toBe('H-E-B');
  });

  it('skips custom lines and reads the first catalog line', () => {
    expect(storeName([quinoa, oatMilk])).toBe('H-E-B');
  });

  it('shows an unknown connector id as-is', () => {
    expect(storeName([{ ...oatMilk, sourceConnector: 'corner-shop' }])).toBe('corner-shop');
  });

  it("uses 'the store' when there is no catalog line", () => {
    expect(storeName([quinoa])).toBe('the store');
    expect(storeName([])).toBe('the store');
  });
});

describe('addedByName', () => {
  it('resolves a roster id to the display name', () => {
    expect(addedByName('p2', people)).toBe('Sam');
  });

  it("falls back to 'someone' for an id not on the roster", () => {
    expect(addedByName('p-gone', people)).toBe('someone');
  });
});

describe('customNote', () => {
  it('reads singular and plural', () => {
    expect(customNote(1)).toBe('1 custom item is not in the estimated total.');
    expect(customNote(3)).toBe('3 custom items are not in the estimated total.');
  });
});

describe('handOffLine', () => {
  it('names the store the order goes to', () => {
    expect(handOffLine('H-E-B')).toBe('No money has moved. This order is ready to hand off to H-E-B.');
  });
});
