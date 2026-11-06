import { useCallback, useEffect, useState } from "react";
import { BackHandler, Platform, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Drawer } from "react-native-drawer-layout";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
// Import weights individually: the package root would bundle all 18 font files into the APK.
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { SettingsProvider, useSettings } from "../src/state/settings";
import { ThemeProvider, useTheme } from "../src/theme";
import { ToastProvider } from "../src/state/toast";
import { ConnectionProvider, useConnection } from "../src/state/app";
import { RunsProvider } from "../src/state/runs";
import { DrawerCtx } from "../src/state/drawer";
import { setHapticsEnabled } from "../src/lib/haptics";
import { ConnectScreen } from "../src/features/Connect";
import { AuthScreen } from "../src/features/Auth";
import { Onboarding } from "../src/features/Onboarding";
import { DrawerContent } from "../src/features/DrawerContent";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <SettingsProvider>
            <ThemeProvider>
              <ToastProvider>
                <ConnectionProvider><Gate fontsLoaded={fontsLoaded} /></ConnectionProvider>
              </ToastProvider>
            </ThemeProvider>
          </SettingsProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Server address → sign-in → welcome tour → the app. Each step is a full screen; nothing falls back to fake data. */
function Gate({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { auth } = useConnection(); const { settings, ready } = useSettings(); const { c, isDark } = useTheme();
  const loading = !fontsLoaded || !ready || auth.k === "booting";
  useEffect(() => { void SystemUI.setBackgroundColorAsync(c.bg); }, [c.bg]);
  useEffect(() => { setHapticsEnabled(settings.haptics); }, [settings.haptics]);
  useEffect(() => { if (!loading) void SplashScreen.hideAsync(); }, [loading]);
  if (loading) return null;
  let body;
  if (auth.k === "no-server") body = <ConnectScreen />;
  else if (auth.k !== "ok") body = <AuthScreen />;
  else if (!settings.onboarded) body = <Onboarding />;
  else body = <AppShell />;
  return <>{body}<StatusBar style={isDark ? "light" : "dark"} /></>;
}

function AppShell() {
  const { c } = useTheme(); const { width } = useWindowDimensions(); const path = usePathname(); const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (Platform.OS !== "android" || !open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setOpen(false); return true; });
    return () => sub.remove();
  }, [open]);
  const api = { open: () => setOpen(true), close, isOpen: open };
  return (
    <RunsProvider>
      <DrawerCtx.Provider value={api}>
        <Drawer open={open} onOpen={() => setOpen(true)} onClose={close} drawerType="slide" swipeEnabled={!path.includes("/setup")} swipeEdgeWidth={36} overlayStyle={{ backgroundColor: c.scrim }}
          drawerStyle={{ width: Math.min(340, width * 0.86), backgroundColor: c.side }} renderDrawerContent={() => <DrawerContent close={close} />}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "fade_from_bottom", animationDuration: 200 }}>
            <Stack.Screen name="integrations/setup/[id]" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          </Stack>
        </Drawer>
      </DrawerCtx.Provider>
    </RunsProvider>
  );
}
