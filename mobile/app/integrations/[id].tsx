import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Check, Minus, X } from "lucide-react-native";
import type { ActionResult, IntegrationDetail, TestResult, ToolInfo } from "../../../shared/types";
import { errMsg } from "../../src/api/errors";
import { useApi } from "../../src/state/app";
import { useToast } from "../../src/state/toast";
import { useTheme } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { ToggleRow } from "../../src/ui/Field";
import { Badge, Card, ErrorBox, Loading, Screen, ScreenHeader, SectionTitle } from "../../src/ui/Screen";
import { ConfirmDialog } from "../../src/ui/Sheet";
import { Text } from "../../src/ui/Text";
import { IntIcon, StatusBadge, Tag, TestResultView, Where } from "../../src/features/integrations/parts";
import { ACTION_LABEL, DEP_ACTION, OPEN_ROUTE, needsWizard, when } from "../../src/features/integrations/util";

const AVAIL: Record<ToolInfo["availability"], string> = { needs_dependency: "Needs another integration", available: "Available", needs_install: "Install first", needs_enable: "Turned off", needs_configuration: "Needs setup", needs_authorisation: "Needs sign-in", permission_denied: "Permission off", unavailable: "Unavailable" };

export default function IntegrationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const api = useApi(); const toast = useToast(); const router = useRouter(); const { c } = useTheme();
  const [d, setD] = useState<IntegrationDetail | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(""); const [test, setTest] = useState<TestResult | null>(null); const [ask, setAsk] = useState(false); const [act, setAct] = useState<ActionResult | null>(null);
  const load = useCallback(async () => { setErr(""); try { setD(await api.integrations.detail(id)); } catch (e) { setErr(errMsg(e)); } }, [api, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const wizard = (step?: string) => router.push({ pathname: "/integrations/setup/[id]", params: { id, step: step ?? "" } } as never);
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); await load(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); } };
  const primary = () => {
    if (!d) return;
    if (d.nextAction === "install") return void run("install", async () => { const r = await api.integrations.install(d.id); setD(r.detail); if (needsWizard(r.detail)) { toast(`${d.name} installed. Let's set it up.`, "success"); wizard(r.detail.dependencies.some((x) => !x.satisfied) ? "deps" : undefined); } else toast(`${d.name} installed and ready.`, "success"); });
    if (d.nextAction === "configure" || d.nextAction === "connect") return wizard(d.status === "needs_dependency" ? "deps" : d.nextAction === "connect" ? "oauth" : undefined);
    if (d.nextAction === "enable") return void run("enable", async () => { setD(await api.integrations.enable(d.id)); toast(`${d.name} is on`, "success"); });
    if (d.nextAction === "open") { const r = OPEN_ROUTE[d.id]; if (r) router.navigate(r as never); else { toast(`Ask Vera in chat. For example: "${d.capabilities[0] ?? d.name}".`, "info"); router.navigate("/chat" as never); } }
  };

  return (
    <Screen>
      <ScreenHeader back title={d?.name ?? "Integration"} subtitle={d ? `${d.manifest.category.replace(/_/g, " ")} · v${d.version}` : undefined} />
      {err ? <ErrorBox message={err} onRetry={() => void load()} /> : !d ? <Loading /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><IntIcon name={d.manifest.icon} size={26} /><View style={{ flex: 1, gap: 6 }}><StatusBadge s={d} /></View></View>
          <Where s={d} />
          {d.statusDetail ? <Text variant="small" color={d.status === "error" ? c.danger : c.muted}>{d.statusDetail}</Text> : null}
          <Text>{d.description}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {d.nextAction !== "none" ? <Button label={busy === "install" ? "Installing…" : busy === "enable" ? "Turning on…" : d.nextAction === "open" && !OPEN_ROUTE[d.id] ? "Use in chat" : ACTION_LABEL[d.nextAction]} kind="primary" disabled={!!busy} loading={busy === "install" || busy === "enable"} onPress={primary} /> : null}
            {d.installed && d.status !== "unavailable" ? <Button label={d.configured ? "Reconfigure" : "Resume setup"} onPress={() => wizard()} /> : null}
          </View>
          {d.status === "unavailable" ? <Text color={c.danger} variant="small">{d.statusDetail}</Text> : null}

          <SectionTitle>Status</SectionTitle>
          <Card style={{ gap: 10 }}>
            <Line><Tick on={d.installed} /><Text>Installed</Text></Line>
            <Line><Tick on={d.configured} na={d.manifest.setup.steps.every((s) => s.kind !== "form")} /><Text>Configured{d.missing.length > 0 && d.installed ? <Text variant="small" muted> · missing: {d.missing.join(", ")}</Text> : null}</Text></Line>
            {d.authMode === "oauth" ? <Line><Tick on={d.authorised} /><Text>Signed in to provider</Text></Line> : null}
            <Line><Tick on={d.enabled} /><Text>Enabled</Text></Line>
            <Line><Tick on={d.connection === "connected"} na={d.connection === "not_applicable"} /><Text>Connected{d.connection === "untested" ? <Text variant="small" muted> · not tested yet</Text> : d.connection === "failed" ? <Text variant="small" color={c.danger}> · last test failed</Text> : null}</Text></Line>
          </Card>
          {d.installed && d.manifest.healthCheck ? <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}><Button label={busy === "test" ? "Testing…" : "Test connection"} loading={busy === "test"} disabled={!!busy || d.missing.length > 0} onPress={() => void run("test", async () => { const r = await api.integrations.test(id); setTest(r.result); setD(r.detail); })} />{d.lastSuccessAt ? <Text variant="small" muted>Last success {when(d.lastSuccessAt)}</Text> : null}</View> : null}
          {test ? <TestResultView code={test.code} message={test.message} at={test.testedAt} /> : d.lastTest && d.lastTest.code !== "ok" ? <TestResultView code={d.lastTest.code} message={d.lastTest.message} at={d.lastTest.at} /> : null}
          {d.installed && !d.manifest.required && d.configured && d.authorised ? <ToggleRow state title={d.enabled ? "On" : "Off"} subtitle={d.enabled ? "The assistant can use its tools" : "No tools can run"} value={d.enabled} disabled={!!busy} onChange={(v) => void run("toggle", async () => { setD(v ? await api.integrations.enable(d.id) : await api.integrations.disable(d.id)); })} /> : null}

          {d.dependencies.length > 0 ? <><SectionTitle>Requires</SectionTitle>{d.dependencies.map((x) => (
            <Card key={x.id} style={{ gap: 6 }}>
              <Line><Tick on={x.satisfied} /><Text weight="semibold" style={{ flex: 1 }}>{x.name}</Text><Tag label={x.satisfied ? "ready" : x.state === "available" ? "not installed" : x.state.replace(/_/g, " ")} ok={x.satisfied} /></Line>
              <Text variant="small" muted>{x.satisfied ? "Installed, set up and connected." : `${x.problem} ${x.reason}`}</Text>
              {!x.satisfied && x.action !== "none" ? <Button small label={`${x.action === "install" ? "View" : DEP_ACTION[x.action]} ${x.name}`} onPress={() => router.push(x.action === "install" ? `/integrations/${x.id}` as never : { pathname: "/integrations/setup/[id]", params: { id: x.id, step: "" } } as never)} /> : null}
            </Card>))}</> : null}

          {d.installed && d.manifest.actions && d.manifest.actions.length > 0 ? <><SectionTitle>Try it</SectionTitle>{d.manifest.actions.map((a) => (
            <View key={a.id} style={{ gap: 6 }}><Button label={busy === "action" ? "Working…" : a.label} loading={busy === "action"} disabled={!!busy || !d.configured || d.dependencies.some((x) => !x.satisfied)} onPress={() => void run("action", async () => { setAct((await api.integrations.action(d.id, a.id)).result); })} /><Text variant="small" muted>{a.help}</Text></View>))}
            {act ? <Card><Text weight="semibold" color={act.ok ? c.ok : c.danger}>{act.ok ? "Accepted" : "Didn't work"}</Text><Text>{act.message}</Text></Card> : null}</> : null}

          <SectionTitle>Privacy and data</SectionTitle>
          <Text>{d.manifest.sendsDataToThirdParty}</Text>
          {d.manifest.dataAccess.map((x) => <Text key={x} variant="small" muted>• {x}</Text>)}
          {d.manifest.externalServices.length > 0 ? <Text variant="small" muted>Contacts: {d.manifest.externalServices.join("; ")}</Text> : null}

          <SectionTitle>What it can do</SectionTitle>{d.capabilities.map((x) => <Text key={x}>• {x}</Text>)}

          <SectionTitle>Permissions</SectionTitle>
          {d.permissions.map((p) => d.installed
            ? <ToggleRow key={p.id} state title={`${p.label}`} subtitle={`${p.access} · ${p.reason} Accesses: ${p.dataAccessed}.`} value={p.granted} disabled={!!busy} onChange={(v) => void run("perm", async () => { setD(await api.integrations.setPermission(d.id, p.id, v)); })} />
            : <View key={p.id} style={{ gap: 2, paddingVertical: 6 }}><View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Text weight="semibold">{p.label}</Text><Tag label={p.access} />{!p.defaultGranted ? <Tag label="off until you turn it on" /> : null}</View><Text variant="small" muted>{p.reason} Accesses: {p.dataAccessed}.</Text></View>)}

          <SectionTitle count={d.tools.length}>Tools</SectionTitle>
          {d.tools.map((t) => (
            <View key={t.name} style={{ gap: 3, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}><Text variant="mono">{t.name}</Text><Tag label={AVAIL[t.availability]} ok={t.availability === "available"} />{t.requiresConfirmation ? <Tag label="asks first" /> : null}{t.readOnly ? <Tag label="read-only" /> : null}</View>
              <Text variant="small" muted>{t.description}</Text>{t.availability !== "available" && t.availabilityReason ? <Text variant="small" color={c.warn}>{t.availabilityReason}</Text> : null}
            </View>))}

          {d.installed && d.configSchema.length > 0 ? <><SectionTitle>Saved settings</SectionTitle>
            {d.configSchema.map((f) => <View key={f.key} style={{ paddingVertical: 4 }}><Text variant="tiny" muted>{f.label}</Text><Text weight="medium">{f.type === "secret" ? (d.secretsSaved[f.key] ? "Credential saved" : "Credential not configured") : Array.isArray(d.config[f.key]) ? `${(d.config[f.key] as string[]).length} entries` : String(d.config[f.key] ?? "Not set")}</Text></View>)}
            <Text variant="small" muted>Secrets are encrypted on the server and never shown again. To replace one, choose Reconfigure.</Text></> : null}

          <SectionTitle>Setup and troubleshooting</SectionTitle>
          {d.manifest.setup.requirements.length > 0 ? <><Text variant="small" muted>You'll need:</Text>{d.manifest.setup.requirements.map((r) => <Text key={r}>• {r}</Text>)}</> : null}
          {d.manifest.setup.troubleshooting.map((t) => <View key={t.problem} style={{ paddingVertical: 6 }}><Text weight="semibold" variant="small">{t.problem}</Text><Text variant="small" muted>{t.fix}</Text></View>)}
          {!d.manifest.setup.requirements.length && !d.manifest.setup.troubleshooting.length ? <Text muted>Nothing to set up.</Text> : null}

          {d.installed && d.recentActivity.length > 0 ? <><SectionTitle>Recent activity</SectionTitle>{d.recentActivity.map((a, k) => <View key={k} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", paddingVertical: 4 }}><Text variant="mono">{a.tool}</Text><Badge tone={a.outcome === "ok" ? "ok" : "muted"} label={a.outcome} /><Text variant="tiny" muted>{when(a.at)}{a.durationMs !== null ? ` · ${a.durationMs} ms` : ""}</Text></View>)}</> : null}

          {d.installed && !d.manifest.required ? <><SectionTitle>Remove</SectionTitle><Text variant="small" muted>Uninstalling stops all its tools right away.</Text><Button label={`Uninstall ${d.name}`} kind="outline-danger" disabled={!!busy} onPress={() => setAsk(true)} /></> : null}
          {d.manifest.required ? <Text variant="small" muted style={{ marginTop: 16 }}>{d.name} is part of Vera's core and can't be removed.</Text> : null}
        </ScrollView>)}
      {d ? <ConfirmDialog visible={ask} title={`Uninstall ${d.name}?`} body="This stops the assistant from using it immediately." confirmLabel="Uninstall" onCancel={() => setAsk(false)}
        onConfirm={() => { setAsk(false); void run("uninstall", async () => { const r = await api.integrations.uninstall(d.id); setD(r.detail); setTest(null); toast(`${d.name} uninstalled`, "success"); }); }}>
        <Text weight="semibold" variant="small">Will be removed</Text>{d.manifest.uninstall.removes.map((x) => <Text key={x} variant="small" muted>• {x}</Text>)}<Text variant="small" muted>• Its saved settings and any stored credentials or sign-in</Text>
        {d.dependents.length > 0 ? <><Text weight="semibold" variant="small" style={{ marginTop: 8 }}>Will stop working</Text>{d.dependents.map((x) => <Text key={x.id} variant="small" muted>• {x.name} (it relies on {d.name})</Text>)}</> : null}
        <Text weight="semibold" variant="small" style={{ marginTop: 8 }}>Will be kept</Text>{d.manifest.uninstall.keeps.length ? d.manifest.uninstall.keeps.map((x) => <Text key={x} variant="small" muted>• {x}</Text>) : <Text variant="small" muted>• Nothing of yours is stored by this integration.</Text>}
      </ConfirmDialog> : null}
    </Screen>
  );
}
const Line = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{children}</View>;

function Tick({ on, na }: { on: boolean; na?: boolean }) { const { c } = useTheme(); return na ? <Minus size={15} color={c.muted} /> : on ? <Check size={15} color={c.ok} /> : <X size={15} color={c.muted} />; }
