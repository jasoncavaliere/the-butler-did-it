import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { FairnessResponse, PersonShare } from '../api/models';
import { describeApiError } from '../api/errors';
import { useApiClient } from '../api/useApiClient';
import { colors } from './Screen';

/**
 * The hub fairness view (Epic 40 C6, journey 6.3): the contribution balance that
 * tells the household whether the load is shared. It reads the C6 aggregate
 * (`GET /households/{householdId}/fairness`) through the F7 typed client and
 * renders a per-person distribution - a labelled bar per person sized to their
 * share of the household's completed effort - with the top contributor's share
 * called out (the Section 10 fairness guardrail).
 *
 * It is a read-only glance: there is no tap target and no write. Every load
 * outcome is a calm, deliberate state (loading, error, an empty "nothing yet"
 * balance, or the ready distribution) so the wall never shows a crash or a blank
 * region. A person's claim colour accents their bar when supplied via
 * {@link people}; otherwise the neutral brass accent is used, and the top
 * contributor is always emphasised regardless of colour.
 */

type Phase = 'loading' | 'ready' | 'error';

/** A person's claim colour, keyed by id, so a bar can glow in their colour. */
export type FairnessPerson = { personId: string; claimColor: string | null };

function accentFor(personId: string, people: FairnessPerson[]): string {
  return people.find((person) => person.personId === personId)?.claimColor ?? colors.brass;
}

export function FairnessView({
  householdId,
  people = [],
  windowWeeks,
}: {
  householdId: string;
  people?: FairnessPerson[];
  windowWeeks?: number;
}) {
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [balance, setBalance] = useState<FairnessResponse | null>(null);

  useEffect(() => {
    let active = true;

    const query = windowWeeks === undefined ? '' : `?windowWeeks=${windowWeeks}`;
    client
      .get<FairnessResponse>(`/households/${householdId}/fairness${query}`)
      .then((result) => {
        if (!active) {
          return;
        }
        if (!result || !result.ok) {
          setMessage(result ? describeApiError(result.error) : 'The balance is unavailable.');
          setPhase('error');
          return;
        }
        setBalance(result.data ?? null);
        setPhase('ready');
      });

    return () => {
      active = false;
    };
  }, [client, householdId, windowWeeks]);

  if (phase === 'loading') {
    return (
      <View style={styles.centered} testID="fairness-loading">
        <ActivityIndicator color={colors.brass} />
        <Text style={styles.status}>Weighing the load...</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <Text style={styles.status} testID="fairness-error">
        {message}
      </Text>
    );
  }

  const shares = balance?.shares ?? [];
  const total = balance?.totalEffort ?? 0;
  const topId = balance?.topContributorPersonId ?? null;

  // A zero-total balance is the calm "nothing yet" state - a completed chore is
  // what fills this in, so before any completion there is simply no balance.
  if (shares.length === 0 || total === 0) {
    return (
      <View style={styles.view} testID="fairness-view">
        <Text style={styles.heading} accessibilityRole="header">
          Contribution balance
        </Text>
        <Text style={styles.status} testID="fairness-empty">
          No chores completed yet this stretch.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.view} testID="fairness-view">
      <Text style={styles.heading} accessibilityRole="header">
        Contribution balance
      </Text>
      {shares.map((share) => (
        <ShareBar
          key={share.personId}
          share={share}
          accent={accentFor(share.personId, people)}
          isTop={share.personId === topId}
        />
      ))}
    </View>
  );
}

/**
 * One person's row in the balance: their name, a bar filled to their share, and
 * the share as a percentage. The top contributor's row is emphasised - the
 * fairness guardrail the whole view exists to surface.
 */
function ShareBar({
  share,
  accent,
  isTop,
}: {
  share: PersonShare;
  accent: string;
  isTop: boolean;
}) {
  // Clamp to [0, 100] so an unexpected value can never blow out the layout.
  const pct = Math.max(0, Math.min(100, share.sharePercent));
  return (
    <View style={styles.row} testID={`fairness-row-${share.personId}`}>
      <View style={styles.labelRow}>
        <Text style={[styles.name, isTop && styles.nameTop]} numberOfLines={1}>
          {share.displayName}
          {isTop ? ' (top)' : ''}
        </Text>
        <Text
          style={[styles.percent, isTop && styles.nameTop]}
          testID={`fairness-percent-${share.personId}`}
        >
          {formatPercent(pct)}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          testID={`fairness-bar-${share.personId}`}
          style={[
            styles.fill,
            { width: `${pct}%`, backgroundColor: accent },
            isTop && styles.fillTop,
          ]}
        />
      </View>
    </View>
  );
}

/** A compact percentage label: no decimals for whole values, one otherwise. */
function formatPercent(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

const styles = StyleSheet.create({
  view: { alignSelf: 'stretch', gap: 12 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  status: { color: colors.muted, fontSize: 18, textAlign: 'center' },
  heading: {
    color: colors.brass,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  row: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  nameTop: { color: colors.brass },
  percent: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  track: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 6, minWidth: 2 },
  fillTop: { borderWidth: 1, borderColor: colors.brass },
});
