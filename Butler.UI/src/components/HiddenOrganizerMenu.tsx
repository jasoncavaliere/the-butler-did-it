import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchDatasetId } from '../api/dataset';
import { pingApi } from '../api/ping';
import { useApiClient } from '../api/useApiClient';
import { readLastSeenDatasetId } from '../offline/datasetGuard';
import { defaultReload } from '../pwa/useHubWatchdog';
import { useOrganizer } from '../state/OrganizerContext';
import { minTouchTarget, radii, space, typeScale } from '../theme/theme';
import { colors } from './Screen';
import { VersionInfo } from './VersionInfo';

/**
 * The hub's hidden organizer menu (#131): a maintenance panel for the kiosk
 * tablet, where the browser chrome is gone and nobody can reach the address bar.
 *
 * The hub opens it after a {@link HIDDEN_MENU_HOLD_MS} press on the household
 * name and the organizer PIN (see `HubShell`), so it only ever renders for a
 * signed-in organizer. It shows what someone debugging the wall needs at a
 * glance:
 *
 * - the API base URL the hub is using, exactly as configured;
 * - whether `GET /api/system/ping` answers right now;
 * - the dataset id the API serves (#100), falling back to the id the household
 *   last saw, marked `(last seen)`, when the live read fails;
 * - the hub and API build versions, through the unchanged {@link VersionInfo}.
 *
 * And it offers three actions, each behind a confirmation whose Cancel runs
 * nothing: Reload app (a full page reload, once), Clear local cache (the hub's
 * `onClearLocalCache`, which forgets the household's offline state; the option
 * is absent when no handler is given), and Sign out organizer.
 *
 * The reads are display-only. It never runs the dataset guard's check: that
 * clears the queue and cache as a side effect when the id changed.
 */

/** How long the household name must be held before the PIN prompt shows (#131). */
export const HIDDEN_MENU_HOLD_MS = 3000;

type PingPhase = 'checking' | 'ok' | 'down';
type PendingAction = 'reload' | 'clear' | 'signOut';

const COPY = {
  heading: 'Organizer menu',
  apiUrlLabel: 'API URL',
  pingLabel: 'API ping',
  datasetLabel: 'Dataset',
  checking: 'checking...',
  pingOk: 'OK',
  pingDown: 'Not reachable',
  unavailable: 'unavailable',
  lastSeen: '(last seen)',
  reload: 'Reload app',
  clear: 'Clear local cache',
  signOut: 'Sign out organizer',
  close: 'Close',
  confirm: 'Confirm',
  cancel: 'Cancel',
  confirmText: {
    reload: 'Reload the app? The hub restarts and comes back to this screen.',
    clear:
      'Clear local cache? This empties the last-known week and any writes still waiting to sync on this tablet.',
    signOut: 'Sign out the organizer? The hub goes back to participant-only mode.',
  },
} as const;

export type HiddenOrganizerMenuProps = {
  /** The hub's household, for the last-seen dataset id fallback; `null` when none is selected. */
  householdId: string | null;
  /** Closes the menu (the Close button, and after Sign out). */
  onClose: () => void;
  /**
   * Forgets the household's offline state (last-known week and write queue).
   * When omitted, the Clear local cache option is not rendered.
   */
  onClearLocalCache?: () => void;
  /** Reloads the app; defaults to `window.location.reload()` (tests inject it). */
  reload?: () => void;
};

export function HiddenOrganizerMenu({
  householdId,
  onClose,
  onClearLocalCache,
  reload = defaultReload,
}: HiddenOrganizerMenuProps) {
  const client = useApiClient();
  const { signOut } = useOrganizer();
  const [ping, setPing] = useState<PingPhase>('checking');
  const [dataset, setDataset] = useState<string>(COPY.checking);
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Set once Reload or Sign out is confirmed: it disables Confirm and Cancel, so
  // a double tap cannot run the action twice.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pingApi(client)
      .then((reachable) => {
        if (!cancelled) {
          setPing(reachable ? 'ok' : 'down');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPing('down');
        }
      });
    const fallback = () => {
      const lastSeen = householdId === null ? null : readLastSeenDatasetId(householdId);
      return lastSeen === null ? COPY.unavailable : `${lastSeen} ${COPY.lastSeen}`;
    };
    fetchDatasetId(client)
      .then((datasetId) => {
        if (!cancelled) {
          setDataset(datasetId ?? fallback());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataset(fallback());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, householdId]);

  const runConfirmed = (action: PendingAction) => {
    if (action === 'reload') {
      setBusy(true);
      reload();
      return;
    }
    if (action === 'clear') {
      setPending(null);
      onClearLocalCache?.();
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        await signOut();
      } catch {
        // The provider refused to sign out; the menu still closes.
      } finally {
        onClose();
      }
    })();
  };

  let pingText: string = COPY.checking;
  if (ping === 'ok') {
    pingText = COPY.pingOk;
  } else if (ping === 'down') {
    pingText = COPY.pingDown;
  }

  return (
    <View style={styles.root} testID="hidden-menu">
      <Text style={styles.heading} accessibilityRole="header">
        {COPY.heading}
      </Text>
      <Row label={COPY.apiUrlLabel} value={client.baseUrl} testID="hidden-menu-api-url" />
      <Row
        label={COPY.pingLabel}
        value={pingText}
        testID="hidden-menu-ping"
        tone={ping === 'down' ? 'danger' : 'normal'}
      />
      <Row label={COPY.datasetLabel} value={dataset} testID="hidden-menu-dataset" />
      <VersionInfo />

      {pending === null ? (
        <View style={styles.actions}>
          <Action testID="hidden-menu-reload" label={COPY.reload} onPress={() => setPending('reload')} />
          {onClearLocalCache ? (
            <Action testID="hidden-menu-clear-cache" label={COPY.clear} onPress={() => setPending('clear')} />
          ) : null}
          <Action testID="hidden-menu-sign-out" label={COPY.signOut} onPress={() => setPending('signOut')} />
          <Action testID="hidden-menu-close" label={COPY.close} onPress={onClose} />
        </View>
      ) : (
        <View style={styles.confirm} testID="hidden-menu-confirm">
          <Text style={styles.confirmText} testID="hidden-menu-confirm-text">
            {COPY.confirmText[pending]}
          </Text>
          <View style={styles.actions}>
            <Action
              testID="hidden-menu-confirm-ok"
              label={COPY.confirm}
              onPress={() => runConfirmed(pending)}
              disabled={busy}
              primary
            />
            <Action
              testID="hidden-menu-confirm-cancel"
              label={COPY.cancel}
              onPress={() => setPending(null)}
              disabled={busy}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  testID,
  tone = 'normal',
}: {
  label: string;
  value: string;
  testID: string;
  tone?: 'normal' | 'danger';
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone === 'danger' && styles.danger]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function Action({
  testID,
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={primary ? styles.primaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s3 },
  heading: { color: colors.ink, fontSize: typeScale.subhead, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3, alignItems: 'baseline' },
  label: { color: colors.muted, fontSize: typeScale.caption, minWidth: 80 },
  value: { color: colors.ink, fontSize: typeScale.caption, fontFamily: 'monospace', flexShrink: 1 },
  danger: { color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  confirm: { gap: space.s3 },
  confirmText: { color: colors.ink, fontSize: typeScale.body },
  button: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brass,
    paddingHorizontal: space.s4,
  },
  buttonText: { color: colors.brass, fontSize: typeScale.caption, fontWeight: '600' },
  primary: { backgroundColor: colors.brass },
  primaryText: { color: colors.page, fontSize: typeScale.caption, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
