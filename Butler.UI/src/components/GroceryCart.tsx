import { useCallback, useEffect, useState, type ComponentRef, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ApiError } from '../api/client';
import { describeApiError } from '../api/errors';
import type {
  AddCartItemRequest,
  CaptureResponse,
  CartItemView,
  CartResponse,
  StoreProductView,
} from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { useOrganizer } from '../state/OrganizerContext';
import { useSpeechCapture } from '../voice/useSpeechCapture';
import { colors } from './Screen';
import { WidgetEmpty, WidgetError, WidgetSkeleton } from './WidgetState';

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
 *   An ambiguous term comes back with `suggestions`; no outcome is ever a
 *   silent failure.
 * - **Custom item (#113).** A term the catalog cannot match comes back as a
 *   `200` with outcome `NoMatch`, and the region offers `Add "<term>" as a custom
 *   item`. Tapping it posts `/carts/{weekIso}/items` with that name and re-reads
 *   the cart. A custom line shows a `Custom` tag; it has no price, so the
 *   estimated total under the list says how many custom items it leaves out.
 * - **Confirm (G4).** Organizer-only, and *absent* rather than disabled without
 *   one, matching the {@link OrganizerBar} convention. It posts to
 *   `/carts/{weekIso}/confirm` with the cart's `eTag` as `If-Match`
 *   (Engineering Contract 7.3). This gate is convenience: the API independently
 *   enforces `403` for a participant or the paired hub device. The
 *   {@link OrganizerBar}'s Confirm order only jumps here (through `confirmRef`);
 *   it never confirms on its own. A successful confirm also hands the confirm
 *   response to `onConfirmed`, which {@link HubShell} uses to show the order
 *   receipt (#115); the region's own Confirmed state is the same either way.
 * - **Voice (#116).** Where the browser has speech recognition (`SpeechRecognition`
 *   or `webkitSpeechRecognition`), a Speak button sits beside Add; where it does
 *   not, the button is absent, not disabled. One tap listens for one utterance
 *   (the region says `Listening...` until recognition ends), shows what it heard,
 *   and posts that transcript to `/capture/voice` with no confirm tap. The answer
 *   is handled exactly as a typed add's is (added, suggestions, or the custom-item
 *   offer). A recognition error or an empty result posts nothing and says so, and
 *   the cart stays usable.
 *
 * Nothing here places a real order and no money moves (BRD decision D-8) - the
 * backing connector is the simulated G1 one, so the demo runs fully offline of
 * any real store.
 *
 * Every outcome is a deliberate, calm state so the wall never shows a crash or a
 * blank region (P8, ADR-0007): a skeleton while the cart loads, a designed empty
 * state for an empty building cart, the confirmed week, or a friendly load error
 * (fixed copy, never the raw API text) with a "Try again" that re-reads the cart.
 */

/** The cart lifecycle values the API returns (mirrors the API's `CartStatus`). */
const CONFIRMED = 'Confirmed';

/** Copy, kept in one place so the concierge voice stays consistent. */
const COPY = {
  loading: "Checking this week's list...",
  emptyTitle: 'The list is clear.',
  emptyDetail: 'Add the first thing you need.',
  loadFailed: "This week's list did not load. Tap Try again.",
  needsTerm: 'Type what to add, for example "oat milk".',
  needsParticipant: 'Tap your name first, then add to the list.',
  ambiguous: 'Did you mean one of these? Type the one you want.',
  voiceMissed: 'I did not catch that. Tap Speak to try again, or type it.',
  confirmFailed: 'That did not go through. Tap Confirm order to try again.',
  weekConfirmed: "This week's list is confirmed. Nothing more to add.",
} as const;

/** The no-match offer's button copy (AC3 fixes its wording). */
export function customOfferLabel(displayName: string): string {
  return `Add "${displayName}" as a custom item`;
}

/** The line showing what the mic heard, before and while it is sent (#116). */
export function heardLabel(transcript: string): string {
  return `Heard "${transcript}"`;
}

/** The estimated-total line, in dollars to the cent. */
export function estimatedTotalLabel(total: number): string {
  return `Estimated total $${total.toFixed(2)}`;
}

/** The note under the total naming how many custom items it leaves out. */
export function unpricedNote(count: number): string {
  return count === 1 ? 'Plus 1 custom item, not priced.' : `Plus ${count} custom items, not priced.`;
}

/** A pending no-match offer: the name to add and whom it is attributed to. */
type CustomOffer = { displayName: string; personId: string };

/**
 * What the region is showing. `confirmed` is the week-already-confirmed answer to
 * the current-cart read (a `409`), which carries no cart body - distinct from a
 * loaded cart whose own `status` is `Confirmed`, which does.
 */
type CartState =
  | { phase: 'loading' }
  | { phase: 'ready'; cart: CartResponse }
  | { phase: 'confirmed' }
  | { phase: 'error' };

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
  confirmRef,
  onConfirmed,
}: {
  householdId: string;
  /** The hub's active tap-to-claim participant, whom an added line is attributed to. */
  activePersonId: string | null;
  /**
   * Attached to the Confirm order button, so the hub can move focus to it from
   * the {@link OrganizerBar}'s Confirm order while the cart still owns the
   * confirm itself (the final tap stays here, G4).
   */
  confirmRef?: Ref<ComponentRef<typeof View>>;
  /**
   * Called once with the confirm response (G4) after a successful confirm, and
   * never for a failed one, so the hub can show the order receipt (#115).
   */
  onConfirmed?: (cart: CartResponse) => void;
}) {
  const client = useApiClient();
  const { isSignedIn } = useOrganizer();
  const [state, setState] = useState<CartState>({ phase: 'loading' });
  const [term, setTerm] = useState('');
  const [notice, setNotice] = useState('');
  const [suggestions, setSuggestions] = useState<StoreProductView[]>([]);
  const [customOffer, setCustomOffer] = useState<CustomOffer | null>(null);
  const [busy, setBusy] = useState(false);
  // The last transcript the mic heard (#116), shown above the notice.
  const [heard, setHeard] = useState<string | null>(null);
  const voice = useSpeechCapture();

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
    return { phase: 'error' };
  }, [client, householdId]);

  // Bumped by "Try again"; listed in the load effect's deps so a bump re-reads.
  const [loadRevision, setLoadRevision] = useState(0);

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
  }, [readCart, loadRevision]);

  // Loading is set here, in the event handler, never synchronously in the effect.
  const retryLoad = useCallback(() => {
    setState({ phase: 'loading' });
    setLoadRevision((previous) => previous + 1);
  }, []);

  // Capturing: resolve an utterance through G3 (typed to `/capture/text`, spoken
  // to `/capture/voice`) and re-read the cart. The line is attributed to the
  // active participant, because the shared tablet authenticates as a device or
  // organizer rather than as a person - with nobody claimed, say so plainly
  // instead of spending a round trip on a 400.
  const submitCapture = useCallback(
    async (route: 'text' | 'voice', utterance: string, cart: CartResponse) => {
      if (activePersonId === null) {
        setNotice(COPY.needsParticipant);
        return;
      }

      setNotice('');
      setBusy(true);
      const result = await client.update<CaptureResponse>(
        `/households/${householdId}/capture/${route}`,
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

      const captured = result.data;
      if (captured.outcome === 'NoMatch' || captured.item === null) {
        // Nothing in the catalog: offer the term itself as a custom item. A typed
        // term stays in the field so it can be refined instead.
        setCustomOffer({ displayName: captured.resolvedTerm, personId: activePersonId });
        setNotice(`The store has nothing matching "${captured.resolvedTerm}".`);
        setBusy(false);
        return;
      }

      // Only a typed add owns the field; a spoken one leaves whatever is typed.
      if (route === 'text') {
        setTerm('');
      }
      setNotice(`Added ${captured.item.displayName}.`);
      setState(await readCart());
      setBusy(false);
    },
    [activePersonId, client, householdId, readCart],
  );

  // Adding a typed term.
  const add = useCallback(
    async (cart: CartResponse) => {
      const utterance = term.trim();
      setSuggestions([]);
      // A new add replaces whatever an earlier no-match offered or the mic heard.
      setCustomOffer(null);
      setHeard(null);
      if (utterance === '') {
        setNotice(COPY.needsTerm);
        return;
      }
      await submitCapture('text', utterance, cart);
    },
    [submitCapture, term],
  );

  // Adding by voice (#116): listen for one utterance, show it, and send it with
  // no confirm tap. A miss (an error, nothing heard) never calls the API and
  // never blocks the cart - it says so and the mic and the field stay ready.
  const listen = useCallback(
    (cart: CartResponse) => {
      setSuggestions([]);
      setCustomOffer(null);
      setHeard(null);
      if (activePersonId === null) {
        setNotice(COPY.needsParticipant);
        return;
      }
      setNotice('');
      voice.start({
        onTranscript: (transcript) => {
          setHeard(transcript);
          void submitCapture('voice', transcript, cart);
        },
        onFailure: () => setNotice(COPY.voiceMissed),
      });
    },
    [activePersonId, submitCapture, voice],
  );

  // Adding the no-match term as a custom line (#113): no product and no price,
  // attributed to whoever made the capture, then the cart is re-read so the list
  // and the confirm's `If-Match` stay the server's truth.
  const addCustom = useCallback(
    async (cart: CartResponse, offer: CustomOffer) => {
      setNotice('');
      setBusy(true);
      const body: AddCartItemRequest = {
        displayName: offer.displayName,
        personId: offer.personId,
        quantity: 1,
      };
      const result = await client.update<CartItemView>(
        `/households/${householdId}/carts/${cart.weekIso}/items`,
        body,
        { method: 'POST' },
      );

      if (!result.ok) {
        // Keep the offer so the shopper can simply tap it again.
        setNotice(describeApiError(result.error));
        setBusy(false);
        return;
      }

      setTerm('');
      setCustomOffer(null);
      setNotice(`Added ${result.data.displayName} as a custom item.`);
      setState(await readCart());
      setBusy(false);
    },
    [client, householdId, readCart],
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
      onConfirmed?.(result.data);
    },
    [client, householdId, onConfirmed],
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
        <WidgetSkeleton testID="grocery-cart-loading" caption={COPY.loading} />
      ) : null}

      {state.phase === 'error' ? (
        <WidgetError
          testID="grocery-cart-error"
          message={COPY.loadFailed}
          onRetry={retryLoad}
          retryTestID="grocery-cart-retry"
        />
      ) : null}

      {state.phase === 'confirmed' ? (
        <Text style={styles.status} testID="grocery-cart-week-confirmed">
          {COPY.weekConfirmed}
        </Text>
      ) : null}

      {cart !== null && !isConfirmed ? (
        <>
          <AddItemRow
            term={term}
            busy={busy}
            onChangeTerm={setTerm}
            onSubmit={() => {
              void add(cart);
            }}
            voiceSupported={voice.supported}
            listening={voice.listening}
            onListen={() => listen(cart)}
          />
          {customOffer !== null ? (
            <Pressable
              testID="grocery-add-custom"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.customButton, busy && styles.buttonBusy]}
              onPress={() => {
                void addCustom(cart, customOffer);
              }}
            >
              <Text style={styles.addButtonText}>{customOfferLabel(customOffer.displayName)}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {cart !== null ? (
        <View style={styles.list} testID="grocery-cart-list">
          {items.length === 0 ? (
            <WidgetEmpty
              testID="grocery-cart-empty"
              title={COPY.emptyTitle}
              detail={COPY.emptyDetail}
            />
          ) : (
            items.map((item) => (
              <View key={item.itemId} style={styles.item} testID={`grocery-item-${item.itemId}`}>
                <View style={styles.itemLabel}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  {/* A custom line is marked with a word, never colour alone. */}
                  {item.isCustom ? (
                    <Text style={styles.customTag} testID={`grocery-item-custom-${item.itemId}`}>
                      Custom
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.itemQuantity} testID={`grocery-item-quantity-${item.itemId}`}>
                  {`x${item.quantity}`}
                </Text>
              </View>
            ))
          )}
          {items.length > 0 ? (
            <View style={styles.totals}>
              <Text style={styles.total} testID="grocery-cart-total">
                {estimatedTotalLabel(cart.estimatedTotal)}
              </Text>
              {cart.customItemCount > 0 ? (
                <Text style={styles.notice} testID="grocery-cart-unpriced-note">
                  {unpricedNote(cart.customItemCount)}
                </Text>
              ) : null}
            </View>
          ) : null}
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

      {heard !== null ? (
        <Text style={styles.heard} testID="grocery-voice-transcript">
          {heardLabel(heard)}
        </Text>
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
          ref={confirmRef}
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
 * minimum touch target. Where the browser can recognize speech, a Speak button
 * sits beside Add (absent, not disabled, where it cannot); while it listens its
 * label reads `Listening...`, so the state is carried by a word, not colour.
 */
function AddItemRow({
  term,
  busy,
  onChangeTerm,
  onSubmit,
  voiceSupported,
  listening,
  onListen,
}: {
  term: string;
  busy: boolean;
  onChangeTerm: (next: string) => void;
  onSubmit: () => void;
  voiceSupported: boolean;
  listening: boolean;
  onListen: () => void;
}) {
  const micDisabled = busy || listening;
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
        {voiceSupported ? (
          <Pressable
            testID="grocery-voice"
            accessibilityRole="button"
            accessibilityLabel="Add an item by voice"
            accessibilityState={{ disabled: micDisabled, busy: listening }}
            disabled={micDisabled}
            style={[styles.addButton, micDisabled && styles.buttonBusy]}
            onPress={onListen}
          >
            {listening ? (
              <Text style={styles.addButtonText} testID="grocery-voice-listening">
                Listening...
              </Text>
            ) : (
              <Text style={styles.addButtonText}>Speak</Text>
            )}
          </Pressable>
        ) : null}
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
  itemLabel: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  itemName: { color: colors.ink, fontSize: 18, flexShrink: 1 },
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
  totals: { gap: 4, paddingTop: 4 },
  total: { color: colors.ink, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  customButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  itemQuantity: { color: colors.muted, fontSize: 18, fontVariant: ['tabular-nums'] },
  suggestions: { gap: 6 },
  suggestion: { color: colors.ink, fontSize: 16 },
  notice: { color: colors.muted, fontSize: 16 },
  heard: { color: colors.ink, fontSize: 16 },
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
