import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { FONT, HIT, RADIUS, useTheme } from "../theme";
import { haptic } from "../lib/haptics";
import { Text } from "./Text";

type Kind = "default" | "primary" | "danger" | "ghost" | "outline-danger";
export interface ButtonProps { label: string; onPress?: () => void; kind?: Kind; icon?: LucideIcon; loading?: boolean; disabled?: boolean; small?: boolean; wide?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; testID?: string }

export function Button({ label, onPress, kind = "default", icon: Icon, loading, disabled, small, wide, style, accessibilityLabel, testID }: ButtonProps) {
  const { c } = useTheme(); const off = disabled || loading;
  const look = {
    default: { bg: c.raised, fg: c.text, bd: c.border },
    primary: { bg: c.accent, fg: c.onAccent, bd: c.accent },
    danger: { bg: c.danger, fg: c.onDanger, bd: c.danger },
    ghost: { bg: "transparent", fg: c.text, bd: "transparent" },
    "outline-danger": { bg: "transparent", fg: c.danger, bd: c.danger },
  }[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off}
      onPress={() => { haptic.tap(); onPress?.(); }} android_ripple={{ color: "rgba(127,127,127,0.25)" }}
      style={({ pressed }) => [{ minHeight: small ? 36 : HIT + 4, paddingHorizontal: small ? 14 : 20, borderRadius: RADIUS.pill, backgroundColor: look.bg, borderColor: look.bd, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: off ? 0.45 : pressed ? 0.85 : 1, alignSelf: wide ? "stretch" : "flex-start", overflow: "hidden" }, style]}>
      {loading ? <ActivityIndicator size="small" color={look.fg} /> : Icon ? <Icon size={small ? 15 : 17} color={look.fg} /> : null}
      <Text numberOfLines={1} style={{ color: look.fg, fontFamily: FONT.medium, fontSize: small ? 14 : 15.5 }}>{label}</Text>
    </Pressable>
  );
}

export interface IconButtonProps { icon: LucideIcon; label: string; onPress?: () => void; onLongPress?: () => void; color?: string; size?: number; disabled?: boolean; active?: boolean; filled?: boolean; badge?: ReactNode; testID?: string; style?: StyleProp<ViewStyle> }
export function IconButton({ icon: Icon, label, onPress, onLongPress, color, size = 22, disabled, active, filled, badge, testID, style }: IconButtonProps) {
  const { c } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled}
      onPress={() => { haptic.tap(); onPress?.(); }} onLongPress={onLongPress} hitSlop={6} android_ripple={{ color: "rgba(127,127,127,0.28)", radius: 22, borderless: true }}
      style={({ pressed }) => [{ width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: "center", justifyContent: "center", backgroundColor: filled ? c.accent : active || pressed ? c.hover : "transparent", opacity: disabled ? 0.35 : 1 }, style]}>
      <Icon size={size} color={color ?? (filled ? c.onAccent : active ? c.text : c.muted)} />
      {badge ? <View style={{ position: "absolute", top: 8, right: 8 }}>{badge}</View> : null}
    </Pressable>
  );
}
