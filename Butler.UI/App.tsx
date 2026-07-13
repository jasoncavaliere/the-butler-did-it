import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// The local Butler.API dev server (see Butler.API/README.md).
const API_BASE = 'http://localhost:5099';

type Member = { name: string; role: string };
type Chore = { title: string; room: string; assignedTo: string; done: boolean };
type Household = { name: string; rooms: string[]; members: Member[]; sampleChore: Chore };
type Hello = {
  service: string;
  status: string;
  message: string;
  timestampUtc: string;
  sampleHousehold: Household;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; detail: string }
  | { kind: 'ready'; data: Hello };

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  async function load() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`${API_BASE}/api/hello`);
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      const data = (await res.json()) as Hello;
      setState({ kind: 'ready', data });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setState({ kind: 'error', detail });
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <StatusBar style="light" />
      <View style={styles.card}>
        <Text style={styles.eyebrow}>BUTLER</Text>
        <Text style={styles.title}>UI to API connection</Text>

        {state.kind === 'loading' && (
          <View style={styles.row}>
            <ActivityIndicator color="#D9B25A" />
            <Text style={styles.muted}>Contacting Butler.API at {API_BASE} ...</Text>
          </View>
        )}

        {state.kind === 'error' && (
          <View style={[styles.status, styles.statusBad]}>
            <Text style={styles.statusTitle}>Could not reach the API</Text>
            <Text style={styles.muted}>{state.detail}</Text>
            <Text style={styles.hint}>
              Is the API running? Start it with: dotnet run --project src/Butler.Api --launch-profile http
            </Text>
          </View>
        )}

        {state.kind === 'ready' && (
          <>
            <View style={[styles.status, styles.statusGood]}>
              <Text style={styles.statusTitle}>Connected to {state.data.service}</Text>
              <Text style={styles.message}>{state.data.message}</Text>
              <Text style={styles.muted}>server time (UTC): {state.data.timestampUtc}</Text>
            </View>

            <Text style={styles.sectionLabel}>SAMPLE HOUSEHOLD PAYLOAD</Text>
            <Text style={styles.household}>{state.data.sampleHousehold.name}</Text>

            <Text style={styles.fieldLabel}>Rooms</Text>
            <Text style={styles.value}>{state.data.sampleHousehold.rooms.join(' · ')}</Text>

            <Text style={styles.fieldLabel}>Members</Text>
            {state.data.sampleHousehold.members.map((m) => (
              <Text key={m.name} style={styles.value}>
                {m.name} <Text style={styles.role}>({m.role})</Text>
              </Text>
            ))}

            <Text style={styles.fieldLabel}>Sample chore</Text>
            <Text style={styles.value}>
              {state.data.sampleHousehold.sampleChore.title} in{' '}
              {state.data.sampleHousehold.sampleChore.room} - assigned to{' '}
              {state.data.sampleHousehold.sampleChore.assignedTo}
            </Text>

            <Text style={styles.raw}>{JSON.stringify(state.data, null, 2)}</Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const ink = '#ECEBE0';
const brass = '#D9B25A';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101613' },
  pageContent: { alignItems: 'center', padding: 24, paddingTop: 64 },
  card: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#17241D',
    borderRadius: 12,
    padding: 28,
    borderWidth: 1,
    borderColor: 'rgba(236,235,224,0.12)',
  },
  eyebrow: { color: brass, fontSize: 12, fontWeight: '700', letterSpacing: 4 },
  title: { color: ink, fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { borderRadius: 8, padding: 16, marginBottom: 8 },
  statusGood: { backgroundColor: 'rgba(114,160,90,0.14)', borderLeftWidth: 3, borderLeftColor: '#7BA05A' },
  statusBad: { backgroundColor: 'rgba(190,90,80,0.14)', borderLeftWidth: 3, borderLeftColor: '#C56A5F' },
  statusTitle: { color: ink, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  message: { color: ink, fontSize: 15, fontStyle: 'italic', marginBottom: 6 },
  sectionLabel: { color: brass, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 22 },
  household: { color: ink, fontSize: 20, fontWeight: '700', marginTop: 6, marginBottom: 8 },
  fieldLabel: { color: brass, fontSize: 12, fontWeight: '600', marginTop: 12 },
  value: { color: ink, fontSize: 15, marginTop: 2 },
  role: { color: '#A7ADA2' },
  muted: { color: '#A7ADA2', fontSize: 13 },
  hint: { color: '#A7ADA2', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  raw: {
    color: '#8FB98F',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 22,
    padding: 14,
    backgroundColor: '#101613',
    borderRadius: 8,
  },
});
