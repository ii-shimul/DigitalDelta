import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDatabase } from './src/db';
import {
  getRegisteredUser,
  getActiveSession,
  clearActiveSession,
  type RegisteredUser,
} from './src/api/auth';
import RegisterScreen from './src/ui/screens/register-screen';
import LoginScreen from './src/ui/screens/login-screen';
import HomeScreen from './src/ui/screens/home-screen';

type AppScreen = 'loading' | 'register' | 'login' | 'home';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#faf8ff" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await getDatabase();

        // Check for existing active session first
        const session = await getActiveSession();
        if (!active) {
          return;
        }

        if (session) {
          setUser(session);
          setScreen('home');
          return;
        }

        // No session — check if registered
        const registered = await getRegisteredUser();

        if (!active) {
          return;
        }

        if (registered) {
          setUser(registered);
          setScreen('login');
        } else {
          setScreen('register');
        }
      } catch (e) {
        if (!active) {
          return;
        }
        setError(
          e instanceof Error ? e.message : 'Failed to initialize database',
        );
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const handleRegistered = useCallback((u: RegisteredUser) => {
    setUser(u);
    setScreen('login');
  }, []);

  const handleLoggedIn = useCallback(() => {
    setScreen('home');
  }, []);

  const handleLogout = useCallback(async () => {
    await clearActiveSession();
    setScreen('login');
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Initialization Failed</Text>
        <Text style={styles.errorBody}>{error}</Text>
      </View>
    );
  }

  if (screen === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0058be" />
        <Text style={styles.loadingText}>Initializing database...</Text>
      </View>
    );
  }

  if (screen === 'register') {
    return <RegisterScreen onRegistered={handleRegistered} />;
  }

  if (screen === 'login' && user) {
    return <LoginScreen user={user} onLoggedIn={handleLoggedIn} />;
  }

  if (screen === 'home' && user) {
    return <HomeScreen user={user} onLogout={handleLogout} />;
  }

  return null;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#faf8ff',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#93000a',
  },
  errorBody: {
    fontSize: 14,
    color: '#565e74',
    textAlign: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#565e74',
    marginTop: 8,
  },
});

export default App;
