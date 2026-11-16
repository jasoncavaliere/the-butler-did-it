import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/FormControls';
import { Screen, colors } from '../components/Screen';
import { minTouchTarget, space, typeScale } from '../theme/theme';

/**
 * The full bring-your-own-tablet setup article (docs/17) on GitHub. The
 * Tablet setup screen links here instead of bundling the article.
 */
export const TABLET_SETUP_ARTICLE_URL =
  'https://github.com/jasoncavaliere/the-butler-did-it/blob/main/Butler.KnowledgeBase/docs/17-byo-tablet-setup-guidance.md';

/**
 * Every word the Tablet setup screen shows. The screen renders only from this
 * constant, so the plain-ASCII, word-count (120 or fewer) and no-brand tests
 * scan every string a reader sees. Keep it brand-free: product examples live in
 * the linked article, not here.
 */
export const TABLET_SETUP_COPY = {
  heading: 'Tablet setup',
  intro: 'Three things keep the hub tablet healthy on the wall.',
  points: [
    {
      key: 'charging',
      title: 'Cap charging',
      body: 'A tablet that sits at 100% on a charger all day can swell its battery. Turn on the charge cap in its battery settings. No cap? Put the charger on a smart plug with a schedule.',
    },
    {
      key: 'mount',
      title: 'Mount it with permanent power',
      body: 'Mount it where the family walks past, with the USB-C port free. Run a right-angle cable to the nearest outlet.',
    },
    {
      key: 'lockdown',
      title: 'Lock it down',
      body: "Use a kiosk app or the tablet's single-app mode, so a child or guest cannot leave Butler.",
    },
  ],
  link: 'Read the full setup guide',
  done: 'Done',
} as const;

/**
 * The Tablet setup route (#248): the three things that keep a wall-mounted hub
 * tablet healthy (cap charging, mount it with permanent power, lock it down),
 * with a link to the full setup article.
 *
 * It is static copy on purpose: no API call and no household read, so it reads
 * correctly offline and shows no household data. It is not wrapped in
 * OrganizerGate (which probes GET /me and would fail offline) because it holds
 * nothing sensitive and its only entry point, the organizer bar's Tablet setup
 * button, already appears only for a signed-in organizer. Done renders only
 * when the navigator supplies {@link onDone}, which returns to the hub.
 */
export function TabletSetupScreen({
  onDone,
}: {
  /** Returns to the hub. When omitted, the Done button is not rendered. */
  onDone?: () => void;
}) {
  const copy = TABLET_SETUP_COPY;
  return (
    <Screen testID="tablet-setup-screen">
      <Text style={styles.heading} accessibilityRole="header">
        {copy.heading}
      </Text>
      <Text style={styles.body}>{copy.intro}</Text>

      {copy.points.map((point) => (
        <View key={point.key} style={styles.section} testID={`tablet-setup-point-${point.key}`}>
          <Text style={styles.subhead} accessibilityRole="header">
            {point.title}
          </Text>
          <Text style={styles.body}>{point.body}</Text>
        </View>
      ))}

      <Pressable
        accessibilityRole="link"
        testID="tablet-setup-article-link"
        style={styles.link}
        onPress={() => {
          // A refused open (no browser, or a locked-down kiosk) leaves the
          // organizer on this screen; there is nothing more to do.
          void Linking.openURL(TABLET_SETUP_ARTICLE_URL).catch(() => undefined);
        }}
      >
        <Text style={styles.linkText}>{copy.link}</Text>
      </Pressable>

      {onDone ? (
        <View style={styles.section}>
          <ActionButton testID="tablet-setup-done" variant="secondary" onPress={onDone}>
            {copy.done}
          </ActionButton>
        </View>
      ) : null}
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
  subhead: { color: colors.ink, fontSize: typeScale.subhead, fontWeight: '700' },
  body: { color: colors.ink, fontSize: typeScale.body, marginTop: space.s2 },
  section: { marginTop: space.s6 },
  link: { marginTop: space.s6, minHeight: minTouchTarget, justifyContent: 'center' },
  linkText: {
    color: colors.brass,
    fontSize: typeScale.body,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
