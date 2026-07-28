import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ApiError } from '../api/client';
import { describeApiError } from '../api/errors';
import type { CaptureResponse, CartResponse, StoreProductView } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { useOrganizer } from '../state/OrganizerContext';
import { colors } from './Screen';

/**
 * The hub grocery cart (Epic 50 G5, journey 6.4): the whole "add oat milk ->
 * review -> confirm" gesture on the shared tablet, rendered by {@link HubShell}
 * as its own bounded region beside the chore board and the fairness balance.
 *
 * It composes three API surfaces through the F7 typed client and owns no data of
 * its own:
 *
 * - **Review (G2).** `GET /households/{id}/carts/current` hands back the week's
 *   single `Building` cart with its items - the list a human reads before the
 *   final tap - plus the cart's `eTag`. A week whose cart is already `Confirmed`
 *   answers `409`, which is a calm confirmed state here, not an error.
 * - **Add (G3).** A typed term posts to `/capture/text` and the cart is re-read,
 *   so the list and the `eTag` are always the server's truth (adding the same
 *   product twice increments its `Quantity` server-side, and the capture response
 *   carries the new line but not the cart's fresh `eTag`). Adding is deliberately
 *   open to anyone on the roster - no password, no organizer (decision D-3).
 *   An ambiguous term comes back with `suggestions` and a no-match with a plain
 *   message; neither is ever a silent failure.
 * - **Confirm (G4).** Organizer-only, and *absent* rather than disabled without
 *   one, matching the {@link OrganizerBar} convention. It posts to
 *   `/carts/{weekIso}/confirm` with the cart's `eTag` as `If-Match`
 *   (Engineering Contract 7.3). This gate is convenience: the API independently
 *   enforces `403` for a participant or the paired hub device.
 *
 * Nothing here places a real order and no money moves (BRD decision D-8) - the
 * backing connector is the simulated G1 one, so the demo runs fully offline of
 * any real store.
 *
 * Every outcome is a deliberate, calm state (loading, empty, a readable message,
 * confirmed) so the wall never shows a crash or a blank region.
 */

/** The cart lifecycle values the API returns (mirrors the API's `CartStatus`). */
const CONFIRMED = 'Confirmed';

/** Copy, kept in one place so the concierge voice stays consistent. */
const COPY = {
  loading: "Checking this week's list...",
  empty: 'The list is empty. Add the first thing you need.',
  needsTerm: 'Type what to add, for example "oat milk".',
  needsParticipant: 'Tap your name first, then add to the list.',
  ambiguous: 'Did you mean one of these? Type the one you want.',
  confirmFailed: 'That did not go through. Tap Confirm order to try again.',
  weekConfirmed: "This week's list is confirmed. Nothing more to add.",
} as const;

/**
 * What the region is showing. `confirmed` is the week-already-confirmed answer to
 * the current-cart read (a `409`), which carries no cart body - distinct from a
 * loaded cart whose own `status` is `Confirmed`, which does.
 */
type CartState =
  | { phase: 'loading' }
  | { phase: 'ready'; cart: CartResponse }
  | { phase: 'confirmed' }
  | { phase: 'error'; message: string };

/**
 * The candidate products on an ambiguous-capture problem document. The API puts
 * them in the RFC 7807 `suggestions` extension member, which the typed client
 * surfaces untyped on {@link ApiError.problem}; anything else (a no-match, an
 * unreachable API) yields none.
 */
export function readSuggestions(error: ApiError): StoreProductView[] {
  const raw = error.problem?.suggestions;
  return Array.isArray(raw) ? (raw as StoreProductView[]) : [];
}

export function GroceryCart({
  householdId,
  activePersonId,
}: {
  householdId: string;
  /** The hub's active tap-to-claim participant, whom an added line is attributed to. */
  activePersonId: string | null;
}) {
  const client = useApiClient();
  const { isSignedIn } = useOrganizer();
  const [state, setState] = useState<CartState>({ phase: 'loading' });
  const [term, setTerm] = useState('');
  const [notice, setNotice] = useState('');
  const [suggestions, setSuggestions] = useState<StoreProductView[]>([]);
  const [busy, setBusy] = useState(false);

  // The single read the region ever does. It is also what an add reconciles
  // against, so the rendered list and the confirm's `If-Match` can never drift
  // from the server.
  const readCart = useCallback(async (): Promise<CartState> => {
    const result = await client.get<CartResponse>(`/households/${householdId}/carts/current`);
    if (result.ok) {
      return { phase: 'ready', cart: result.data };
    }
    // The week's cart is already confirmed, so there is no building cart to hand
    // back (G2). That is a finished week, not a failure.
    if (result.error.status === 409) {
      return { phase: 'confirmed' };
    }
    return { phase: 'error', message: describeApiError(result.error) };
  }, [client, householdId]);

  useEffect(() => {
    let active = true;
    readCart().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, [readCart]);

  // Adding: resolve the typed term through G3 and re-read the cart. The line is
  // attributed to the active participant, because the shared tablet authenticates
  // as a device or organizer rather than as a person - with nobody claimed, say
  // so plainly instead of spending a round trip on a 400.
  const add = useCallback(
    async (cart: CartResponse) => {
      const utterance = term.trim();
      setSuggestions([]);
      if (utterance === '') {
        setNotice(COPY.needsTerm);
        return;
      }
      if (activePersonId === null) {
        setNotice(COPY.needsParticipant);
        return;
      }

      setNotice('');
      setBusy(true);
      const result = await client.update<CaptureResponse>(
        `/households/${householdId}/capture/text`,
        { utterance, personId: activePersonId, weekIso: cart.weekIso, quantity: 1 },
        { method: 'POST' },
      );

      if (!result.ok) {
        const candidates = readSuggestions(result.error);
        setSuggestions(candidates);
        // Ambiguous: show the candidates and the next step. Anything else (no
        // match, an unreachable API) gets the problem's own readable line.
        setNotice(candidates.length > 0 ? COPY.ambiguous : describeApiError(result.error));
        setBusy(false);
        return;
      }

      setTerm('');
      setNotice(`Added ${result.data.item.displayName}.`);
      setState(await readCart());
      setBusy(false);
    },
    [activePersonId, client, householdId, readCart, term],
  );

  // Confirming: the organizer's final tap (G4), sent under the cart's own `eTag`
  // so a line added since the review is a 412 the organizer re-reads rather than
  // a confirm of a list they never saw.
  const confirm = useCallback(
    async (cart: CartResponse) => {
      setNotice('');
      setSuggestions([]);
      setBusy(true);
      const result = await client.update<CartResponse>(
        `/households/${householdId}/carts/${cart.weekIso}/confirm`,
        {},
        { method: 'POST', ifMatch: cart.eTag },
      );

      if (!result.ok) {
        setNotice(describeApiError(result.error));
        setBusy(false);
        return;
      }

      setState({ phase: 'ready', cart: result.data });
      setNotice('');
      setBusy(false);
    },
    [client, householdId],
  );

  const cart = state.phase === 'ready' ? state.cart : null;
  // Confirmed either way it can be known: the week answered 409, or the loaded
  // cart says so itself (including straight after a successful confirm).
  const isConfirmed = state.phase === 'confirmed' || cart?.status === CONFIRMED;
  const items = cart?.items ?? [];

  return (
    <View style={styles.region} testID="grocery-cart">
      <View style={styles.headerRow}>
        <Text style={styles.heading} accessibilityRole="header">
          Groceries
        </Text>
        {/* Status is carried by a glyph and a word, never by colour alone. */}
        {isConfirmed ? (
          <View style={styles.statusPill} testID="grocery-cart-status">
            <Text style={styles.statusGlyph}>{'✓'}</Text>
            <Text style={styles.statusText}>{CONFIRMED}</Text>
          </View>
        ) : null}
      </View>

      {state.phase === 'loading' ? (
        <View style={styles.centeredRow} testID="grocery-cart-loading">
          <ActivityIndicator color={colors.brass} />
          <Text style={styles.status}>{COPY.loading}</Text>
        </View>
      ) : null}

      {state.phase === 'error' ? (
        <Text style={styles.status} testID="grocery-cart-error">
          {state.message}
        </Text>
      ) : null}

      {state.phase === 'confirmed' ? (
        <Text style={styles.status} testID="grocery-cart-week-confirmed">
          {COPY.weekConfirmed}
        </Text>
      ) : null}

      {cart !== null && !isConfirmed ? (
        <AddItemRow
          term={term}
          busy={busy}
          onChangeTerm={setTerm}
          onSubmit={() => {
            void add(cart);
          }}
        />
      ) : null}

      {cart !== null ? (
        <View style={styles.list} testID="grocery-cart-list">
          {items.length === 0 ? (
            <Text style={styles.status} testID="grocery-cart-empty">
              {COPY.empty}
            </Text>
          ) : (
            items.map((item) => (
              <View key={item.itemId} style={styles.item} testID={`grocery-item-${item.itemId}`}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.itemQuantity} testID={`grocery-item-quantity-${item.itemId}`}>
                  {`x${item.quantity}`}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.suggestions} testID="grocery-suggestions">
          {suggestions.map((product) => (
            <Text
              key={product.productId}
              style={styles.suggestion}
              testID={`grocery-suggestion-${product.productId}`}
            >
              {`${product.displayName} (${product.size} ${product.unit})`}
            </Text>
          ))}
        </View>
      ) : null}

      {notice !== '' ? (
        <Text style={styles.notice} testID="grocery-cart-notice">
          {notice}
        </Text>
      ) : null}

      {/* The sensitive action: rendered only for a signed-in organizer, and only
          while there is a building cart to confirm. Hidden, not disabled - a
          participant is never presented it. The API enforces the same rule. */}
      {cart !== null && !isConfirmed && isSignedIn ? (
        <Pressable
          testID="grocery-confirm"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={[styles.confirmButton, busy && styles.buttonBusy]}
          onPress={() => {
            void confirm(cart);
          }}
        >
          <Text style={styles.confirmText}>Confirm order</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The add-an-item control: a labelled field plus its button, both driving the
 * same submit so typing Enter and tapping Add are the same gesture. The label is
 * a real visible label (never the placeholder), and both controls clear the 44px
 * minimum touch target.
 */
function AddItemRow({
  term,
  busy,
  onChangeTerm,
  onSubmit,
}: {
  term: string;
  busy: boolean;
  onChangeTerm: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.addRow}>
      <Text style={styles.label}>Add an item</Text>
      <View style={styles.addControls}>
        <TextInput
          testID="grocery-add-input"
          accessibilityLabel="Add an item"
          style={styles.input}
          value={term}
          onChangeText={onChangeTerm}
          placeholder="oat milk"
          placeholderTextColor={colors.muted}
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
        <Pressable
          testID="grocery-add-submit"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={[styles.addButton, busy && styles.buttonBusy]}
          onPress={onSubmit}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  region: { gap: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heading: {
    color: colors.brass,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  statusGlyph: { color: colors.brass, fontSize: 16 },
  statusText: { color: colors.brass, fontSize: 16, fontWeight: '700' },
  centeredRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { color: colors.muted, fontSize: 18 },
  addRow: { gap: 8 },
  label: { color: colors.muted, fontSize: 15 },
  addControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: {
    flex: 1,
    minHeight: 44,
    color: colors.ink,
    fontSize: 18,
    backgroundColor: colors.page,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  addButton: {
    minHeight: 44,
    minWidth: 88,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingHorizontal: 20,
  },
  addButtonText: { color: colors.brass, fontSize: 16, fontWeight: '600' },
  buttonBusy: { opacity: 0.5 },
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
  itemName: { color: colors.ink, fontSize: 18, flexShrink: 1 },
  itemQuantity: { color: colors.muted, fontSize: 18, fontVariant: ['tabular-nums'] },
  suggestions: { gap: 6 },
  suggestion: { color: colors.ink, fontSize: 16 },
  notice: { color: colors.muted, fontSize: 16 },
  confirmButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.brass,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  confirmText: { color: colors.page, fontSize: 17, fontWeight: '700' },
});
