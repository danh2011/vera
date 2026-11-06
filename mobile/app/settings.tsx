import { useCallback, useState, type ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import type { AuditEvent, ServerSettings, SessionRowInfo } from "../../shared/types";
import { errMsg } from "../src/api/errors";
import { useConnection, useSession } from "../src/state/app";
import { useSettings } from "../src/state/settings";
import { useToast } from "../src/state/toast";
import { fmtDateTime } from "../src/lib/dates";
import { useTheme } from "../src/theme";
import { Button } from "../src/ui/Button";
import { Segmented, TextField, ToggleRow } from "../src/ui/Field";
import { Badge, Card, ErrorBox, Loading, Screen, ScreenHeader } from "../src/ui/Screen";
import { ConfirmDialog, Sheet } from "../src/ui/Sheet";
import { Text } from "../src/ui/Text";
import { AccentPicker, InterestsEditor } from "../src/features/Pickers";
import { Onboarding } from "../src/features/Onboarding";

const Section = ({ title, children }: { title: string; children: ReactNode }) => <View style={{ gap: 8, marginTop: 26 }}><Text variant="h3" accessibilityRole="header">{title}</Text>{children}</View>;
const Metric = ({ k, v }: { k: string; v: string }) => <View style={{ minWidth: "45%", flexGrow: 1, paddingVertical: 4 }}><Text variant="tiny" muted>{k}</Text><Text weight="semibold">{v}</Text></View>;

export default function SettingsScreen() {
  const { settings: s, update } = useSettings(); const { serverUrl, changeServer } = useConnection(); const { username, signOut } = useSession(); const [setup, setSetup] = useState(false); const [ask, setAsk] = useState(false);
  return (
    <Screen>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <Section title="Profile">
          <TextField label="Name" value={s.name} maxLength={40} onChangeText={(name) => update({ name })} placeholder="What should Vera call you?" />
          <Text variant="small" weight="medium" style={{ marginTop: 6 }}>Interests</Text><InterestsEditor value={s.interests} onChange={(interests) => update({ interests })} />
          <Button label="Re-run setup" onPress={() => setSetup(true)} style={{ marginTop: 6 }} />
        </Section>
        <Section title="Appearance">
          <Text variant="small" weight="medium">Theme</Text>
          <Segmented value={s.theme} onChange={(theme) => update({ theme })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
          <Text variant="small" weight="medium" style={{ marginTop: 6 }}>Accent colour</Text><AccentPicker value={s.accent} onChange={(accent) => update({ accent })} />
          <ToggleRow title="Compact mode" subtitle="Tighter spacing" value={s.compact} onChange={(compact) => update({ compact })} />
          <ToggleRow title="Reduce motion" subtitle="Skip animations" value={s.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} />
          <ToggleRow title="Haptic feedback" subtitle="Small vibrations when you tap and approve" value={s.haptics} onChange={(haptics) => update({ haptics })} />
        </Section>
        <Section title="Chat"><ToggleRow title="Enter sends" subtitle="Off: Enter adds a new line and you tap the arrow to send" value={s.enterToSend} onChange={(enterToSend) => update({ enterToSend })} /></Section>
        <Section title="Voice">
          <ToggleRow title="Speak replies" subtitle="Read each new reply aloud with your phone's voice" value={s.speakReplies} onChange={(speakReplies) => update({ speakReplies })} />
          <Text variant="small" muted>Dictation uses your phone's speech recognition and only listens while you're dictating. Voice, speed and pitch are set in Android's text-to-speech settings.</Text>
        </Section>
        <Section title="Server">
          <Card style={{ gap: 4 }}><Text variant="tiny" muted>Connected to</Text><Text variant="mono" selectable>{serverUrl}</Text>{username ? <Text variant="small" muted>Signed in as {username}</Text> : null}</Card>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}><Button label="Sign out" onPress={() => void signOut()} /><Button label="Use a different server" kind="outline-danger" onPress={() => setAsk(true)} /></View>
        </Section>
        <ServerSections />
        <Section title="About"><Text>Vera for Android · v{Constants.expoConfig?.version ?? "?"}</Text><Text variant="small" muted>Conversations, tasks, notes and memory live in Vera's database on your server. Only appearance settings and the server address are stored on this phone, and the sign-in token is kept in Android's encrypted storage.</Text></Section>
      </ScrollView>
      <Modal visible={setup} animationType="slide" onRequestClose={() => setSetup(false)} statusBarTranslucent navigationBarTranslucent><Onboarding onClose={() => setSetup(false)} /></Modal>
      <ConfirmDialog visible={ask} title="Use a different server?" body="You'll be signed out and asked for a new address. Nothing on the server is changed." confirmLabel="Disconnect" onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); void changeServer(); }} />
    </Screen>
  );
}

function ServerSections() {
  const api = useConnection().api!; const toast = useToast(); const router = useRouter(); const { signOut } = useSession(); const { c } = useTheme();
  const [st, setSt] = useState<ServerSettings | null>(null); const [err, setErr] = useState(""); const [sessions, setSessions] = useState<SessionRowInfo[]>([]); const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [ack1, setAck1] = useState(false); const [ack2, setAck2] = useState(false); const [lim, setLim] = useState({ perMinute: "", perDay: "" }); const [pw, setPw] = useState({ cur: "", next: "" }); const [busy, setBusy] = useState(false); const [pwOpen, setPwOpen] = useState(false);
  const load = useCallback(async () => { setErr(""); try { const [a, b, x] = await Promise.all([api.getServerSettings(), api.listSessions(), api.listAudit(15)]); setSt(a); setSessions(b); setAudit(x); setLim({ perMinute: String(a.ai.limits.perMinute), perDay: String(a.ai.limits.perDay) }); } catch (e) { setErr(errMsg(e)); } }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); toast(ok, "success"); await load(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); } };
  if (err) return <View style={{ marginTop: 26 }}><ErrorBox message={`Couldn't load server settings. ${err}`} onRetry={() => void load()} /></View>;
  if (!st) return <Loading label="Loading server settings…" />;
  const ai = st.ai;
  return (<>
    <Section title="AI provider (Gemini)">
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Text>Status</Text><Badge tone={ai.ready ? "ok" : "warn"} label={ai.ready ? "Ready" : "Not active"} />{ai.ready && ai.circuit === "open" ? <Badge tone="warn" label="Paused after errors" /> : null}</View>
      {ai.reason ? <Text muted>{ai.reason}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <Metric k="API key" v={ai.keyConfigured ? "Configured on the server" : "Not configured"} /><Metric k="Model" v={ai.model ?? "Not set"} />
        <Metric k="Requests today" v={`${ai.usage.today.requests} of ${ai.limits.perDay}${ai.usage.today.failures ? ` · ${ai.usage.today.failures} failed` : ""}`} /><Metric k="Tokens today" v={`${ai.usage.today.inputTokens.toLocaleString()} in · ${ai.usage.today.outputTokens.toLocaleString()} out`} />
        <Metric k="Per minute" v={`${ai.usage.thisMinute} of ${ai.limits.perMinute}`} /><Metric k="Tool steps per message" v={String(ai.limits.toolRounds)} />
      </View>
      <Text variant="small" muted>Vera shows token counts reported by the provider. It does not show a money estimate because it holds no verified pricing. Check your quota in Google AI Studio.</Text>
      {ai.keyConfigured && ai.modelConfigured && !st.aiAcknowledged ? (
        <Card style={{ gap: 6, borderLeftWidth: 3, borderLeftColor: c.warn }}>
          <Text><Text weight="semibold">Before enabling: </Text>Gemini access depends on your Google account's eligibility and quota, which Vera cannot verify for you.</Text>
          <ToggleRow title="I've checked that my account is eligible to use the Gemini API." value={ack1} onChange={setAck1} /><ToggleRow title="I've checked my quota and billing settings so I won't be charged unexpectedly." value={ack2} onChange={setAck2} />
          <Button label="Confirm and allow Gemini" kind="primary" disabled={!ack1 || !ack2 || busy} onPress={() => void run(() => api.acknowledgeAi(), "Confirmed")} />
        </Card>) : null}
      {st.aiAcknowledged ? <ToggleRow title="Allow Vera to use Gemini" value={ai.enabled} disabled={busy} onChange={(v) => void run(() => api.updateAi({ enabled: v }), v ? "Gemini on" : "Gemini off")} /> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <TextField style={{ flex: 1 }} label="Requests per minute" keyboardType="number-pad" value={lim.perMinute} onChangeText={(perMinute) => setLim({ ...lim, perMinute })} /><TextField style={{ flex: 1 }} label="Requests per day" keyboardType="number-pad" value={lim.perDay} onChangeText={(perDay) => setLim({ ...lim, perDay })} />
      </View>
      <Button label="Save limits" disabled={busy} onPress={() => void run(() => api.updateAi({ limits: { perMinute: Number(lim.perMinute), perDay: Number(lim.perDay) } }), "Limits saved")} />
      <Text variant="small" muted>You can lower these limits here; the server's configuration sets the maximum.</Text>
    </Section>
    <Section title="Privacy policy">
      <Text>Banking details, card numbers, passwords, keys and sensitive personal identifiers are blocked before anything reaches a cloud AI or a cloud-bound tool. The check runs on the server, in code, and the model cannot override it.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}><Metric k="Blocked by default" v={st.privacy.blockedByDefault.map((x) => x.toLowerCase().replace(/_/g, " ")).join(", ")} /><Metric k="Last 24 hours" v={`${st.privacy.last24h.blocked} blocked of ${st.privacy.last24h.total} flagged`} /></View>
      {st.privacy.recent.slice(0, 5).map((r, k) => <Text key={k} variant="small">{r.blocked ? "Blocked" : "Redacted"} · {r.classification.toLowerCase().replace(/_/g, " ")} · {r.source} <Text variant="small" muted>{fmtDateTime(r.at)}</Text></Text>)}
      <Text variant="small" muted>{st.privacy.disclaimer} Only minimal metadata is recorded, never the content.</Text>
    </Section>
    <Section title="Access and integrations">
      <Text muted>What Vera can reach is controlled per integration, with explicit permissions.</Text><Button label="Open Integrations" onPress={() => router.navigate("/integrations")} />
      <Text variant="small" muted>File access: {st.files.rootCount ? `${st.files.rootCount} approved folder${st.files.rootCount === 1 ? "" : "s"}` : "no folders approved"} · Server diagnostics: {st.machine.readonly ? "read-only, on" : "off"} · Search: {st.storage.fts5 ? "full-text (FTS5)" : "basic fallback"}</Text>
    </Section>
    <Section title="Account and security">
      <Text variant="small" muted>{st.security.secureCookies ? "Secure cookies on" : "Secure cookies off (plain http: use only on your local network)"} · CSRF protection on · Reverse-proxy headers {st.security.trustedProxy ? "trusted from configured proxies" : "not trusted"}</Text>
      <Text variant="small" weight="medium">Signed-in sessions</Text>
      {sessions.map((x) => <Text key={x.id} variant="small">{x.current ? "This device" : "Another device"} · {x.userAgent?.slice(0, 40) ?? "unknown"} <Text variant="small" muted>last used {fmtDateTime(x.lastSeenAt)}</Text></Text>)}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}><Button label="Sign out other devices" disabled={busy || sessions.length < 2} onPress={() => void run(async () => { await api.revokeOtherSessions(); }, "Other sessions signed out")} /><Button label="Change password" onPress={() => setPwOpen(true)} /><Button label="Sign out" kind="ghost" onPress={() => void signOut()} /></View>
    </Section>
    <Section title="Recent activity">
      {audit.length ? audit.map((a) => <Text key={a.id} variant="small"><Text variant="mono">{a.action}</Text>{a.subject ? ` · ${a.subject}` : ""} · {a.outcome} <Text variant="small" muted>{fmtDateTime(a.createdAt)}</Text></Text>) : <Text muted>Nothing yet.</Text>}
      <Text variant="small" muted>Security-relevant events only; no message content or secrets.</Text>
    </Section>
    <Sheet visible={pwOpen} onClose={() => setPwOpen(false)} title="Change password" footer={<View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Button label="Cancel" wide onPress={() => setPwOpen(false)} /></View><View style={{ flex: 1 }}><Button label="Change" kind="primary" wide disabled={busy || !pw.cur || pw.next.length < 8} onPress={() => void run(async () => { await api.changePassword(pw.cur, pw.next); setPw({ cur: "", next: "" }); setPwOpen(false); }, "Password changed")} /></View></View>}>
      <View style={{ gap: 14, paddingTop: 8 }}><TextField label="Current password" secret autoCapitalize="none" value={pw.cur} onChangeText={(cur) => setPw({ ...pw, cur })} /><TextField label="New password" secret autoCapitalize="none" value={pw.next} onChangeText={(next) => setPw({ ...pw, next })} help="At least 8 characters." /></View>
    </Sheet>
  </>);
}
