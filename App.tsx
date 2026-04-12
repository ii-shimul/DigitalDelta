import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { AuthAccessFlow } from './src/ui/navigation';
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
      <View
        style={[
          styles.container,
          styles.screen,
          styles.errorScreen,
          {
            paddingTop: safeAreaInsets.top + 24,
            paddingBottom: safeAreaInsets.bottom + 24,
          },
        ]}
      >
        <Text style={styles.eyebrow}>Digital Delta</Text>
        <Text style={styles.title}>Authentication bootstrap failed</Text>
        <Text style={styles.body}>{setupError}</Text>
      </View>
    );
  }

  if (!setupResult) {
    return (
      <View
        style={[
          styles.container,
          styles.screen,
          styles.loadingScreen,
          {
            paddingTop: safeAreaInsets.top + 24,
            paddingBottom: safeAreaInsets.bottom + 24,
          },
        ]}
      >
        <ActivityIndicator size="large" color="#0c6c63" />
        <Text style={styles.eyebrow}>Digital Delta</Text>
        <Text style={styles.title}>Preparing authentication flow</Text>
        <Text style={styles.body}>
          Initializing seeded offline data and loading auth placeholders.
        </Text>
      </View>
    );
  }

  const { loginData, dashboardData } = setupResult;

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: safeAreaInsets.top,
          paddingBottom: safeAreaInsets.bottom,
        },
      ]}
    >
      <AuthAccessFlow dashboardData={dashboardData} loginData={loginData} />
    </View>
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
  eyebrow: {
    color: '#4f625f',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#12211f',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  body: {
    color: '#31423f',
    fontSize: 14,
    lineHeight: 20,
  },
});

export default App;
