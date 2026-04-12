import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import type { ManualDemoSetupResult } from './src/utils/manualDemoSetup';
import { runManualDemoSetup } from './src/utils/manualDemoSetup';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const [setupResult, setSetupResult] = useState<ManualDemoSetupResult | null>(
    null,
  );
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const setup = async () => {
      try {
        const result = await runManualDemoSetup();
        if (!isActive) {
          return;
        }

        setSetupResult(result);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setSetupError(
          error instanceof Error ? error.message : 'Manual setup failed.',
        );
      }
    };

    setup();

    return () => {
      isActive = false;
    };
  }, []);

  if (setupError) {
    return (
      <View style={[styles.container, styles.screen, styles.errorScreen]}>
        <Text style={styles.eyebrow}>Digital Delta</Text>
        <Text style={styles.title}>Demo setup failed</Text>
        <Text style={styles.body}>{setupError}</Text>
      </View>
    );
  }

  if (!setupResult) {
    return (
      <View style={[styles.container, styles.screen, styles.loadingScreen]}>
        <ActivityIndicator size="large" color="#0c6c63" />
        <Text style={styles.eyebrow}>Digital Delta</Text>
        <Text style={styles.title}>Preparing offline demo data</Text>
        <Text style={styles.body}>
          Initializing the local database and seeding the Sylhet flood scenario.
        </Text>
      </View>
    );
  }

  const { loginData, dashboardData, scenarioId, seededAtMs } = setupResult;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: safeAreaInsets.top + 24,
          paddingBottom: safeAreaInsets.bottom + 24,
        },
      ]}
    >
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Digital Delta</Text>
        <Text style={styles.title}>Phase 0 demo bootstrap complete</Text>
        <Text style={styles.body}>
          The app now initializes the local database and boots with seeded
          offline scenario data.
        </Text>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {dashboardData.connectivityState}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Active user</Text>
          <Text style={styles.cardValue}>{loginData.displayName}</Text>
          <Text style={styles.cardMeta}>{loginData.primaryRole}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Scenario</Text>
          <Text style={styles.cardValue}>{scenarioId}</Text>
          <Text style={styles.cardMeta}>{formatTime(seededAtMs)}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Routes loaded</Text>
          <Text style={styles.cardValue}>{dashboardData.routes.length}</Text>
          <Text style={styles.cardMeta}>route summaries ready</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Inventory loaded</Text>
          <Text style={styles.cardValue}>{dashboardData.supplies.length}</Text>
          <Text style={styles.cardMeta}>supply entries ready</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Fleet nodes</Text>
          <Text style={styles.cardValue}>
            {dashboardData.nodeHealth.length}
          </Text>
          <Text style={styles.cardMeta}>vehicle health entries</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Triage alerts</Text>
          <Text style={styles.cardValue}>
            {dashboardData.triageAlerts.length}
          </Text>
          <Text style={styles.cardMeta}>preemption signals present</Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>Boot summary</Text>
        <Text style={styles.summaryLine}>
          Key provisioned: {loginData.keyProvisioned ? 'yes' : 'no'}
        </Text>
        <Text style={styles.summaryLine}>
          Sync peers: {dashboardData.sync.peerCount}
        </Text>
        <Text style={styles.summaryLine}>
          Queued envelopes: {dashboardData.sync.queuedEnvelopeCount}
        </Text>
        <Text style={styles.summaryLine}>
          In-flight envelopes: {dashboardData.sync.inFlightEnvelopeCount}
        </Text>
        <Text style={styles.summaryLine}>
          Conflict records: {dashboardData.conflicts.length}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3efe7',
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 16,
  },
  screen: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingScreen: {
    gap: 12,
  },
  errorScreen: {
    gap: 12,
  },
  heroCard: {
    backgroundColor: '#113d3a',
    borderRadius: 24,
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    color: '#8fd0c6',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f4f8f5',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  body: {
    color: '#d0dfdb',
    fontSize: 15,
    lineHeight: 22,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#d8efe7',
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusPillText: {
    color: '#0c514a',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  grid: {
    gap: 12,
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 20,
    padding: 18,
    gap: 4,
  },
  cardLabel: {
    color: '#7a6d61',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cardValue: {
    color: '#1d2422',
    fontSize: 24,
    fontWeight: '800',
  },
  cardMeta: {
    color: '#5f5b55',
    fontSize: 14,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    gap: 8,
  },
  sectionTitle: {
    color: '#16302c',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryLine: {
    color: '#37423f',
    fontSize: 14,
  },
});

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString();
}

export default App;
