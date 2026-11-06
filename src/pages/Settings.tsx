import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AuditEvent, ServerSettings, SessionRowInfo } from "../../shared/types";
import { Confirm, errMsg, notifyData, useApi, useSession, useSettings, useToast } from "../context";
import { storage } from "../services/storage";
import { AccentPicker, InterestsEditor, Onboarding } from "../Onboarding";

function ServerSections() {
  const api = useApi(); const toast = useToast(); const { signOut } = useSession();
  const [st, setSt] = useState<ServerSettings | null>(null); const [err, setErr] = useState(""); const [sessions, setSessions] = useState<SessionRowInfo[]>([]); const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [ack1, setAck1] = useState(false); const [ack2, setAck2] = useState(false); const [lim, setLim] = useState({ perMinute: "", perDay: "" }); const [pw, setPw] = useState({ cur: "", next: "" }); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setErr(""); try { const [a, b, c] = await Promise.all([api.getServerSettings(), api.listSessions(), api.listAudit(15)]); setSt(a); setSessions(b); setAudit(c); if (a) setLim({ perMinute: String(a.ai.limits.perMinute), perDay: String(a.ai.limits.perDay) }); } catch (e) { setErr(errMsg(e)); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); toast(ok, "success"); await load(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); } };
  if (err) return <section><div role="alert" className="errbox col"><span>Couldn't load server settings. {err}</span><button className="btn" onClick={() => void load()}>Retry</button></div></section>;
  if (!st) return <section><p className="muted" role="status">Loading server settings…</p></section>;
  const ai = st.ai;
  return (<>
    <section><h2>AI provider (Gemini)</h2>
      <p>Status: <span className={`badge ${ai.ready ? "" : "warn"}`}>{ai.ready ? "Ready" : "Not active"}</span>{ai.ready && ai.circuit === "open" && <span className="badge warn">Paused after errors</span>}</p>
      {ai.reason && <p className="muted">{ai.reason}</p>}
      <dl className="metrics"><div><dt>API key</dt><dd>{ai.keyConfigured ? "Configured on the server (never shown)" : "Not configured"}</dd></div><div><dt>Model</dt><dd>{ai.model ?? "Not set"}</dd></div><div><dt>Requests today</dt><dd>{ai.usage.today.requests} of {ai.limits.perDay}{ai.usage.today.failures ? ` · ${ai.usage.today.failures} failed` : ""}</dd></div><div><dt>Tokens today</dt><dd>{ai.usage.today.inputTokens.toLocaleString()} in · {ai.usage.today.outputTokens.toLocaleString()} out</dd></div><div><dt>Per minute</dt><dd>{ai.usage.thisMinute} of {ai.limits.perMinute}</dd></div><div><dt>Tool steps per message</dt><dd>{ai.limits.toolRounds}</dd></div></dl>
      <p className="small muted">Vera shows token counts reported by the provider. It does not show a money estimate because it holds no verified pricing. Check your quota in Google AI Studio.</p>
      {ai.keyConfigured && ai.modelConfigured && ai.enabled !== undefined && !st.aiAcknowledged && <div className="notice"><p><strong>Before enabling:</strong> Gemini access depends on your Google account's eligibility and quota, which Vera cannot verify for you.</p>
        <label className="check"><input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} /> I've checked that my account is eligible to use the Gemini API.</label>
        <label className="check"><input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} /> I've checked my quota and billing settings so I won't be charged unexpectedly.</label>
        <button className="btn primary" disabled={!ack1 || !ack2 || busy} onClick={() => void run(() => api.acknowledgeAi(), "Confirmed")}>Confirm and allow Gemini</button></div>}
      {st.aiAcknowledged && <label className="check"><input type="checkbox" checked={ai.enabled} disabled={busy} onChange={(e) => void run(() => api.updateAi({ enabled: e.target.checked }), e.target.checked ? "Gemini on" : "Gemini off")} /> Allow Vera to use Gemini</label>}
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void run(() => api.updateAi({ limits: { perMinute: Number(lim.perMinute), perDay: Number(lim.perDay) } }), "Limits saved"); }}>
        <label>Requests per minute<input type="number" min={1} max={600} value={lim.perMinute} onChange={(e) => setLim({ ...lim, perMinute: e.target.value })} /></label>
        <label>Requests per day<input type="number" min={1} max={100000} value={lim.perDay} onChange={(e) => setLim({ ...lim, perDay: e.target.value })} /></label>
        <button className="btn" disabled={busy}>Save limits</button></form>
      <p className="small muted">You can lower these limits here; the server's configuration sets the maximum.</p></section>
    <section><h2>Privacy policy</h2>
      <p>Banking details, card numbers, passwords, keys and sensitive personal identifiers are blocked before anything reaches a cloud AI or a cloud-bound tool. The check runs on the server, in code, and the model cannot override it.</p>
      <dl className="metrics"><div><dt>Blocked by default</dt><dd>{st.privacy.blockedByDefault.map((c) => c.toLowerCase().replace(/_/g, " ")).join(", ")}</dd></div><div><dt>Last 24 hours</dt><dd>{st.privacy.last24h.blocked} blocked of {st.privacy.last24h.total} flagged</dd></div></dl>
      {st.privacy.recent.length > 0 && <ul className="plain">{st.privacy.recent.slice(0, 5).map((r, k) => <li key={k}>{r.blocked ? "Blocked" : "Redacted"} · {r.classification.toLowerCase().replace(/_/g, " ")} · {r.source} <span className="muted small">{new Date(r.at).toLocaleString()}</span></li>)}</ul>}
      <p className="small muted">{st.privacy.disclaimer} Only minimal metadata is recorded, never the content.</p></section>
    <section><h2>Access and integrations</h2><p className="muted">What Vera can reach is controlled per integration, with explicit permissions.</p>
      <p><Link className="btn" to="/integrations">Open Integrations</Link></p>
      <p className="small muted">File access: {st.files.rootCount ? `${st.files.rootCount} approved folder${st.files.rootCount === 1 ? "" : "s"}` : "no folders approved"} · Server diagnostics: {st.machine.readonly ? "read-only, on" : "off"} · Search: {st.storage.fts5 ? "full-text (FTS5)" : "basic fallback"}</p></section>
    <section><h2>Account and security</h2>
      <p className="small muted">{st.security.secureCookies ? "Secure cookies on" : "Secure cookies off (plain http: use only on localhost)"} · CSRF protection on · Reverse-proxy headers {st.security.trustedProxy ? "trusted from configured proxies" : "not trusted"}</p>
      <h3>Signed-in sessions</h3>
      <ul className="plain">{sessions.map((x) => <li key={x.id}>{x.current ? "This device" : "Another device"} · {x.userAgent?.slice(0, 50) ?? "unknown"} <span className="muted small">last used {new Date(x.lastSeenAt).toLocaleString()}</span></li>)}</ul>
      <div className="row wrap"><button className="btn" disabled={busy || sessions.length < 2} onClick={() => void run(async () => { await api.revokeOtherSessions(); }, "Other sessions signed out")}>Sign out other devices</button><button className="btn" onClick={() => void signOut()}>Sign out</button></div>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.changePassword(pw.cur, pw.next); setPw({ cur: "", next: "" }); }, "Password changed"); }}>
        <label>Current password<input type="password" autoComplete="current-password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} /></label>
        <label>New password<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        <button className="btn" disabled={busy || !pw.cur || pw.next.length < 8}>Change password</button></form></section>
    <section><h2>Recent activity</h2>{audit.length ? <ul className="plain">{audit.map((a) => <li key={a.id}><code>{a.action}</code>{a.subject ? ` · ${a.subject}` : ""} · {a.outcome} <span className="muted small">{new Date(a.createdAt).toLocaleString()}</span></li>)}</ul> : <p className="muted">Nothing yet.</p>}
      <p className="small muted">Security-relevant events only; no message content or secrets.</p></section>
    <section><h2>Your data</h2><p className="muted">Conversations, tasks, notes and memory live in Vera's database on your server. Back up the data folder (see docs/database.md). Appearance settings below are stored in this browser only.</p></section>
  </>);
}

export default function SettingsPage() {
  const api = useApi(); const mock = api.kind === "mock"; const { settings: s, update, reload } = useSettings(); const toast = useToast(); const [ask, setAsk] = useState<"clear" | "reset" | null>(null); const [setup, setSetup] = useState(false);
  const recog = !!(window as unknown as Record<string, unknown>).SpeechRecognition || !!(window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  const tts = "speechSynthesis" in window;
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: storage.exportAll() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "vera-export.json"; a.click(); URL.revokeObjectURL(a.href); toast("Exported", "success");
  };
  const Toggle = ({ k, label }: { k: "compact" | "reduceMotion" | "enterToSend" | "speakReplies" | "allowFiles" | "allowTools"; label: string }) =>
    <label className="check"><input type="checkbox" checked={s[k]} onChange={(e) => update({ [k]: e.target.checked })} /> {label}</label>;
  return (
    <main className="page">
      <h1>Settings</h1>
      <section><h2>Profile</h2>
        <label>Name<input value={s.name} maxLength={40} onChange={(e) => update({ name: e.target.value })} placeholder="What should Vera call you?" /></label>
        <div>Interests<InterestsEditor value={s.interests} onChange={(interests) => update({ interests })} /></div>
        <button className="btn" onClick={() => setSetup(true)}>Re-run setup</button></section>
      <section><h2>Appearance</h2>
        <label>Theme<select value={s.theme} onChange={(e) => update({ theme: e.target.value as typeof s.theme })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
        <div>Accent colour<AccentPicker value={s.accent} onChange={(accent) => update({ accent })} /></div>
        <Toggle k="compact" label="Compact mode" /><Toggle k="reduceMotion" label="Reduce motion" /></section>
      <section><h2>Chat</h2><Toggle k="enterToSend" label="Enter sends (Shift+Enter for a new line)" /></section>
      <section><h2>Voice</h2><Toggle k="speakReplies" label="Speak replies" />
        <p className="small muted">Speech recognition: {recog ? "available" : "not available in this browser"} · Speech output: {tts ? "available" : "not available"}. The microphone only starts when you press the mic button.</p></section>
      {mock ? <>
      <section><h2>Access</h2><p className="muted">Demo mode. Nothing is accessed.</p></section>
      <section><h2>AI and providers</h2><p>Mode: <span className="badge warn">Local demo</span></p>
        <p className="muted">No real model is configured and none is contacted.</p></section>
      <section><h2>Privacy and data</h2>
        <p className="muted">Demo data is kept in this browser's local storage (namespace <code>vera:v1:</code>). Nothing is sent anywhere.</p>
        <div className="row wrap"><button className="btn" onClick={exportData}>Export JSON</button><button className="btn" onClick={() => setAsk("reset")}>Reset demo data</button><button className="btn danger" onClick={() => setAsk("clear")}>Clear all data</button></div></section>
      <section><h2>About</h2><p>Vera · demo mode (development only)</p></section></> : <ServerSections />}
      {setup && <Onboarding onClose={() => setSetup(false)} />}
      {ask && <Confirm title={ask === "clear" ? "Clear all local data?" : "Reset demo data?"} confirmLabel={ask === "clear" ? "Clear everything" : "Reset"}
        body={ask === "clear" ? "This permanently deletes every conversation, task, memory and setting on this device. Export first if you want a copy." : "This replaces your data with the original sample data."}
        onCancel={() => setAsk(null)} onConfirm={() => { const keep = storage.read("settings"); storage.clear(ask === "clear"); if (ask === "reset" && keep) storage.write("settings", keep); reload(); notifyData(); setAsk(null); toast(ask === "clear" ? "All data cleared" : "Demo data restored", "success"); }} />}
    </main>
  );
}
