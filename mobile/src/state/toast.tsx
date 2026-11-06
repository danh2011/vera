import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, FONT, RADIUS } from "../theme";
import { Text } from "../ui/Text";

export type ToastKind = "success" | "error" | "info";
type Push = (msg: string, kind?: ToastKind) => void;
const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]); const n = useRef(0);
  const push = useCallback<Push>((msg, kind = "info") => {
    const id = ++n.current; setItems((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 3000);
  }, []);
  return <Ctx.Provider value={push}>{children}<Toasts items={items} /></Ctx.Provider>;
}

function Toasts({ items }: { items: { id: number; msg: string; kind: ToastKind }[] }) {
  const { c, reduceMotion } = useTheme(); const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: "flex-end", alignItems: "center", paddingBottom: insets.bottom + 96 }]} accessibilityLiveRegion="polite">
      {items.map((t) => (
        <Animated.View key={t.id} entering={reduceMotion ? undefined : FadeInDown.duration(180)} exiting={reduceMotion ? undefined : FadeOut.duration(150)}
          style={{ backgroundColor: c.raised, borderColor: t.kind === "success" ? c.ok : t.kind === "error" ? c.danger : c.border, borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: 6, maxWidth: "88%", elevation: 8 }}>
          <Text style={{ fontFamily: FONT.medium, fontSize: 14 }}>{t.msg}</Text>
        </Animated.View>
      ))}
    </View>
  );
}
