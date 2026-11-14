import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { space, typeScale } from '../layout/tokens';
import { colors } from './Screen';

/**
 * View-based charts for the organizer Insights screen (#123). They are plain
 * Views (a fixed-height track with a bar sized to a fraction of it), so no chart
 * or SVG dependency is needed. Every Text is at least the token body size (18px,
 * the ADR-0004 floor): chart titles use the subhead size and every other label
 * the body size.
 */

const TRACK_HEIGHT = 120;

/** One bar: its height as a fraction of the track, its colour, and its labels. */
export type ChartBar = {
  key: string;
  /** The bar's height as a fraction of the track, in [0, 1]. */
  fraction: number;
  color: string;
  accessibilityLabel: string;
  /** Shown under the track; omitted for dense series. */
  label?: string;
  /** Shown above the bar; omitted for dense series. */
  value?: string;
  /** A second line under {@link label}, for example the top contributor's name. */
  caption?: string;
};

/** A titled chart region with an optional footer, shared by every chart. */
export function ChartCard({
  testID,
  title,
  footer,
  children,
}: {
  testID: string;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {children}
      {footer}
    </View>
  );
}

/** A single bar inside a fixed-height track. */
function Bar({ testID, bar }: { testID: string; bar: ChartBar }) {
  return (
    <View style={styles.track}>
      <View
        testID={`${testID}-bar-${bar.key}`}
        accessibilityLabel={bar.accessibilityLabel}
        style={[styles.bar, { height: `${bar.fraction * 100}%`, backgroundColor: bar.color }]}
      />
    </View>
  );
}

/** A vertical bar chart: one column per bar, with its optional value and labels. */
export function BarChart({ testID, bars }: { testID: string; bars: ChartBar[] }) {
  return (
    <View style={styles.columns} testID={`${testID}-bars`}>
      {bars.map((bar) => (
        <View key={bar.key} style={styles.column}>
          {bar.value !== undefined ? (
            <Text style={styles.value} numberOfLines={1}>
              {bar.value}
            </Text>
          ) : null}
          <Bar testID={testID} bar={bar} />
          {bar.label !== undefined ? (
            <Text style={styles.label} numberOfLines={1}>
              {bar.label}
            </Text>
          ) : null}
          {bar.caption !== undefined ? (
            <Text style={styles.caption} numberOfLines={1}>
              {bar.caption}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** One group of bars (for example one week, with a bar per member). */
export type BarGroup = {
  key: string;
  label: string;
  bars: ChartBar[];
};

/** A grouped bar chart: one column per group, holding one thin bar per series. */
export function GroupedBarChart({ testID, groups }: { testID: string; groups: BarGroup[] }) {
  return (
    <View style={styles.columns} testID={`${testID}-groups`}>
      {groups.map((group) => (
        <View key={group.key} style={styles.column}>
          <View style={styles.group}>
            {group.bars.map((bar) => (
              <View key={bar.key} style={styles.groupBar}>
                <Bar testID={testID} bar={bar} />
              </View>
            ))}
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {group.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** One legend entry: a colour swatch and a name. */
export type LegendItem = { key: string; label: string; color: string };

/** The series legend: a swatch per person, in their series colour. */
export function Legend({ testID, items }: { testID: string; items: LegendItem[] }) {
  return (
    <View style={styles.legend} testID={testID}>
      {items.map((item) => (
        <View key={item.key} style={styles.legendItem} testID={`${testID}-${item.key}`}>
          <View
            testID={`${testID}-${item.key}-swatch`}
            style={[styles.swatch, { backgroundColor: item.color }]}
          />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.s6,
    paddingTop: space.s4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: {
    color: colors.ink,
    fontSize: typeScale.subhead,
    fontWeight: '700',
    marginBottom: space.s3,
  },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s1 },
  column: { flex: 1, alignItems: 'center', minWidth: 0 },
  track: {
    height: TRACK_HEIGHT,
    width: '100%',
    justifyContent: 'flex-end',
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: { width: '100%', borderRadius: 4 },
  group: { flexDirection: 'row', width: '100%', gap: 2 },
  groupBar: { flex: 1 },
  value: { color: colors.ink, fontSize: typeScale.body, fontWeight: '600' },
  label: { color: colors.muted, fontSize: typeScale.body, marginTop: space.s1 },
  caption: { color: colors.ink, fontSize: typeScale.body },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3, marginTop: space.s3 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  swatch: { width: 18, height: 18, borderRadius: 4 },
  legendText: { color: colors.ink, fontSize: typeScale.body },
});
