import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { resolveUiBuildSha } from '../api/config';
import type { VersionResponse } from '../api/models';
import { useApiClient } from '../api/useApiClient';
import { fetchApiVersion } from '../api/version';
import { colors } from './Screen';

/**
 * The build versions of the hub and the API (#126), side by side.
 *
 * The hub's SHA is the `EXPO_PUBLIC_BUILD_SHA` it was exported with (`dev` when
 * unstamped). The API's SHA and UTC build time come from
 * `GET /api/system/version`, read once when the component mounts. When both are
 * known and differ, a mismatch line says so, so a demo running a stale hub or a
 * stale API is easy to spot. When the read fails the API version is shown as
 * unavailable and no mismatch is claimed, because nothing is known to differ.
 *
 * It takes no props, so any surface (the organizer Version panel today, a
 * hidden organizer menu later) can render it unchanged.
 */

type Phase = 'loading' | 'ready' | 'failed';

const COPY = {
  heading: 'Version',
  hubLabel: 'Hub build',
  apiLabel: 'API build',
  builtLabel: 'API built',
  loading: 'checking...',
  unavailable: 'unavailable',
  unknownTime: 'unknown',
  mismatch: 'The hub and the API were built from different commits.',
} as const;

export function VersionInfo() {
  const client = useApiClient();
  const uiSha = resolveUiBuildSha();
  const [phase, setPhase] = useState<Phase>('loading');
  const [version, setVersion] = useState<VersionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApiVersion(client)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setVersion(result);
        setPhase(result ? 'ready' : 'failed');
      })
      .catch(() => {
        if (!cancelled) {
          setPhase('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const ready = phase === 'ready' && version !== null;
  let apiSha: string = COPY.loading;
  if (ready) {
    apiSha = version.sha;
  } else if (phase === 'failed') {
    apiSha = COPY.unavailable;
  }

  return (
    <View style={styles.root} testID="version-info">
      <Text style={styles.heading} accessibilityRole="header">
        {COPY.heading}
      </Text>
      <Row label={COPY.hubLabel} value={uiSha} testID="version-ui-sha" />
      <Row label={COPY.apiLabel} value={apiSha} testID="version-api-sha" />
      {ready ? (
        <Row
          label={COPY.builtLabel}
          value={version.buildTime ?? COPY.unknownTime}
          testID="version-api-build-time"
        />
      ) : null}
      {ready && version.sha !== uiSha ? (
        <View style={styles.mismatch} testID="version-mismatch">
          <Text style={styles.mismatchGlyph}>!</Text>
          <Text style={styles.mismatchText}>{COPY.mismatch}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' },
  label: { color: colors.muted, fontSize: 14, minWidth: 80 },
  value: { color: colors.ink, fontSize: 14, fontFamily: 'monospace' },
  mismatch: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mismatchGlyph: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  mismatchText: { color: colors.danger, fontSize: 14 },
});
