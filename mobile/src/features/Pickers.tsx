import { useState } from "react";
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { ACCENTS, type Accent } from "../theme/tokens";
import { useTheme } from "../theme";
import { haptic } from "../lib/haptics";
import { Chip, TextField } from "../ui/Field";

export function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginVertical: 10 }}>
      {ACCENTS.map((a) => { const on = value === a.id; return (
        <Pressable key={a.id} accessibilityRole="radio" accessibilityLabel={a.label} accessibilityState={{ checked: on }} onPress={() => { haptic.select(); onChange(a.id); }}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: a.color, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: on ? c.text : "transparent" }}>
          {on ? <Check size={20} color="#111" /> : null}
        </Pressable>); })}
    </View>
  );
}

const SUGGESTED = ["Coding", "Home lab", "Music", "Gaming", "Photography", "Reading", "Fitness", "Cooking", "Science", "Travel", "Finance", "Design"];
export function InterestsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const add = () => { const t = text.trim().slice(0, 30); if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...value, t]); setText(""); };
  const all = [...SUGGESTED, ...value.filter((v) => !SUGGESTED.includes(v))];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{all.map((t) => <Chip key={t} label={t} on={value.includes(t)} onPress={() => toggle(t)} />)}</View>
      <TextField placeholder="Add your own" value={text} maxLength={30} onChangeText={setText} onSubmitEditing={add} returnKeyType="done" accessibilityLabel="Add an interest" />
    </View>
  );
}
