import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronDown, Check } from "lucide-react-native";
import type { ServerSettings } from "../../../../shared/types";
import { useApi } from "../../state/app";
import { useTheme } from "../../theme";
import { Sheet } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";

/** What answers: local tools only, or Gemini when it's switched on. Same choices as the web picker. */
export function ModelPicker() {
  const api = useApi(); const { c } = useTheme(); const router = useRouter(); const [open, setOpen] = useState(false); const [st, setSt] = useState<ServerSettings | null>(null);
  useEffect(() => { let live = true; api.getServerSettings().then((v) => live && setSt(v)).catch(() => {}); return () => { live = false; }; }, [api, open]);
  const ai = st?.ai;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose how Vera answers" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 10, borderRadius: 12 }}>
        <Text variant="title">Vera</Text><Text muted>{ai?.ready ? "AI on" : "Local"}</Text><ChevronDown size={15} color={c.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="How Vera answers" scroll={false}>
        <Option title="Local tools only" sub="Time, maths, tasks, notes and more. No cloud AI." on={!ai?.ready} />
        <Option title={ai?.ready ? `Gemini · ${ai.model}` : "Gemini is not active"} sub={ai?.ready ? `${ai.usage.today.requests} of ${ai.limits.perDay} requests used today` : ai?.reason ?? "Loading…"} on={!!ai?.ready} disabled={!ai?.ready} />
        <View style={{ marginTop: 8 }}><Button label="Open AI settings" onPress={() => { setOpen(false); setTimeout(() => router.navigate("/settings"), 150); }} /></View>
      </Sheet>
    </>
  );
}

function Option({ title, sub, on, disabled }: { title: string; sub: string; on: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, opacity: disabled ? 0.55 : 1 }}>
      <View style={{ flex: 1 }}><Text weight="medium">{title}</Text><Text variant="small" muted>{sub}</Text></View>{on ? <Check size={18} color={c.ok} /> : null}
    </View>);
}
