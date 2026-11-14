import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { InsightsResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { OrganizerGate } from '../auth/OrganizerGate';
import {
  BarChart,
  ChartCard,
  GroupedBarChart,
  Legend,
  type BarGroup,
  type ChartBar,
} from '../components/InsightsCharts';
import { Screen, colors } from '../components/Screen';
import {
  INSIGHTS_WEEKS,
  barFraction,
  dayLabel,
  formatShare,
  monthLabel,
  resolveMemberColors,
  weekLabel,
} from '../insights/insightsSeries';
import { minTouchTarget, space, typeScale } from '../layout/tokens';
import { useHousehold } from '../state/HouseholdContext';

/**
 * The Insights route (#123): the organizer's view of how the household is doing,
 * behind the organizer auth gate. A visitor the API does not accept as the
 * organizer is blocked by {@link OrganizerGate} and never reaches the dashboard.
 */
export function InsightsScreen() {
  return (
    <OrganizerGate>
      <InsightsDashboard />
    </OrganizerGate>
  );
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; insights: InsightsResponse };

const COPY = {
  heading: 'Insights',
  noHousehold: 'No household is selected yet.',
  loading: 'Gathering the numbers...',
  loadFailed: 'Insights did not load just now. Tap Try again.',
  retry: 'Try again',
} as const;

/**
 * Reads `GET /households/{id}/insights?weeks=8` and draws its four series as
 * View-based bar charts: the top contributor's share per week, completions per
 * member per week, hub glances per day and confirmed carts per month. Each
 * person's series uses their claim colour, and all text is at least the 18px
 * token body size (ADR-0004).
 */
export function InsightsDashboard() {
  const client = useApiClient();
  const { householdId } = useHousehold();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  // Bumped by "Try again"; listed in the load effect's deps so a bump re-reads.
  const [reloadRevision, setReloadRevision] = useState(0);

  useEffect(() => {
    if (householdId === null) {
      return;
    }
    let active = true;

    client
      .get<InsightsResponse>(`/households/${householdId}/insights?weeks=${INSIGHTS_WEEKS}`)
      .then((result) => {
        if (!active) {
          return;
        }
        setState(result.ok ? { phase: 'ready', insights: result.data } : { phase: 'error' });
      });

    return () => {
      active = false;
    };
  }, [client, householdId, reloadRevision]);

  // Loading is set here, in the event handler, never synchronously in the effect.
  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setReloadRevision((previous) => previous + 1);
  }, []);

  if (householdId === null) {
    return (
      <Screen testID="insights-screen">
        <Heading />
        <Text style={styles.body} testID="insights-no-household">
          {COPY.noHousehold}
        </Text>
      </Screen>
    );
  }

  if (state.phase === 'loading') {
    return (
      <Screen testID="insights-screen">
        <Heading />
        <Text style={styles.body} testID="insights-loading">
          {COPY.loading}
        </Text>
      </Screen>
    );
  }

  if (state.phase === 'error') {
    return (
      <Screen testID="insights-screen">
        <Heading />
        <Text style={styles.body} testID="insights-error">
          {COPY.loadFailed}
        </Text>
        <Pressable
          accessibilityRole="button"
          testID="insights-retry"
          style={styles.retry}
          onPress={retry}
        >
          <Text style={styles.retryText}>{COPY.retry}</Text>
        </Pressable>
      </Screen>
    );
  }

  return <InsightsCharts insights={state.insights} />;
}

function Heading() {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {COPY.heading}
    </Text>
  );
}

/**
 * The four charts. They always render when ready, even when every value is zero.
 * The API lists every top contributor and every completions row in `members`
 * (off-roster people included), so colour and name lookups always resolve.
 */
function InsightsCharts({ insights }: { insights: InsightsResponse }) {
  const memberColors = resolveMemberColors(insights.members);
  const names: Record<string, string> = {};
  for (const member of insights.members) {
    names[member.personId] = member.displayName;
  }

  const topShareBars: ChartBar[] = insights.weeks.map((week) => {
    const top = week.topContributorPersonId;
    const label = weekLabel(week.weekIso);
    const share = formatShare(week.topContributorShare);
    return {
      key: week.weekIso,
      fraction: barFraction(week.topContributorShare, 1),
      color: top === null ? colors.muted : memberColors[top],
      label,
      value: share,
      caption: top === null ? '-' : names[top],
      accessibilityLabel:
        top === null ? `${label}: no completed effort` : `${label}: ${names[top]} did ${share}`,
    };
  });

  const maxCompletions = Math.max(
    0,
    ...insights.weeks.flatMap((week) => week.completions.map((entry) => entry.completions)),
  );
  const completionGroups: BarGroup[] = insights.weeks.map((week) => ({
    key: week.weekIso,
    label: weekLabel(week.weekIso),
    bars: week.completions.map((entry) => ({
      key: `${week.weekIso}-${entry.personId}`,
      fraction: barFraction(entry.completions, maxCompletions),
      color: memberColors[entry.personId],
      accessibilityLabel: `${weekLabel(week.weekIso)}: ${names[entry.personId]} completed ${entry.completions}`,
    })),
  }));

  const glances = insights.glancesPerDay;
  const maxGlances = Math.max(0, ...glances.map((day) => day.count));
  const totalGlances = glances.reduce((sum, day) => sum + day.count, 0);
  const glanceBars: ChartBar[] = glances.map((day) => ({
    key: day.date,
    fraction: barFraction(day.count, maxGlances),
    color: colors.brass,
    accessibilityLabel: `${dayLabel(day.date)}: ${day.count} glances`,
  }));

  const carts = insights.cartsConfirmedPerMonth;
  const maxCarts = Math.max(0, ...carts.map((month) => month.count));
  const cartBars: ChartBar[] = carts.map((month) => ({
    key: month.month,
    fraction: barFraction(month.count, maxCarts),
    color: colors.brass,
    label: monthLabel(month.month),
    value: String(month.count),
    accessibilityLabel: `${monthLabel(month.month)}: ${month.count} carts confirmed`,
  }));

  return (
    <Screen testID="insights-screen">
      <Heading />
      <Text style={styles.body}>Last {insights.windowWeeks} weeks</Text>

      <ChartCard testID="insights-chart-top-share" title="Top contributor's share">
        <BarChart testID="insights-chart-top-share" bars={topShareBars} />
      </ChartCard>

      <ChartCard
        testID="insights-chart-completions"
        title="Completions per person"
        footer={
          <Legend
            testID="insights-legend"
            items={insights.members.map((member) => ({
              key: member.personId,
              label: member.displayName,
              color: memberColors[member.personId],
            }))}
          />
        }
      >
        <GroupedBarChart testID="insights-chart-completions" groups={completionGroups} />
      </ChartCard>

      <ChartCard
        testID="insights-chart-glances"
        title="Hub glances per day"
        footer={
          <>
            {glances.length > 0 ? (
              <View style={styles.axis}>
                <Text style={styles.axisText}>{dayLabel(glances[0].date)}</Text>
                <Text style={styles.axisText}>{dayLabel(glances[glances.length - 1].date)}</Text>
              </View>
            ) : null}
            <Text style={styles.body} testID="insights-glances-total">
              {totalGlances} glances in total
            </Text>
          </>
        }
      >
        <BarChart testID="insights-chart-glances" bars={glanceBars} />
      </ChartCard>

      <ChartCard testID="insights-chart-carts" title="Carts confirmed per month">
        <BarChart testID="insights-chart-carts" bars={cartBars} />
      </ChartCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: typeScale.title,
    fontWeight: '700',
    marginBottom: space.s2,
  },
  body: { color: colors.ink, fontSize: typeScale.body, marginTop: space.s2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s1 },
  axisText: { color: colors.muted, fontSize: typeScale.body },
  retry: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    marginTop: space.s4,
    paddingHorizontal: space.s4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.brass,
  },
  retryText: { color: colors.brass, fontSize: typeScale.body, fontWeight: '600' },
});
