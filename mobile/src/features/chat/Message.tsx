import { memo, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { AlertCircle, Check, ChevronRight, Copy, RefreshCw, ShieldAlert, ShieldCheck, Volume2 } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { ChatStep, Message } from "../../api/types";
import { FONT, RADIUS, useTheme } from "../../theme";
import { fmtMs, fmtTime } from "../../lib/dates";
import { haptic } from "../../lib/haptics";
import { useToast } from "../../state/toast";
import { Button } from "../../ui/Button";
import { Text } from "../../ui/Text";
import { Markdown } from "./Markdown";

export function Avatar({ working, error }: { working?: boolean; error?: boolean }) {
  const { c } = useTheme();
  return <View accessibilityElementsHidden style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: error ? c.danger : c.accent, alignItems: "center", justifyContent: "center", marginTop: 2, opacity: working ? 0.8 : 1 }}>{error ? <AlertCircle size={15} color={c.onDanger} /> : <Text style={{ color: c.onAccent, fontFamily: FONT.bold, fontSize: 13 }}>V</Text>}</View>;
}

/** Reveals already-generated text progressively so replies feel like they stream (the server answers in one piece). */
function Reveal({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || n >= text.length) return;
    const t = setTimeout(() => setN((v) => Math.min(text.length, v + Math.max(4, Math.ceil(text.length / 60)))), 32);
    return () => clearTimeout(t);
  }, [n, text, animate]);
  return <Markdown>{animate && n < text.length ? text.slice(0, n) + " ▍" : text}</Markdown>;
}

function Steps({ steps }: { steps: ChatStep[] }) {
  const { c } = useTheme();
  return (
    <View accessibilityLabel="Steps Vera took" style={{ marginTop: 6, marginLeft: 4, gap: 8, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 12 }}>
      {steps.map((st) => (
        <View key={st.id} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <View style={{ width: 16, alignItems: "center", marginTop: 3 }}>{st.state === "running" ? <ActivityIndicator size="small" color={c.muted} style={{ transform: [{ scale: 0.6 }] }} /> : st.state === "error" ? <AlertCircle size={14} color={c.danger} /> : <Check size={14} color={c.ok} />}</View>
          <View style={{ flex: 1 }}><Text variant="small">{st.label}</Text>{st.detail ? <Text variant="tiny" muted>{st.detail}</Text> : null}</View>
          {st.ms !== undefined && st.ms >= 1 ? <Text variant="tiny" muted>{fmtMs(st.ms)}</Text> : null}
        </View>))}
    </View>
  );
}

/** One quiet line, like other assistants' "thinking" rows. Tap to see every real step. */
export function Thinking({ steps, running, startedAt, open, onToggle }: { steps: ChatStep[]; running: boolean; startedAt?: number; open: boolean; onToggle: () => void }) {
  const { c } = useTheme(); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const cur = [...steps].reverse().find((x) => x.state === "running") ?? steps[steps.length - 1]; const err = steps.some((x) => x.state === "error"); const n = steps.length;
  const total = steps.reduce((a, x) => a + (x.ms ?? 0), 0); const local = steps.some((x) => x.label.startsWith("Answered locally")); const sec = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const text = running ? `${cur?.label ?? "Starting"}…${sec >= 3 ? ` ${sec} s` : ""}` : err ? `Finished with a problem · ${n} step${n === 1 ? "" : "s"}` : local ? `Answered on your server · ${n} steps` : `Worked for ${fmtMs(total)} · ${n} step${n === 1 ? "" : "s"}`;
  return (
    <View style={{ marginBottom: 4 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={text} onPress={() => { haptic.select(); onToggle(); }} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 }}>
        {running ? <ActivityIndicator size="small" color={c.muted} /> : err ? <AlertCircle size={14} color={c.danger} /> : <Check size={14} color={c.ok} />}
        <Text variant="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{text}</Text>
        <ChevronRight size={14} color={c.muted} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
      </Pressable>
      {open ? <Steps steps={steps} /> : null}
    </View>
  );
}

function ConfirmCard({ m, busy, onResolve }: { m: Message; busy: boolean; onResolve: (a: "approve" | "cancel") => void }) {
  const { c } = useTheme(); const cf = m.confirmation!; const pending = cf.state === "pending";
  const edge = cf.state === "approved" ? c.ok : pending ? c.warn : c.muted;
  return (
    <View accessibilityRole="summary" accessibilityLabel="Approval needed" style={{ marginTop: 10, borderWidth: 1, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: edge, borderRadius: RADIUS.lg, padding: 14, gap: 10, backgroundColor: c.surface }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ShieldCheck size={17} color={edge} /><Text weight="semibold">{pending ? "Approval needed" : cf.state === "approved" ? "Approved" : cf.state === "cancelled" ? "Cancelled" : "Expired"}</Text></View>
      <Text>{cf.summary}</Text>
      {pending ? <>
        <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Approve" kind="primary" wide disabled={busy} loading={busy} onPress={() => { haptic.success(); onResolve("approve"); }} /></View><View style={{ flex: 1 }}><Button label="Cancel" wide disabled={busy} onPress={() => onResolve("cancel")} /></View></View>
        <Text variant="tiny" muted>Expires {fmtTime(cf.expiresAt)}. Vera checks this again on the server.</Text></>
        : cf.state === "expired" ? <Text variant="small" muted>This request timed out and nothing was done. Ask again if you still want it.</Text> : null}
    </View>
  );
}

function PolicyNote({ m, onUse }: { m: Message; onUse: (t: string) => void }) {
  const { c } = useTheme(); const p = m.policy!;
  return (
    <View accessibilityRole="summary" style={{ marginTop: 10, flexDirection: "row", gap: 10, borderWidth: 1, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: c.danger, borderRadius: RADIUS.lg, padding: 14, backgroundColor: c.surface }}>
      <ShieldAlert size={17} color={c.danger} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text weight="semibold">Held back by the privacy policy</Text>
        <Text variant="small" muted>Detected: {p.categories.map((x) => x.replace(/_/g, " ")).join(", ") || p.classification.toLowerCase()}. Nothing was sent to any AI provider.</Text>
        {p.redactedSuggestion ? <Button label="Use redacted text" small onPress={() => onUse(p.redactedSuggestion!)} /> : null}
      </View>
    </View>
  );
}

export interface MessageItemProps {
  m: Message; isLast: boolean; canRegenerate: boolean; fresh: boolean; open: boolean; resolving: boolean;
  onToggleSteps: () => void; onRegenerate: () => void; onResolve: (a: "approve" | "cancel") => void; onSpeak: () => void; onUseText: (t: string) => void; onMenu: () => void;
}
export const MessageItem = memo(function MessageItem(p: MessageItemProps) {
  const { c } = useTheme(); const toast = useToast(); const { m } = p;
  if (m.role === "user") {
    return (
      <Animated.View entering={FadeInDown.duration(180)} style={{ alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable onLongPress={() => { haptic.tap(); p.onMenu(); }} delayLongPress={300} accessibilityRole="text" accessibilityHint="Long press for options" style={{ backgroundColor: c.raised, borderRadius: RADIUS.xl, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 10, maxWidth: "84%" }}>
          <Text selectable style={{ fontSize: 16, lineHeight: 23 }}>{m.content}</Text>
        </Pressable>
      </Animated.View>);
  }
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
      <Avatar />
      <Pressable onLongPress={() => { haptic.tap(); p.onMenu(); }} delayLongPress={350} style={{ flex: 1, minWidth: 0 }}>
        {m.tool ? <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 1, marginBottom: 4 }}><Text variant="tiny" muted>Used {m.tool}</Text></View> : null}
        {m.steps && m.steps.length > 0 ? <Thinking steps={m.steps} running={false} open={p.open} onToggle={p.onToggleSteps} /> : null}
        <Reveal text={m.content} animate={p.fresh} />
        {m.policy ? <PolicyNote m={m} onUse={p.onUseText} /> : null}
        {m.confirmation ? <ConfirmCard m={m} busy={p.resolving} onResolve={p.onResolve} /> : null}
        <View style={{ flexDirection: "row", marginLeft: -10, marginTop: 2 }}>
          <Act icon={Copy} label="Copy message" onPress={() => { void Clipboard.setStringAsync(m.content); toast("Copied", "success"); }} />
          <Act icon={Volume2} label="Read aloud" onPress={p.onSpeak} />
          {p.isLast && p.canRegenerate ? <Act icon={RefreshCw} label="Regenerate response" onPress={p.onRegenerate} /> : null}
        </View>
      </Pressable>
    </View>
  );
});

function Act({ icon: I, label, onPress }: { icon: typeof Copy; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={() => { haptic.tap(); onPress(); }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><I size={17} color={c.muted} /></Pressable>;
}
