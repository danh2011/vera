import { forwardRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, Switch, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { Check, Eye, EyeOff } from "lucide-react-native";
import { FONT, HIT, RADIUS, useTheme } from "../theme";
import { haptic } from "../lib/haptics";
import { Text } from "./Text";

export interface TextFieldProps extends Omit<TextInputProps, "style"> { label?: string; error?: string; help?: string; optional?: boolean; required?: boolean; secret?: boolean; style?: StyleProp<ViewStyle>; inputStyle?: TextInputProps["style"] }

export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField({ label, error, help, optional, required, secret, style, inputStyle, multiline, ...rest }, ref) {
  const { c } = useTheme(); const [focus, setFocus] = useState(false); const [shown, setShown] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="small" weight="medium">{label}{required ? <Text variant="small" color={c.danger}> *</Text> : null}{optional ? <Text variant="small" muted> (optional)</Text> : null}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: multiline ? "flex-start" : "center", backgroundColor: c.bg, borderColor: error ? c.danger : focus ? c.accent : c.border, borderWidth: 1, borderRadius: RADIUS.md }}>
        <TextInput ref={ref} {...rest} multiline={multiline} secureTextEntry={secret && !shown} placeholderTextColor={c.muted} selectionColor={c.accent} cursorColor={c.accent}
          onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }} onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }} accessibilityLabel={label ?? rest.accessibilityLabel}
          style={[{ flex: 1, color: c.text, fontFamily: FONT.regular, fontSize: 16, paddingHorizontal: 14, paddingVertical: 11, minHeight: HIT, textAlignVertical: multiline ? "top" : "center" }, multiline ? { minHeight: 96 } : null, inputStyle]} />
        {secret ? <Pressable accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} onPress={() => setShown((s) => !s)} hitSlop={8} style={{ width: HIT, height: HIT, alignItems: "center", justifyContent: "center" }}>{shown ? <EyeOff size={18} color={c.muted} /> : <Eye size={18} color={c.muted} />}</Pressable> : null}
      </View>
      {help ? <Text variant="tiny" muted>{help}</Text> : null}
      {error ? <Text variant="small" color={c.danger} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
});

/** A labelled on/off row. The whole row is the touch target, as on system settings screens. */
export function ToggleRow({ title, subtitle, value, onChange, disabled, state }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; state?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => { haptic.select(); onChange(!value); }}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text weight="medium" style={{ fontSize: 15.5, lineHeight: 21 }}>{title}</Text>
        {subtitle ? <Text variant="small" muted>{subtitle}</Text> : null}
      </View>
      {state ? <Text variant="tiny" weight="semibold" color={value ? c.ok : c.muted}>{value ? "ON" : "OFF"}</Text> : null}
      <Switch value={value} onValueChange={(v) => { haptic.select(); onChange(v); }} disabled={disabled} thumbColor={value ? "#ffffff" : c.muted} trackColor={{ false: c.bg, true: c.ok }} ios_backgroundColor={c.bg} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, style }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[{ flexDirection: "row", backgroundColor: c.raised, borderRadius: RADIUS.pill, padding: 3 }, style]}>
      {options.map((o) => { const on = o.value === value; return (
        <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { if (!on) { haptic.select(); onChange(o.value); } }}
          style={{ flex: 1, minHeight: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: on ? c.bg : "transparent", paddingHorizontal: 10 }}>
          <Text numberOfLines={1} style={{ fontFamily: on ? FONT.semibold : FONT.medium, fontSize: 14, color: on ? c.text : c.muted }}>{o.label}</Text>
        </Pressable>); })}
    </View>
  );
}

export function Chip({ label, on, onPress, count, icon }: { label: string; on?: boolean; onPress?: () => void; count?: number; icon?: ReactNode }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={() => { haptic.select(); onPress?.(); }}
      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? c.accent : c.raised, borderColor: on ? c.accent : c.border, borderWidth: 1 }}>
      {icon}
      <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: on ? c.onAccent : c.text }}>{label}</Text>
      {count !== undefined ? <Text variant="tiny" style={{ color: on ? c.onAccent : c.muted, opacity: 0.75 }}>{count}</Text> : null}
    </Pressable>
  );
}

export function Checkbox({ checked, onPress, label, size = 24 }: { checked: boolean; onPress: () => void; label: string; size?: number }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} onPress={() => { haptic.tap(); onPress(); }} hitSlop={10}
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: checked ? c.ok : c.muted, backgroundColor: checked ? c.ok : "transparent", alignItems: "center", justifyContent: "center" }}>
      {checked ? <Check size={size - 10} color="#0b0b0f" strokeWidth={3} /> : null}
    </Pressable>
  );
}
