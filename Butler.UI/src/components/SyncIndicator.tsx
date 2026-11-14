import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useBrowserOnline } from '../offline/useBrowserOnline';
import type { ReconnectTarget } from '../offline/useReconnect';
import { useWriteQueueContext } from '../offline/WriteQueueContext';
import { useOrganizer } from '../state/OrganizerContext';
import { colors } from './Screen';

/**
 * The hub's sync indicator (Epic 60 O4).
 *
 * O2 kept the glance alive offline and O3 kept taps from being lost; this is the
 * part that tells the family what is going on. It is one quiet row of status
 * chips in the hub header - never a banner, a modal, or an alarm, and never over
 * the name tiles or the board (it sits in the header's normal flow):
 *
 * - *Connection*, always shown: `Online` or `Offline`. Offline is the browser's
 *   own `offline` event, **or** the queue's last drain not reaching the API, **or**
 *   the hub serving last-known data (`apiUnreachable`, which the hub derives from
 *   O2's cache - and that cache only ever serves on a network failure). So a
 *   tablet whose wifi is up but whose API is down reads Offline once a drain
 *   fails or a region is served from cache, until a drain or a reload actually
 *   gets through (a confirming drain also makes the hub reload its cached
 *   regions, which clears `apiUnreachable`). With no cache and an empty queue
 *   neither signal fires, so it reads Online beside the shell's error - a known
 *   gap tracked in #151.
 * - *Pending*, while writes are queued: `2 waiting to sync`. Hidden at zero.
 * - *Synced*, briefly: `All synced.` once a drain confirms the queue empty, for
 *   {@link SYNC_CONFIRMATION_MS}. Nothing to dismiss; it simply goes. While any
 *   write is flagged failed it says only `Synced.` - the confirmed writes did
 *   sync, but "all" would contradict the failed segment beside it.
 * - *Failed*, while any write exhausted its retries: `1 change did not go
 *   through`, in the danger colour. It is **never** auto-cleared and has no
 *   dismiss - a tap on the same chore again revives that write (O3), which is
 *   what clears it. A signed-in organizer also sees which writes failed and why.
 *
 * Meaning is always carried by a glyph and text, never by colour alone
 * (ADR-0010), and the indicator is a polite live region so a screen reader hears
 * the state change without being interrupted.
 */

/** How long the "All synced." confirmation stays before it quietly goes. */
export const SYNC_CONFIRMATION_MS = 4_000;

/** A queued write's kind, in words, for the organizer's failed-write detail. */
export function describeQueuedWrite(kind: string): string {
  switch (kind) {
    case 'chore-complete':
      return 'Marking a chore done';
    case 'chore-undo':
      return 'Undoing a chore';
    case 'cart-add':
      return 'Adding to the cart';
    case 'hub-glance':
      return 'Recording a hub view';
    default:
      return 'A change';
  }
}

/** The failed segment's copy for `count` flagged writes. */
export function failedLabel(count: number): string {
  return count === 1 ? '1 change did not go through' : `${count} changes did not go through`;
}

/** What a failed write's detail row says when the queue recorded no reason. */
const UNKNOWN_FAILURE = 'It could not be synced.';

export function SyncIndicator({
  apiUnreachable = false,
  connectivityTarget,
}: {
  /** Whether the hub is serving any region from the last-known cache (O2). */
  apiUnreachable?: boolean;
  /** Override the browser event target (tests inject one; default is ambient). */
  connectivityTarget?: ReconnectTarget;
}) {
  const browserOnline = useBrowserOnline(connectivityTarget);
  const { entries, pending, failed, confirmedRevision, unreachable } = useWriteQueueContext();
  const { isSignedIn } = useOrganizer();

  // The confirmation is derived, not stored: it shows while the queue has
  // confirmed more runs than this indicator has already let go of. Starting from
  // the current revision means a remount never replays an old confirmation.
  const [dismissedRevision, setDismissedRevision] = useState(confirmedRevision);
  useEffect(() => {
    if (confirmedRevision <= dismissedRevision) {
      return undefined;
    }
    const timer = setTimeout(() => setDismissedRevision(confirmedRevision), SYNC_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [confirmedRevision, dismissedRevision]);

  const offline = !browserOnline || unreachable || apiUnreachable;
  const showSynced = confirmedRevision > dismissedRevision && pending === 0;
  const failedEntries = entries.filter((entry) => entry.status === 'failed');

  const connectionText = offline ? 'Offline' : 'Online';
  const pendingText = `${pending} waiting to sync`;
  const syncedText = failed > 0 ? 'Synced.' : 'All synced.';
  const failedText = failedLabel(failed);

  const label = [
    connectionText,
    pending > 0 ? pendingText : null,
    showSynced ? syncedText : null,
    failed > 0 ? failedText : null,
  ]
    .filter((segment): segment is string => segment !== null)
    // A segment that already ends its sentence ("All synced.") takes no second
    // full stop before the next one.
    .reduce((joined, segment) =>
      joined === '' ? segment : `${joined}${joined.endsWith('.') ? ' ' : '. '}${segment}`,
    '');

  return (
    <View
      style={styles.indicator}
      testID="sync-indicator"
      role="status"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <View style={styles.chips}>
        <Chip testID="sync-indicator-connection" glyph={offline ? '○' : '●'} text={connectionText} />
        {pending > 0 ? <Chip testID="sync-indicator-pending" glyph={'◷'} text={pendingText} /> : null}
        {showSynced ? (
          <Chip testID="sync-indicator-synced" glyph={'✓'} text={syncedText} tone="success" />
        ) : null}
        {failed > 0 ? (
          <Chip testID="sync-indicator-failed" glyph="!" text={failedText} tone="danger" />
        ) : null}
      </View>

      {isSignedIn && failedEntries.length > 0 ? (
        <View style={styles.detail} testID="sync-indicator-failed-detail">
          {failedEntries.map((entry) => (
            <Text
              key={entry.dedupeKey}
              style={styles.detailRow}
              testID={`sync-indicator-failed-${entry.dedupeKey}`}
            >
              {`${describeQueuedWrite(entry.kind)}: ${entry.lastError ?? UNKNOWN_FAILURE}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One status chip: a glyph plus its words, styled after the offline-chip token. */
function Chip({
  testID,
  glyph,
  text,
  tone,
}: {
  testID: string;
  glyph: string;
  text: string;
  tone?: 'success' | 'danger';
}) {
  const toneStyle = tone === undefined ? null : { color: colors[tone] };
  return (
    <View style={[styles.chip, tone === 'danger' && styles.chipDanger]} testID={testID}>
      <Text style={[styles.glyph, toneStyle]} importantForAccessibility="no" aria-hidden>
        {glyph}
      </Text>
      <Text style={[styles.text, toneStyle]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: { gap: 8, alignItems: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipDanger: { borderColor: colors.danger },
  glyph: { color: colors.muted, fontSize: 16 },
  text: { color: colors.muted, fontSize: 18 },
  detail: { gap: 4, alignItems: 'flex-end' },
  detailRow: { color: colors.muted, fontSize: 16 },
});
