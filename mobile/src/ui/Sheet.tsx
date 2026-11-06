import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Dimensions, Easing, Modal, PanResponder, Pressable, ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import { FONT, RADIUS, useTheme } from "../theme";
import { haptic } from "../lib/haptics";
import { Button } from "./Button";
import { Text } from "./Text";

/** Bottom sheet: the mobile replacement for the web app's centred dialogs. Drag the handle down, tap outside, or press back to close. */
export function Sheet({ visible, onClose, title, children, footer, scroll = true, tall }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; scroll?: boolean; tall?: boolean }) {
  const { c, reduceMotion } = useTheme(); const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible); const [p] = useState(() => new Animated.Value(visible ? 1 : 0)); const h = Dimensions.get("window").height;
  useEffect(() => {
    if (visible) { setMounted(true); Animated.timing(p, { toValue: 1, duration: reduceMotion ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }
    else Animated.timing(p, { toValue: 0, duration: reduceMotion ? 0 : 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setMounted(false); });
  }, [visible, p, reduceMotion]);
  const [drag] = useState(() => new Animated.Value(0));
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_, g) => { if (g.dy > 0) drag.setValue(g.dy); },
    onPanResponderRelease: (_, g) => { if (g.dy > 90 || g.vy > 0.9) { haptic.tap(); onClose(); } Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); },
  }), [drag, onClose]);
  if (!mounted) return null;
  const translateY = Animated.add(p.interpolate({ inputRange: [0, 1], outputRange: [h * 0.6, 0] }), drag);
  const body = scroll ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>{children}</ScrollView> : <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>{children}</View>;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={{ position: "absolute", inset: 0, backgroundColor: c.scrim, opacity: p }}>
          <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }], backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: c.border, borderWidth: 1, borderBottomWidth: 0, maxHeight: h * (tall ? 0.94 : 0.86), paddingBottom: footer ? 0 : Math.max(insets.bottom, 12) }}>
            <View {...pan.panHandlers} style={{ paddingTop: 10, paddingBottom: title ? 6 : 12 }}>
              <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: c.border }} />
              {title ? <Text variant="title" style={{ paddingHorizontal: 20, paddingTop: 14 }} accessibilityRole="header">{title}</Text> : null}
            </View>
            {body}
            {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: c.border }}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

export interface SheetAction { label: string; icon?: LucideIcon; onPress: () => void; danger?: boolean; hint?: string; selected?: boolean; disabled?: boolean }
/** A list of actions in a sheet: used for long-press menus and pickers. */
export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  const { c } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} scroll={false}>
      <View style={{ gap: 2, paddingBottom: 4 }}>
        {actions.map((a) => { const Icon = a.icon; const color = a.danger ? c.danger : c.text; return (
          <Pressable key={a.label} accessibilityRole="button" accessibilityState={{ selected: a.selected, disabled: a.disabled }} disabled={a.disabled}
            onPress={() => { haptic.tap(); onClose(); setTimeout(a.onPress, 120); }} android_ripple={{ color: "rgba(127,127,127,0.2)" }}
            style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 6, borderRadius: RADIUS.md, opacity: a.disabled ? 0.45 : 1 }}>
            {Icon ? <Icon size={20} color={color} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={{ color, fontFamily: a.selected ? FONT.semibold : FONT.medium, fontSize: 16 }}>{a.label}</Text>
              {a.hint ? <Text variant="small" muted>{a.hint}</Text> : null}
            </View>
            {a.selected ? <Text color={c.ok} weight="semibold">✓</Text> : null}
          </Pressable>); })}
      </View>
    </Sheet>
  );
}

/** Confirmation for anything destructive. Cancel is the safe, left-hand choice. */
export function ConfirmDialog({ visible, title, body, confirmLabel, onConfirm, onCancel, danger = true, children }: { visible: boolean; title: string; body?: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; children?: ReactNode }) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title} scroll={!!children}
      footer={<View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Cancel" onPress={onCancel} wide /></View><View style={{ flex: 1 }}><Button label={confirmLabel} kind={danger ? "danger" : "primary"} onPress={onConfirm} wide /></View></View>}>
      {body ? <Text muted style={{ marginTop: 4, marginBottom: 12 }}>{body}</Text> : null}
      {children}
    </Sheet>
  );
}
