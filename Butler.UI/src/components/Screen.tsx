import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

/** Colours for the Butler shell (mirrors the brand used elsewhere in the UI). */
export const colors = {
  page: '#101613',
  card: '#17241D',
  ink: '#ECEBE0',
  brass: '#D9B25A',
  muted: '#A7ADA2',
  border: 'rgba(236,235,224,0.12)',
} as const;

/**
 * Standard scrollable page shell used by screens: centered card on the Butler
 * background. Keeps per-screen layout consistent as more screens are added.
 */
export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent} testID={testID}>
      <View style={styles.card}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  pageContent: { alignItems: 'center', padding: 24, paddingTop: 64 },
  card: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 28,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
