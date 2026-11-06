import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { AppState, Linking, Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, X } from "lucide-react-native";
import type { ActionResult, ConfigField, IntegrationDetail, TestResult } from "../../../../shared/types";
import { ApiError, errMsg } from "../../../src/api/errors";
import { useApi } from "../../../src/state/app";
import { useToast } from "../../../src/state/toast";
import { RADIUS, useTheme } from "../../../src/theme";
import { Button, IconButton } from "../../../src/ui/Button";
import { TextField, ToggleRow } from "../../../src/ui/Field";
import { Card, ErrorBox, Loading, Screen } from "../../../src/ui/Screen";
import { ActionSheet } from "../../../src/ui/Sheet";
import { Text } from "../../../src/ui/Text";
import { IntIcon, StatusBadge, Tag, TestResultView } from "../../../src/features/integrations/parts";
import { DEP_ACTION } from "../../../src/features/integrations/util";
import { GLOSSARY, buildSteps } from "../../../src/features/integrations/steps";

export default function WizardScreen() {
  const { id, step: startAt } = useLocalSearchParams<{ id: string; step?: string }>(); const api = useApi(); const router = useRouter();
  const [detail, setDetail] = useState<IntegrationDetail | null>(null); const [err, setErr] = useState("");
  const load = useCallback(async () => { setErr(""); try { setDetail(await api.integrations.detail(id)); } catch (e) { setErr(errMsg(e)); } }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Screen><ErrorBox message={err} onRetry={() => void load()} /></Screen>;
  if (!detail) return <Screen><Loading /></Screen>;
  return <Wizard detail={detail} startAt={startAt} onClose={() => (router.canGoBack() ? router.back() : router.replace("/integrations"))} />;
}

function Wizard({ detail, startAt, onClose }: { detail: IntegrationDetail; startAt?: string; onClose: () => void }) {
  const api = useApi(); const toast = useToast(); const router = useRouter(); const { c } = useTheme(); const insets = useSafeAreaInsets(); const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [d, setD] = useState(detail); const steps = useMemo(() => buildSteps(d), [d]);
  const [i, setI] = useState(() => { if (startAt) { const k = steps.findIndex((s) => s.kind === startAt); if (k >= 0) return k; } return Math.min(detail.setupStep, steps.length - 1); });
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(detail.configSchema.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...detail.config }));
  const [clear, setClear] = useState<Set<string>>(new Set()); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [test, setTest] = useState<TestResult | null>(null); const [globalErr, setGlobalErr] = useState(""); const [actRes, setActRes] = useState<ActionResult | null>(null);
  const step = steps[i]!; const last = i === steps.length - 1; const m = d.manifest; const isOAuth = m.authMode === "oauth";
  const go = (n: number) => { setGlobalErr(""); setI(n); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const setField = (k: string, v: unknown) => { setVals((o) => ({ ...o, [k]: v })); setErrors((e) => { const { [k]: _drop, ...rest } = e; void _drop; return rest; }); };

  // Coming back from the browser after signing in: re-check, so the step reflects the result.
  useEffect(() => { const sub = AppState.addEventListener("change", (s) => { if (s === "active" && step.kind === "oauth") void api.integrations.detail(d.id).then(setD).catch(() => {}); }); return () => sub.remove(); }, [api, d.id, step.kind]);

  const saveForm = async (fields: ConfigField[]): Promise<boolean> => {
    const e: Record<string, string> = {};
    for (const f of fields) { const v = vals[f.key]; if (!f.required) continue; const empty = f.type === "secret" ? !String(v ?? "").trim() && (!d.secretsSaved[f.key] || clear.has(f.key)) : Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim(); if (empty) e[f.key] = `${f.label} is required.`; }
    setErrors(e); if (Object.keys(e).length) return false;
    const values: Record<string, unknown> = {};
    for (const f of fields) { const v = vals[f.key]; if (f.type === "secret") { if (String(v ?? "").trim()) values[f.key] = v; } else if (f.type === "list") values[f.key] = Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean); else if (v !== undefined) values[f.key] = v; }
    setBusy(true); setGlobalErr("");
    try {
      const r = await api.integrations.configure(d.id, { values, clearSecrets: [...clear].filter((k) => fields.some((f) => f.key === k)), step: i + 1 });
      setD(r.detail); setClear(new Set()); setVals((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, d.configSchema.find((f) => f.key === k)?.type === "secret" ? "" : x]))); return true;
    } catch (x) { if (x instanceof ApiError && x.fields) setErrors(x.fields); else setGlobalErr(errMsg(x)); return false; } finally { setBusy(false); }
  };
  const next = async () => {
    if (step.kind === "deps" && d.dependencies.some((x) => !x.satisfied)) return setGlobalErr("Finish the requirement above first. You can come back here afterwards and your progress is kept.");
    if (step.kind === "form" && !(await saveForm(step.fields))) return;
    if (step.kind === "oauth" && !d.authorised) return setGlobalErr("Sign in first, or choose Back.");
    if (!last) { go(i + 1); if (step.kind !== "form") void api.integrations.configure(d.id, { values: {}, step: i + 1 }).catch(() => {}); }
  };
  const guard = async (fn: () => Promise<void>) => { setBusy(true); setGlobalErr(""); try { await fn(); } catch (x) { setGlobalErr(errMsg(x)); } finally { setBusy(false); } };
  const fixDep = (dep: IntegrationDetail["dependencies"][number]) => void guard(async () => { if (dep.action === "install") await api.integrations.install(dep.id); toast(`Opening ${dep.name}…`, "info"); router.replace({ pathname: "/integrations/setup/[id]", params: { id: dep.id, step: dep.action === "test" ? "test" : "" } } as never); });
  const finish = (enable: boolean) => void guard(async () => { if (enable) { setD(await api.integrations.enable(d.id)); toast(`${d.name} is on`, "success"); } else toast("Setup saved. Turn it on whenever you're ready.", "info"); onClose(); });
  const title = "step" in step ? step.step.title : step.kind === "welcome" ? "Before you start" : step.kind === "deps" ? "Requirements" : step.kind === "perms" ? "Permissions" : "All done";

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <IconButton icon={X} label="Close setup (progress is saved)" color={c.text} onPress={() => { toast("Progress saved. You can resume setup any time.", "info"); onClose(); }} />
        <IntIcon name={m.icon} size={18} />
        <View style={{ flex: 1, paddingLeft: 4 }}><Text variant="title" numberOfLines={1}>Set up {d.name}</Text><Text variant="tiny" muted accessibilityLiveRegion="polite">Step {i + 1} of {steps.length} · {title}</Text></View>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: i + 1 }} style={{ height: 3, backgroundColor: c.border, marginTop: 8 }}><View style={{ height: 3, width: `${((i + 1) / steps.length) * 100}%`, backgroundColor: c.accent }} /></View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 32 }}>
          {step.kind === "welcome" && <>
            <Text>{m.setup.intro}</Text>
            {m.setup.requirements.length > 0 ? <><Text variant="h3">You'll need</Text>{m.setup.requirements.map((r) => <Text key={r}>• {r}</Text>)}</> : null}
            <Text variant="h3">What Vera can access</Text>{m.dataAccess.map((x) => <Text key={x}>• {x}</Text>)}
            <Card style={{ borderLeftWidth: 3, borderLeftColor: c.accent }}><Text><Text weight="semibold">{m.contactsExternalServices ? "Data leaves this server: " : "Stays on this server: "}</Text>{m.sendsDataToThirdParty}</Text></Card>
            {m.authMode !== "none" ? <Glossary items={[GLOSSARY.token!, ...(isOAuth ? [GLOSSARY.oauth!, GLOSSARY.callback!] : [])]} /> : null}
          </>}

          {step.kind === "deps" && <>
            <Text>{d.name} depends on {d.dependencies.length === 1 ? "another integration" : "other integrations"}. Each must be installed, set up and <Text weight="semibold">connected</Text> (its test passed) before this one can work.</Text>
            {d.dependencies.map((x) => (
              <Card key={x.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{x.satisfied ? <Check size={16} color={c.ok} /> : <AlertTriangle size={16} color={c.warn} />}<Text weight="semibold" style={{ flex: 1 }}>{x.name}</Text><Tag label={x.satisfied ? "ready" : "not ready"} ok={x.satisfied} /></View>
                <Text variant="small" muted>{x.satisfied ? "Installed, set up and connected." : x.problem}</Text><Text variant="small" muted>{x.reason}</Text>
                {!x.satisfied && x.action !== "none" ? <Button small kind="primary" disabled={busy} label={x.action === "install" ? `Install ${x.name}` : `${DEP_ACTION[x.action]} ${x.name}`} onPress={() => fixDep(x)} /> : null}
              </Card>))}
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Button label="Check again" disabled={busy} onPress={() => void guard(async () => setD(await api.integrations.detail(d.id)))} />{d.dependencies.every((x) => x.satisfied) ? <Text variant="small" color={c.ok}>All requirements are ready.</Text> : null}</View>
          </>}

          {step.kind === "info" && step.step.body.split("\n").map((l, k) => <Text key={k}>{l}</Text>)}

          {step.kind === "form" && <>
            <Text muted>{step.step.body.split("\n")[0]}</Text>
            {d.oauthRedirectUri ? <CopyBox label="Redirect (callback) address to enter in your provider's console" value={d.oauthRedirectUri} /> : null}
            {step.fields.map((f) => <FieldInput key={f.key} integrationId={d.id} f={f} value={vals[f.key]} saved={!!d.secretsSaved[f.key]} willClear={clear.has(f.key)} error={errors[f.key]} onChange={(v) => setField(f.key, v)} onClear={() => setClear((s) => new Set(s).add(f.key))} />)}
            {step.step.body.includes("\n") ? <Glossary title="Examples and help" lines={step.step.body.split("\n").slice(1)} /> : null}
          </>}

          {step.kind === "oauth" && <>
            <Text>{step.step.body}</Text>
            {d.oauthRedirectUri ? <CopyBox label="Redirect (callback) address registered with your provider" value={d.oauthRedirectUri} /> : null}
            {d.authorised ? <Card style={{ borderColor: c.ok }}><Text weight="semibold" color={c.ok}>Signed in</Text><Text>Vera holds a sign-in token for your account. It is stored encrypted.</Text></Card>
              : <Card style={{ borderColor: c.warn }}><Text weight="semibold" color={c.warn}>Not signed in yet</Text><Text>This opens your browser. When the provider sends you back, return to Vera and this screen updates.</Text></Card>}
            <Button icon={ExternalLink} kind="primary" label={d.authorised ? "Sign in again" : "Sign in to continue"} disabled={busy} onPress={() => void guard(async () => { const r = await api.integrations.startOAuth(d.id); await Linking.openURL(r.authUrl); })} />
            <Text variant="small" muted>The provider returns you to your Vera web page, which needs you to be signed in to Vera in that browser. If it asks, sign in with the same account, then come back here.</Text>
          </>}

          {step.kind === "perms" && <>
            <Text muted>These are the things Vera may do with {d.name}. Turn off anything you're not comfortable with: it takes effect immediately.</Text>
            {d.permissions.map((p) => <ToggleRow key={p.id} state title={p.label} subtitle={`${p.access} · ${p.reason} Accesses: ${p.dataAccessed}.`} value={p.granted} onChange={(v) => void guard(async () => setD(await api.integrations.setPermission(d.id, p.id, v)))} />)}
          </>}

          {step.kind === "test" && <>
            <Text>{step.step.body}</Text>
            <Button kind="primary" label={busy ? "Testing…" : test ? "Test again" : "Test connection"} loading={busy} onPress={() => void guard(async () => { const r = await api.integrations.test(d.id); setTest(r.result); setD(r.detail); })} />
            {test ? <TestResultView code={test.code} message={test.message} at={test.testedAt} /> : d.lastTest ? <Text variant="small" muted>Last test: {d.lastTest.code === "ok" ? "succeeded" : d.lastTest.code.replace(/_/g, " ")} on {new Date(d.lastTest.at).toLocaleString()}</Text> : null}
            {m.actions?.map((a) => <View key={a.id} style={{ gap: 4 }}><Button label={a.label} disabled={busy || !d.configured} onPress={() => void guard(async () => { setActRes(null); setActRes((await api.integrations.action(d.id, a.id)).result); })} /><Text variant="small" muted>{a.help}</Text></View>)}
            {actRes ? <Card style={{ borderColor: actRes.ok ? c.ok : c.danger }}><Text weight="semibold">{actRes.ok ? "Accepted" : "Didn't work"}</Text><Text>{actRes.message}</Text></Card> : null}
            {(test ? !test.ok : d.lastTest && d.lastTest.code !== "ok") && m.setup.troubleshooting.length > 0 ? <Glossary title="Troubleshooting" lines={m.setup.troubleshooting.map((t) => `${t.problem} — ${t.fix}`)} /> : null}
          </>}

          {step.kind === "done" && <>
            <Text variant="h2">{d.configured && d.authorised ? "Setup complete" : "Setup isn't finished"}</Text><StatusBadge s={d} />
            {d.connection === "connected" ? <Text>The last connection test succeeded{d.lastSuccessAt ? ` on ${new Date(d.lastSuccessAt).toLocaleString()}` : ""}.</Text>
              : d.connection === "failed" ? <Text color={c.danger}>The last connection test failed: {d.lastTest?.message}. You can still turn it on, but its tools will report errors until this is fixed.</Text>
              : m.healthCheck && d.configured ? <Text muted>Not tested yet. Vera only shows "Connected" after a successful test.</Text> : null}
            {!d.configured ? <Text color={c.danger}>Still missing: {d.missing.join(", ")}.</Text> : null}
            {d.configured && !d.authorised ? <Text color={c.danger}>You haven't signed in to the provider yet.</Text> : null}
          </>}
          {globalErr ? <Text color={c.danger} accessibilityRole="alert">{globalErr}</Text> : null}
        </ScrollView>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg }}>
          {i > 0 ? <Button label="Back" disabled={busy} onPress={() => go(i - 1)} /> : <Button label="Save and close" disabled={busy} kind="ghost" onPress={onClose} />}
          <View style={{ flex: 1 }} />
          {!last ? <Button kind="primary" label={busy && step.kind === "form" ? "Saving…" : step.kind === "form" ? "Save and continue" : "Continue"} disabled={busy} loading={busy && step.kind === "form"} onPress={() => void next()} />
            : <><Button label="Finish, leave off" disabled={busy} onPress={() => finish(false)} /><Button kind="primary" label={d.enabled ? "Already on" : "Turn on and finish"} disabled={busy || !d.configured || !d.authorised || d.enabled} onPress={() => finish(true)} /></>}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Glossary({ items, title = "What do these terms mean?", lines }: { items?: [string, string][]; title?: string; lines?: string[] }) {
  const { c } = useTheme(); const [open, setOpen] = useState(false);
  return (
    <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.md }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }}><Text variant="small" weight="medium" style={{ flex: 1 }}>{title}</Text><ChevronDown size={16} color={c.muted} style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }} /></Pressable>
      {open ? <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>{items?.map(([t, x]) => <View key={t}><Text variant="small" weight="semibold">{t}</Text><Text variant="small" muted>{x}</Text></View>)}{lines?.map((l, k) => <Text key={k} variant="small">{l}</Text>)}</View> : null}
    </View>
  );
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const { c } = useTheme(); const toast = useToast();
  return <View style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.md, padding: 10, gap: 6 }}><Text variant="tiny" muted>{label}</Text><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text variant="mono" selectable style={{ flex: 1 }}>{value}</Text><Button small icon={Copy} label="Copy" onPress={() => { void Clipboard.setStringAsync(value); toast("Copied", "success"); }} /></View></View>;
}

function FieldInput({ integrationId, f, value, saved, willClear, error, onChange, onClear }: { integrationId: string; f: ConfigField; value: unknown; saved: boolean; willClear: boolean; error?: string; onChange: (v: unknown) => void; onClear: () => void }) {
  const { c } = useTheme();
  if (f.type === "boolean") return <ToggleRow title={f.label} subtitle={f.help} value={!!value} onChange={onChange} />;
  if (f.type === "select" || f.dynamicOptions) return <SelectField integrationId={integrationId} f={f} value={String(value ?? f.default ?? "")} error={error} onChange={onChange} />;
  if (f.type === "secret") return (
    <View style={{ gap: 4 }}>
      <TextField label={f.label} required={f.required} optional={!f.required} secret autoCapitalize="none" autoCorrect={false} value={String(value ?? "")} onChangeText={onChange} placeholder={saved && !willClear ? "Credential saved. Type to replace it." : ""} help={f.help} error={error} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text variant="tiny" color={saved && !willClear ? c.ok : c.muted}>{willClear ? "This credential will be removed when you continue." : saved ? "✓ Credential saved" : "Credential not configured"}</Text>
        {saved && !willClear ? <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8}><Text variant="tiny" color={c.accentH} style={{ textDecorationLine: "underline" }}>Remove</Text></Pressable> : null}
      </View>
    </View>);
  if (f.type === "list") return <TextField label={f.label} required={f.required} optional={!f.required} multiline autoCapitalize="none" autoCorrect={false} value={Array.isArray(value) ? (value as string[]).join("\n") : String(value ?? "")} onChangeText={onChange} placeholder={f.placeholder} help={f.help} error={error} inputStyle={{ minHeight: 110 }} />;
  return <TextField label={f.label} required={f.required} optional={!f.required} autoCapitalize="none" autoCorrect={false} value={String(value ?? "")} onChangeText={onChange} placeholder={f.placeholder} help={f.help} error={error} keyboardType={f.type === "number" ? "numeric" : f.type === "url" ? "url" : "default"} />;
}

function SelectField({ integrationId, f, value, error, onChange }: { integrationId: string; f: ConfigField; value: string; error?: string; onChange: (v: string) => void }) {
  const api = useApi(); const { c } = useTheme(); const [open, setOpen] = useState(false); const [live, setLive] = useState<{ value: string; label: string }[] | null>(f.dynamicOptions ? null : []); const [msg, setMsg] = useState(""); const [n, setN] = useState(0);
  useEffect(() => {
    if (!f.dynamicOptions) return; let on = true; setLive(null); setMsg("");
    api.integrations.options(integrationId, f.key).then((r) => { if (!on) return; setLive(r.options); if (r.error) setMsg(r.error); else if (!r.options.length) setMsg("Home Assistant didn't list any. Sign in to its phone app first, then refresh."); }).catch((e) => { if (on) { setMsg(errMsg(e)); setLive([]); } });
    return () => { on = false; };
  }, [api, integrationId, f.key, f.dynamicOptions, n]);
  const opts = f.dynamicOptions ? live ?? [] : f.options ?? []; const cur = opts.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="small" weight="medium">{f.label}{f.required ? <Text variant="small" color={c.danger}> *</Text> : <Text variant="small" muted> (optional)</Text>}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${f.label}: ${cur?.label ?? "choose"}`} disabled={live === null} onPress={() => setOpen(true)} style={{ flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: error ? c.danger : c.border, backgroundColor: c.bg }}>
          <Text style={{ flex: 1 }} muted={!cur && !value}>{live === null ? "Loading…" : cur?.label ?? (value ? `${value} (not found)` : "Choose…")}</Text><ChevronDown size={16} color={c.muted} />
        </Pressable>
        {f.dynamicOptions ? <Button label="Refresh" small onPress={() => setN(n + 1)} style={{ alignSelf: "center" }} /> : null}
      </View>
      {f.help ? <Text variant="tiny" muted>{f.help}</Text> : null}{msg ? <Text variant="small" color={c.danger}>{msg}</Text> : null}{error ? <Text variant="small" color={c.danger}>{error}</Text> : null}
      <ActionSheet visible={open} onClose={() => setOpen(false)} title={f.label} actions={opts.map((o) => ({ label: o.label, selected: o.value === value, onPress: () => onChange(o.value) }))} />
    </View>
  );
}
