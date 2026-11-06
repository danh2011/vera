import { createElement } from "react";
import { View } from "react-native";
import { AlertTriangle, CheckCircle2, CircleSlash, Cloud, HardDrive, KeyRound, Lock, XCircle } from "lucide-react-native";
import type { IntegrationSummary, TestCode } from "../../../../shared/types";
import { FONT, RADIUS, useTheme } from "../../theme";
import { Text } from "../../ui/Text";
import { TEST_COPY, TONE, iconFor, when } from "./util";

export function StatusBadge({ s }: { s: Pick<IntegrationSummary, "status" | "statusLabel"> }) {
  const { c } = useTheme(); const tone = TONE[s.status]; const col = tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "danger" ? c.danger : c.muted;
  const I = s.status === "connected" || s.status === "ready" ? CheckCircle2 : s.status === "error" ? XCircle : s.status === "unavailable" ? CircleSlash : s.status === "needs_setup" || s.status === "needs_authorisation" || s.status === "degraded" ? AlertTriangle : null;
  return <View accessibilityLabel={`Status: ${s.statusLabel}`} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: tone === "muted" ? c.border : col, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 2, backgroundColor: c.raised }}>{I ? <I size={12} color={col} /> : null}<Text variant="tiny" style={{ color: col, fontFamily: FONT.medium }}>{s.statusLabel}</Text></View>;
}
export function Tag({ label, icon: I, ok }: { label: string; icon?: typeof Cloud; ok?: boolean }) {
  const { c } = useTheme();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: c.bg }}>{I ? <I size={11} color={c.muted} /> : null}<Text variant="tiny" style={{ color: ok ? c.ok : c.muted }}>{label}</Text></View>;
}
export function Where({ s }: { s: Pick<IntegrationSummary, "runsLocally" | "contactsExternalServices" | "requiresCredentials" | "authMode"> }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Tag icon={s.contactsExternalServices ? Cloud : HardDrive} label={s.contactsExternalServices ? "Uses a network service" : "Works locally"} /><Tag icon={s.requiresCredentials ? KeyRound : Lock} label={s.authMode === "oauth" ? "Sign-in required" : s.requiresCredentials ? "Needs credentials" : "No setup"} /></View>;
}
export function IntIcon({ name, size = 22 }: { name: string; size?: number }) {
  const { c } = useTheme();
  return <View accessibilityElementsHidden style={{ width: size + 20, height: size + 20, borderRadius: 12, backgroundColor: c.raised, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" }}>{createElement(iconFor(name), { size, color: c.accent })}</View>;
}
export function TestResultView({ code, message, at }: { code: TestCode; message: string; at?: string }) {
  const { c } = useTheme(); const cp = TEST_COPY[code]; const col = cp.tone === "ok" ? c.ok : cp.tone === "warn" ? c.warn : c.danger;
  return (
    <View accessibilityRole="summary" style={{ borderWidth: 1, borderColor: col, borderRadius: RADIUS.md, padding: 12, gap: 4, backgroundColor: c.bg, marginVertical: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{cp.tone === "ok" ? <CheckCircle2 size={15} color={col} /> : <AlertTriangle size={15} color={col} />}<Text weight="semibold">{cp.title}</Text></View>
      <Text>{message}</Text>{cp.hint ? <Text variant="small" muted>{cp.hint}</Text> : null}{at ? <Text variant="tiny" muted>Tested {when(at)}</Text> : null}
    </View>
  );
}
