import { Pressable, View } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { CalendarDays, Clock, X } from "lucide-react-native";
import { FONT, HIT, RADIUS, useTheme } from "../theme";
import { Text } from "../ui/Text";

/** Due date and time through Android's own pickers (native dialogs, so they match the rest of the phone). */
export function DateField({ label, value, onChange }: { label: string; value: Date | null; onChange: (d: Date | null) => void }) {
  const { c } = useTheme();
  const pick = (mode: "date" | "time") => DateTimePickerAndroid.open({ value: value ?? new Date(Date.now() + 3600_000), mode, is24Hour: true, onChange: (e, d) => {
    if (e.type !== "set" || !d) return;
    const base = value ?? new Date(); const next = new Date(base);
    if (mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    if (!value && mode === "date") next.setHours(9, 0, 0, 0);
    onChange(next);
  } });
  return (
    <View style={{ gap: 6 }}>
      <Text variant="small" weight="medium">{label} <Text variant="small" muted>(optional)</Text></Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Btn muted={!value} icon={CalendarDays} a11y="Choose due date" text={value ? value.toLocaleDateString([], { dateStyle: "medium" }) : "No date"} onPress={() => pick("date")} />
        <Btn muted={!value} icon={Clock} a11y="Choose due time" text={value ? value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No time"} onPress={() => pick("time")} />
        {value ? <Pressable accessibilityRole="button" accessibilityLabel="Clear due date" onPress={() => onChange(null)} hitSlop={6} style={{ width: HIT, height: HIT, alignItems: "center", justifyContent: "center" }}><X size={18} color={c.muted} /></Pressable> : null}
      </View>
    </View>
  );
}

function Btn({ icon: I, text, onPress, a11y, muted }: { icon: typeof Clock; text: string; onPress: () => void; a11y: string; muted: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={{ flex: 1, minHeight: HIT, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
      <I size={16} color={c.muted} /><Text style={{ fontFamily: FONT.medium }} muted={muted}>{text}</Text>
    </Pressable>);
}
