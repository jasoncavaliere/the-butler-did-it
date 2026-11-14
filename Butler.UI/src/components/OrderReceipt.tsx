import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CartItemView, CartResponse, RosterEntryResponse } from '../api/models';
import { estimatedTotalLabel } from './GroceryCart';
import { colors } from './Screen';

/**
 * The order receipt (#115, Epic 50): what the hub shows straight after the
 * organizer's Confirm order succeeds, in place of the hub body, until someone
 * taps Back to the hub. {@link HubShell} owns that switch; this component only
 * presents.
 *
 * It is built from exactly two things and fetches nothing:
 *
 * - **The confirm response (G4).** The confirmed cart's lines, its
 *   `estimatedTotal`, and its `customItemCount` are shown as the API computed
 *   them (#113). The client never re-adds prices or recounts custom lines, so
 *   the receipt can never disagree with the server.
 * - **The roster.** Each line's `addedByPersonId` is resolved to that person's
 *   display name; someone no longer on the roster reads as "someone", never as
 *   a raw id.
 *
 * The store name comes from the lines' `sourceConnector` through a small
 * display table, so a second connector is a new table row, not new copy - the
 * receipt never hard-wires a single store. A custom line is marked with the
 * word Custom (never colour alone) and is named in the note under the total.
 *
 * Nothing is placed and no money moves (BRD decision D-8): the receipt says so
 * plainly, and says the order is ready to hand off to the store.
 */

/** Copy, kept in one place so the concierge voice stays consistent. */
const COPY = {
  heading: 'Order confirmed',
  empty: 'No items on this order.',
  custom: 'Custom',
  dismiss: 'Back to the hub',
  unknownStore: 'the store',
  unknownPerson: 'someone',
} as const;

/** Connector ids the hub knows a friendly name for; anything else shows as-is. */
const STORE_NAMES: Record<string, string> = {
  'simulated-heb': 'H-E-B',
};

/**
 * The store an order goes to: the first catalog (non-custom) line's
 * `sourceConnector`, through the display table. An order of only custom lines,
 * or none at all, names no store, so it reads as "the store".
 */
export function storeName(items: CartItemView[]): string {
  const catalogLine = items.find((item) => !item.isCustom);
  if (catalogLine === undefined) {
    return COPY.unknownStore;
  }
  return STORE_NAMES[catalogLine.sourceConnector] ?? catalogLine.sourceConnector;
}

/** The roster name of whoever added a line, or "someone" when they are not on it. */
export function addedByName(personId: string, people: RosterEntryResponse[]): string {
  return people.find((person) => person.personId === personId)?.displayName ?? COPY.unknownPerson;
}

/** The note naming how many custom lines the estimated total leaves out. */
export function customNote(count: number): string {
  return count === 1
    ? '1 custom item is not in the estimated total.'
    : `${count} custom items are not in the estimated total.`;
}

/** The plain statement that nothing was paid and where the order goes next. */
export function handOffLine(store: string): string {
  return `No money has moved. This order is ready to hand off to ${store}.`;
}

export function OrderReceipt({
  cart,
  people,
  onDismiss,
}: {
  /** The confirm response (G4), exactly as the API returned it. */
  cart: CartResponse;
  /** The household roster, to name who added each line. */
  people: RosterEntryResponse[];
  /** Back to the hub. */
  onDismiss: () => void;
}) {
  const store = storeName(cart.items);

  return (
    <View style={styles.receipt} testID="order-receipt">
      <Text style={styles.heading} accessibilityRole="header" testID="order-receipt-heading">
        {COPY.heading}
      </Text>
      <Text style={styles.store} testID="order-receipt-store">
        {`Store: ${store}`}
      </Text>

      <View style={styles.list}>
        {cart.items.length === 0 ? (
          <Text style={styles.status} testID="order-receipt-empty">
            {COPY.empty}
          </Text>
        ) : (
          cart.items.map((item) => (
            <View key={item.itemId} style={styles.item} testID={`order-receipt-item-${item.itemId}`}>
              <View style={styles.itemText}>
                <View style={styles.itemLabel}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  {/* A custom line is marked with a word, never colour alone. */}
                  {item.isCustom ? (
                    <Text style={styles.customTag} testID={`order-receipt-item-custom-${item.itemId}`}>
                      {COPY.custom}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.addedBy} testID={`order-receipt-item-added-by-${item.itemId}`}>
                  {`Added by ${addedByName(item.addedByPersonId, people)}`}
                </Text>
              </View>
              <Text style={styles.itemQuantity} testID={`order-receipt-item-quantity-${item.itemId}`}>
                {`x${item.quantity}`}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.totals}>
        <Text style={styles.total} testID="order-receipt-total">
          {estimatedTotalLabel(cart.estimatedTotal)}
        </Text>
        {cart.customItemCount > 0 ? (
          <Text style={styles.note} testID="order-receipt-custom-note">
            {customNote(cart.customItemCount)}
          </Text>
        ) : null}
      </View>

      <Text style={styles.handOff} testID="order-receipt-handoff">
        {handOffLine(store)}
      </Text>

      <Pressable
        testID="order-receipt-dismiss"
        accessibilityRole="button"
        style={styles.dismissButton}
        onPress={onDismiss}
      >
        <Text style={styles.dismissText}>{COPY.dismiss}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: { gap: 16 },
  heading: { color: colors.ink, fontSize: 28, fontWeight: '700' },
  store: { color: colors.brass, fontSize: 18, fontWeight: '600' },
  status: { color: colors.muted, fontSize: 18 },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  itemText: { gap: 2, flexShrink: 1 },
  itemLabel: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  itemName: { color: colors.ink, fontSize: 18, flexShrink: 1 },
  addedBy: { color: colors.muted, fontSize: 15 },
  customTag: {
    color: colors.brass,
    fontSize: 13,
    fontWeight: '600',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  itemQuantity: { color: colors.muted, fontSize: 18, fontVariant: ['tabular-nums'] },
  totals: { gap: 4 },
  total: { color: colors.ink, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { color: colors.muted, fontSize: 16 },
  handOff: { color: colors.ink, fontSize: 18 },
  dismissButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.brass,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  dismissText: { color: colors.page, fontSize: 17, fontWeight: '700' },
});
