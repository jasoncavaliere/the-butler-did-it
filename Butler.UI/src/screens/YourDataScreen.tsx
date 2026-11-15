import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/FormControls';
import { Screen, colors } from '../components/Screen';
import { space, typeScale } from '../theme/theme';
import { useOrganizer } from '../state/OrganizerContext';

/**
 * Every word the Your data page shows. The screen renders only from this
 * constant, so the plain-ASCII test scans every string a reader sees.
 *
 * The table list mirrors every `AddTableRepository` registration in the API:
 * the nine household tables, the usage events table (#122), and the one
 * deployment-wide install marker (Datasets). Keep it in step when a table is
 * added or removed.
 */
export const YOUR_DATA_COPY = {
  heading: 'Your data',
  intro: 'Here is what Butler keeps, where it keeps it, and how to clear it all away.',
  stored: {
    heading: 'What Butler stores',
    tables: [
      {
        table: 'Households',
        label: 'Households',
        detail: 'The household name and who set it up.',
      },
      {
        table: 'People',
        label: 'People',
        detail: "Each member's first name, whether they are a child, and their claim colour.",
      },
      { table: 'Rooms', label: 'Rooms', detail: 'The rooms you named, in your order.' },
      {
        table: 'Chores',
        label: 'Chores',
        detail: 'Each chore, its room, how often it repeats, and how much effort it takes.',
      },
      { table: 'Assignments', label: 'Assignments', detail: 'Who has which chore each week.' },
      {
        table: 'ChoreCompletions',
        label: 'Chore completions',
        detail: 'Who marked a chore done, and when.',
      },
      { table: 'Carts', label: 'Carts', detail: "Each week's grocery cart and who confirmed it." },
      {
        table: 'CartItems',
        label: 'Cart items',
        detail: 'What is in the cart, how many, and who added it.',
      },
      {
        table: 'HubDevices',
        label: 'Hub devices',
        detail: 'The name of each paired tablet and when it was last seen.',
      },
      {
        table: 'Events',
        label: 'Usage events',
        detail:
          'What was tapped and when, such as a chore marked done or a glance at the hub. It holds ids only, never a name or anything said.',
      },
      {
        table: 'Datasets',
        label: 'Install marker',
        detail:
          'One id for this Butler install, so the tablet notices when the data is reset. It holds no household details.',
      },
    ],
    onTablet:
      'The tablet also keeps a copy of the board and any taps waiting to sync, so it keeps working offline.',
  },
  kids: {
    heading: "Kids' profiles",
    lines: [
      "A child's profile holds only a first name, a child flag, and a claim colour.",
      'No last name, birthday, photo, email, or password. Kids tap their name on the hub; they never sign in.',
      'The child flag only keeps grown-up chores off their list.',
    ],
  },
  local: {
    heading: 'It stays at home',
    lines: [
      "This demo runs locally, on the organizer's computer.",
      'No household data leaves the home. Grocery orders go to a practice store, not a real shop.',
      "The grocery mic uses the browser's own speech recognition, which some browsers run online. Butler keeps only the words added to the cart.",
    ],
  },
  deletion: {
    heading: 'Deleting everything',
    lines: [
      "Signed in as the organizer, choose Delete household, then type the household's name exactly to confirm.",
      "Deleting removes all of the household's data: people, rooms, chores, assignments and their history, carts, usage events, and paired tablets.",
      'It cannot be undone.',
    ],
    link: 'Delete household',
  },
} as const;

/**
 * The Your data route (#125): a plain-language page saying what Butler stores,
 * what a child's profile holds, that the demo stays on the organizer's
 * computer, and how to delete the household.
 *
 * It is static copy on purpose: no API call and no household read, so it reads
 * correctly offline and shows no household data. It is not wrapped in
 * OrganizerGate because it holds nothing sensitive and its only entry point,
 * the organizer bar's Your data button, already appears only for a signed-in
 * organizer. A signed-in organizer also sees a Delete household link here that
 * opens the household teardown screen (#168), when the navigator supplies
 * {@link onOpenTeardown}.
 */
export function YourDataScreen({
  onOpenTeardown,
}: {
  /** Opens the household teardown screen (#168). When omitted, the link is not rendered. */
  onOpenTeardown?: () => void;
}) {
  const copy = YOUR_DATA_COPY;
  const { organizer } = useOrganizer();
  return (
    <Screen testID="your-data-screen">
      <Text style={styles.heading} accessibilityRole="header">
        {copy.heading}
      </Text>
      <Text style={styles.body}>{copy.intro}</Text>

      <View style={styles.section} testID="your-data-stored">
        <SectionHeading text={copy.stored.heading} />
        {copy.stored.tables.map((row) => (
          <View key={row.table} style={styles.row} testID={`your-data-table-${row.table}`}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.detail}>{row.detail}</Text>
          </View>
        ))}
        <Text style={styles.body}>{copy.stored.onTablet}</Text>
      </View>

      <Section testID="your-data-kids" heading={copy.kids.heading} lines={copy.kids.lines} />
      <Section testID="your-data-local" heading={copy.local.heading} lines={copy.local.lines} />
      <Section
        testID="your-data-delete"
        heading={copy.deletion.heading}
        lines={copy.deletion.lines}
      >
        {organizer !== null && onOpenTeardown ? (
          <ActionButton testID="your-data-teardown-link" variant="secondary" onPress={onOpenTeardown}>
            {copy.deletion.link}
          </ActionButton>
        ) : null}
      </Section>
    </Screen>
  );
}

function SectionHeading({ text }: { text: string }) {
  return (
    <Text style={styles.subhead} accessibilityRole="header">
      {text}
    </Text>
  );
}

function Section({
  testID,
  heading,
  lines,
  children,
}: {
  testID: string;
  heading: string;
  lines: readonly string[];
  children?: ReactNode;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <SectionHeading text={heading} />
      {lines.map((line) => (
        <Text key={line} style={styles.body}>
          {line}
        </Text>
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: typeScale.title,
    fontWeight: '700',
    marginBottom: space.s2,
  },
  subhead: { color: colors.ink, fontSize: typeScale.subhead, fontWeight: '700' },
  body: { color: colors.ink, fontSize: typeScale.body, marginTop: space.s2 },
  section: { marginTop: space.s6 },
  row: { marginTop: space.s3 },
  label: { color: colors.ink, fontSize: typeScale.body, fontWeight: '700' },
  detail: { color: colors.muted, fontSize: typeScale.body },
});
