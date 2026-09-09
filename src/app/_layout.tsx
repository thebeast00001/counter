import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AssistantSheet } from '@/components/AssistantSheet';
import { Catch } from '@/components/Catch';
import { ContextDock } from '@/components/ContextDock';
import { DeepProvider } from '@/components/Deep';
import { LockScreen } from '@/components/LockScreen';
import { ThemeProvider, useTheme } from '@/design/theme';
import { I18nProvider } from '@/lib/i18n';
import { AssistantProvider } from '@/state/assistant';
import { BusinessProvider, useBusiness } from '@/state/business';
import { installCrashHandler, report } from '@/state/crash';
import { KEYS, loadJSON, sweepRetiredKeys } from '@/state/persist';
import { DEFAULT_REMINDERS, armReminders, type ReminderSettings } from '@/state/reminders';
import { AuthProvider } from '@/state/clerk';
import { DockActionProvider } from '@/state/dockAction';
import { DockChromeProvider } from '@/state/dockChrome';
import { LiveActivityProvider } from '@/state/liveActivity';
import { SecurityProvider, useSecurity } from '@/state/security';
import { UndoProvider } from '@/state/undo';

SplashScreen.preventAutoHideAsync().catch(() => {});

/*
  Installed at module load, not in an effect.

  A throw during the very first render — the one most likely to be caused by a
  bad stored value — happens before any effect runs, and a handler registered
  after it is a handler that missed the only crash worth having.
*/
installCrashHandler();
sweepRetiredKeys();

export default function RootLayout() {
  // Required by exact file path rather than from the package root: the root
  // barrel re-exports all 18 Inter weights, and Metro bundles every asset it can
  // reach, which added ~4MB of never-used fonts to the download.
  const [fontsLoaded] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.fill}>
      {/*
        Two boundaries, at different depths, because they fail differently.

        This outer one catches a provider — a store that cannot hydrate, a theme
        that cannot resolve — and there is nothing below it to preserve, so its
        "try again" is a full re-mount. The inner one wraps only the navigator,
        so a screen that throws is recovered without tearing down the store that
        just spent a second decrypting the ledger.
      */}
      <Catch onError={(e, stack) => report(e, stack, true)}>
      {/* Outermost, because the Supabase client reads its token and the business
          store may sync the moment it hydrates. */}
      <AuthProvider>
        <SafeAreaProvider>
          <I18nProvider>
            <ThemeProvider>
              <SecurityProvider>
                <LiveActivityProvider>
                  <BusinessProvider>
                    {/*
                    Undo wraps the deep sheet rather than the other way round:
                    actions inside a deep dive — settling, splitting, refunding —
                    need to offer an undo, and a sheet outside the provider cannot
                    reach the hook. The sheet closes itself before the bar appears,
                    so nothing is ever hidden behind the modal.
                  */}
                    <AssistantProvider>
                    <DockActionProvider>
                    <DockChromeProvider>
                  <UndoProvider>
                      {/* Inside the store, so a deep dive can read the records. */}
                      <DeepProvider>
                        <Catch onError={(e, stack) => report(e, stack, true)}>
                          <RootNavigator />
                        </Catch>
                      </DeepProvider>
                    </UndoProvider>
                    </DockChromeProvider>
                  </DockActionProvider>
                    </AssistantProvider>
                  </BusinessProvider>
                </LiveActivityProvider>
              </SecurityProvider>
            </ThemeProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </AuthProvider>
      </Catch>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const { locked, ready: securityReady } = useSecurity();
  const { profile, data, hydrated } = useBusiness();
  const router = useRouter();
  const segments = useSegments();

  // No business yet means nothing in the app has anything to show, so setup is
  // not a step to skip past — it is the only screen that makes sense. Waits for
  // hydration so a slow storage read cannot bounce a returning owner through it.
  useEffect(() => {
    if (!hydrated) return;
    const inSetup = segments[0] === 'setup';
    if (!profile && !inSetup) router.replace('/setup');
  }, [profile, hydrated, segments, router]);

  /*
    Tomorrow's reminder is rewritten every time the app opens.

    Its figures are read at the moment it is scheduled, so left alone they would
    age — the notification that fires on Thursday would be quoting Monday's
    overdue total. Re-arming on launch costs nothing and means the one
    notification carrying real numbers was written within a day of firing. The
    six behind it never quote a figure, so they are safe to leave.
  */
  useEffect(() => {
    if (!hydrated || !profile) return;
    let alive = true;
    loadJSON<ReminderSettings>(KEYS.reminders, DEFAULT_REMINDERS)
      .then((saved) => {
        if (!alive || !saved?.enabled) return;
        return armReminders(profile, data, saved.at);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hydrated, profile, data]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="setup" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="you" />
      </Stack>

      {/*
        The bar on every screen that is not a tab. Mounted here rather than per
        screen so it cannot be forgotten on a new one, and so it survives the
        push transition instead of sliding in with the content.
      */}
      <ContextDock />

      {/*
        Above both bars, because it replaces whichever one is showing. Mounted
        here rather than inside either of them so the conversation survives a
        navigation — asking something, tapping a customer in the answer, and
        coming back should not have emptied it.
      */}
      <AssistantSheet />

      {/* Rendered above the navigator so a lock cannot be dismissed by navigating. */}
      {securityReady && locked ? (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
