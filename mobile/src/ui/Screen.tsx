import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, RefreshControl, View, type StyleProp, type ViewStyle, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertCircle, ArrowLeft, Menu } from "lucide-react-native";
import { FONT, HIT, RADIUS, useTheme } from "../theme";
import { useDrawer } from "../state/drawer";
import { IconButton, Button } from "./Button";
import { Text } from "./Text";

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
}

export function ScreenHeader({ title, back, right, subtitle, below, center }: { title?: string; back?: boolean; right?: ReactNode; subtitle?: string; below?: ReactNode; center?: ReactNode }) {
  const { c } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const drawer = useDrawer();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 2 }}>
        {back ? <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/chat"))} color={c.text} />
          : <IconButton icon={Menu} label="Open menu" onPress={drawer.open} color={c.text} />}
        {center ? <View style={{ flex: 1 }}>{center}</View> : title ? <View style={{ flex: 1, paddingHorizontal: 6 }}><Text variant="title" numberOfLines={1} accessibilityRole="header">{title}</Text>{subtitle ? <Text variant="tiny" muted numberOfLines={1}>{subtitle}</Text> : null}</View> : <View style={{ flex: 1 }} />}
        <View style={{ flexDirection: "row", alignItems: "center" }}>{right}</View>
      </View>
      {below}
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: RADIUS.lg, padding: padded ? 14 : 0 }, style]}>{children}</View>;
}

export function SectionTitle({ children, hint, count }: { children: string; hint?: string; count?: number }) {
  return (
    <View style={{ marginTop: 22, marginBottom: 8 }}>
      <Text variant="h3" accessibilityRole="header">{children}{count !== undefined ? <Text variant="small" muted>  {count}</Text> : null}</Text>
      {hint ? <Text variant="small" muted>{hint}</Text> : null}
    </View>
  );
}

export function Badge({ label, tone = "muted" }: { label: string; tone?: "muted" | "ok" | "warn" | "danger" }) {
  const { c } = useTheme(); const col = tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "danger" ? c.danger : c.muted;
  return <View style={{ borderColor: tone === "muted" ? c.border : col, borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 2, backgroundColor: tone === "muted" ? c.raised : "transparent" }}><Text variant="tiny" style={{ color: col, fontFamily: FONT.medium }}>{label}</Text></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ gap: 10, padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: c.danger, backgroundColor: c.surface, margin: 16 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}><AlertCircle size={18} color={c.danger} style={{ marginTop: 2 }} /><Text style={{ flex: 1, color: c.danger }}>{message}</Text></View>
      {onRetry ? <Button label="Try again" onPress={onRetry} small /> : null}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return <View style={{ alignItems: "center", paddingVertical: 56, paddingHorizontal: 28, gap: 6 }}><Text variant="title" style={{ textAlign: "center" }}>{title}</Text>{body ? <Text muted style={{ textAlign: "center" }}>{body}</Text> : null}{action ? <View style={{ marginTop: 14 }}>{action}</View> : null}</View>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  const { c } = useTheme();
  return <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ paddingVertical: 48, alignItems: "center", gap: 10 }}><ActivityIndicator color={c.muted} /><Text variant="small" muted>{label}</Text></View>;
}

export function Skeleton({ height = 14, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const { c, reduceMotion } = useTheme(); const [v] = useState(() => new Animated.Value(0));
  useEffect(() => { if (reduceMotion) return; const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true })])); a.start(); return () => a.stop(); }, [v, reduceMotion]);
  return <Animated.View style={[{ height, width, borderRadius: 6, backgroundColor: c.hover, opacity: reduceMotion ? 0.7 : v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) }, style]} />;
}

export function useRefreshControl(refreshing: boolean, onRefresh: () => void) {
  const { c } = useTheme();
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} colors={[c.accent]} progressBackgroundColor={c.raised} />;
}

/** Floating action button, anchored above the home indicator. */
export function Fab({ icon: Icon, label, onPress }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; onPress: () => void }) {
  const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: Math.min(20, width * 0.05), bottom: Math.max(insets.bottom, 12) + 12 }}>
      <Button label={label} icon={Icon as never} kind="primary" onPress={onPress} style={{ minHeight: HIT + 8, paddingHorizontal: 22, elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }} />
    </View>
  );
}
