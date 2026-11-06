import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, X } from "lucide-react";
import type { ActionResult, ConfigField, IntegrationDetail, SetupStep, TestResult } from "../../../shared/types";
import { errMsg, useApi, useToast } from "../../context";
import { ApiError } from "../../services/http";
import { StatusBadge, IntIcon, TestResultView } from "./parts";
import { DEP_ACTION, useFocusTrap } from "./util";
import { useNavigate } from "react-router-dom";

type WStep =
  | { kind: "welcome" } | { kind: "deps" } | { kind: "info"; step: SetupStep } | { kind: "form"; step: SetupStep; fields: ConfigField[] } | { kind: "oauth"; step: SetupStep }
  | { kind: "perms" } | { kind: "test"; step: SetupStep } | { kind: "done" };

export function buildSteps(d: IntegrationDetail): WStep[] {
  const out: WStep[] = [{ kind: "welcome" }]; if (d.dependencies.length) out.push({ kind: "deps" }); const fieldMap = new Map(d.configSchema.map((f) => [f.key, f]));
  const hasPerms = d.manifest.permissions.length > 0 && d.manifest.permissions.some((p) => !p.defaultGranted || d.manifest.permissions.length > 1);
  let permsAdded = false;
  for (const st of d.manifest.setup.steps) {
    if (st.kind === "test" && hasPerms && !permsAdded) { out.push({ kind: "perms" }); permsAdded = true; }
    if (st.kind === "form") out.push({ kind: "form", step: st, fields: (st.fields ?? []).map((k) => fieldMap.get(k)).filter((f): f is ConfigField => !!f) });
    else if (st.kind === "oauth") out.push({ kind: "oauth", step: st }); else if (st.kind === "test") out.push({ kind: "test", step: st }); else out.push({ kind: "info", step: st });
  }
  if (hasPerms && !permsAdded) out.push({ kind: "perms" });
  out.push({ kind: "done" }); return out;
}

const GLOSSARY: Record<string, [string, string]> = {
  token: ["Access token / API key", "A long password that lets one program (Vera) use another service without your account password. You can delete it in that service at any time."],
  oauth: ["Sign in with… (OAuth)", "You approve Vera on the provider's own website. Vera never sees your provider password and you can revoke access from your provider account."],
  callback: ["Redirect (callback) address", "Where the provider sends you back after you approve. It must match exactly what you enter in the provider's console."],
};

function CopyBox({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return <div className="copybox"><span className="small muted">{label}</span><div className="row"><code className="grow">{value}</code><button type="button" className="btn small-btn" onClick={() => { void navigator.clipboard?.writeText(value); toast("Copied", "success"); }}><Copy size={13} /> Copy</button></div></div>;
}

function LiveSelect({ id, f, value, error, onChange }: { id: string; f: ConfigField; value: unknown; error?: string; onChange: (v: string) => void }) {
  const api = useApi(); const [opts, setOpts] = useState<{ value: string; label: string }[] | null>(null); const [err, setErr] = useState(""); const [n, setN] = useState(0);
  useEffect(() => { let live = true; setOpts(null); setErr(""); api.integrations.options(id, f.key).then((r) => { if (!live) return; setOpts(r.options); if (r.error) setErr(r.error); else if (!r.options.length) setErr("Home Assistant didn't list any. Sign in to its phone app first, then refresh."); }).catch((e) => live && (setErr(errMsg(e)), setOpts([]))); return () => { live = false; }; }, [api, id, f.key, n]);
  const fid = `f-${f.key}`; const cur = String(value ?? "");
  return (
    <div className="field"><label htmlFor={fid}>{f.label}{f.required && <span className="req" aria-hidden> *</span>}</label>
      <div className="row"><select id={fid} className="grow" value={cur} aria-invalid={!!error} aria-describedby={`${fid}-help`} disabled={opts === null} onChange={(e) => onChange(e.target.value)}>
        <option value="">{opts === null ? "Loading from your Home Assistant…" : "Choose…"}</option>
        {cur && !opts?.some((o) => o.value === cur) && <option value={cur}>{cur} (not found in Home Assistant)</option>}
        {opts?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <button type="button" className="btn small-btn" onClick={() => setN(n + 1)}>Refresh</button></div>
      {f.help && <span id={`${fid}-help`} className="small muted">{f.help}</span>}
      {err && <span className="err" role="alert">{err}</span>}{error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

function FieldInput({ f, value, saved, willClear, error, onChange, onClear }: { f: ConfigField; value: unknown; saved: boolean; willClear: boolean; error?: string; onChange: (v: unknown) => void; onClear: () => void }) {
  const id = `f-${f.key}`; const help = f.help ? `${id}-help` : undefined; const err = error ? `${id}-err` : undefined; const desc = [help, err].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": !!error, "aria-describedby": desc, "aria-required": f.required || undefined } as const;
  let input: ReactNode;
  if (f.type === "secret") input = (
    <>
      <input {...common} type="password" autoComplete="new-password" spellCheck={false} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={saved && !willClear ? "Credential saved. Type here to replace it." : ""} />
      <span className="cred small" data-saved={saved && !willClear}>{willClear ? "This credential will be removed when you continue." : saved ? <><Check size={12} aria-hidden /> Credential saved</> : "Credential not configured"}
        {saved && !willClear && <> · <button type="button" className="linkbtn" onClick={onClear}>Remove</button></>}</span>
    </>
  );
  else if (f.type === "select") input = <select {...common} value={String(value ?? f.default ?? "")} onChange={(e) => onChange(e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  else if (f.type === "list") input = <textarea {...common} rows={4} spellCheck={false} value={Array.isArray(value) ? (value as string[]).join("\n") : String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === "boolean") return <label className="check"><input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.label}</label>;
  else input = <input {...common} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} inputMode={f.type === "url" ? "url" : undefined} spellCheck={false} autoComplete="off" value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="field">
      <label htmlFor={id}>{f.label}{f.required ? <span className="req" aria-hidden> *</span> : <span className="small muted"> (optional)</span>}</label>
      {input}
      {f.help && <span id={help} className="small muted">{f.help}</span>}
      {error && <span id={err} className="err" role="alert">{error}</span>}
    </div>
  );
}

export function Wizard({ detail, startAt, onClose, onUpdated }: { detail: IntegrationDetail; startAt?: "test" | "oauth" | "deps"; onClose: () => void; onUpdated: (d: IntegrationDetail) => void }) {
  const api = useApi(); const toast = useToast(); const nav = useNavigate(); const ref = useRef<HTMLDivElement>(null); const [actRes, setActRes] = useState<ActionResult | null>(null);
  const steps = useMemo(() => buildSteps(detail), [detail]);
  const [i, setI] = useState(() => { if (startAt) { const k = steps.findIndex((s) => s.kind === startAt); if (k >= 0) return k; } return Math.min(detail.setupStep, steps.length - 1); });
  const [vals, setVals] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(detail.configSchema.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...detail.config }));
  const [clear, setClear] = useState<Set<string>>(new Set()); const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [test, setTest] = useState<TestResult | null>(null); const [d, setD] = useState(detail); const [globalErr, setGlobalErr] = useState("");
  useFocusTrap(ref, () => { toast("Progress saved. You can resume setup any time.", "info"); onClose(); });
  const step = steps[i]!; const last = i === steps.length - 1; const setDetail = (n: IntegrationDetail) => { setD(n); onUpdated(n); };
  const m = d.manifest;

  const saveForm = async (fields: ConfigField[]): Promise<boolean> => {
    const e: Record<string, string> = {};
    for (const f of fields) { const v = vals[f.key]; if (!f.required) continue; const empty = f.type === "secret" ? !String(v ?? "").trim() && (!d.secretsSaved[f.key] || clear.has(f.key)) : Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim(); if (empty) e[f.key] = `${f.label} is required.`; }
    setErrors(e); if (Object.keys(e).length) { setTimeout(() => ref.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(), 0); return false; }
    const values: Record<string, unknown> = {}; for (const f of fields) { const v = vals[f.key]; if (f.type === "secret") { if (String(v ?? "").trim()) values[f.key] = v; } else if (f.type === "list") values[f.key] = Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean); else if (v !== undefined) values[f.key] = v; }
    setBusy(true); setGlobalErr("");
    try {
      const r = await api.integrations.configure(d.id, { values, clearSecrets: [...clear].filter((k) => fields.some((f) => f.key === k)), step: i + 1 });
      setDetail(r.detail); setClear(new Set()); setVals((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, d.configSchema.find((f) => f.key === k)?.type === "secret" ? "" : x]))); return true;
    } catch (x) {
      if (x instanceof ApiError && x.fields) { setErrors(x.fields); setTimeout(() => ref.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(), 0); } else setGlobalErr(errMsg(x));
      return false;
    } finally { setBusy(false); }
  };
  const recheck = async () => { setBusy(true); try { setDetail(await api.integrations.detail(d.id)); } catch (x) { setGlobalErr(errMsg(x)); } finally { setBusy(false); } };
  const fixDep = async (dep: IntegrationDetail["dependencies"][number]) => { try { if (dep.action === "install") await api.integrations.install(dep.id); toast(`Opening ${dep.name}…`, "info"); onClose(); nav(`/integrations/${dep.id}?setup=1${dep.action === "test" ? "&step=test" : ""}`); } catch (x) { setGlobalErr(errMsg(x)); } };
  const next = async () => { if (step.kind === "deps" && d.dependencies.some((x) => !x.satisfied)) { setGlobalErr("Finish the requirement above first. You can come back here afterwards and your progress is kept."); return; } if (step.kind === "form" && !(await saveForm(step.fields))) return; if (step.kind === "oauth" && !d.authorised) { setGlobalErr("Sign in first, or choose Back."); return; } if (!last) { setI(i + 1); if (step.kind !== "form") void api.integrations.configure(d.id, { values: {}, step: i + 1 }).catch(() => {}); } };
  const runTest = async () => { setBusy(true); setGlobalErr(""); try { const r = await api.integrations.test(d.id); setTest(r.result); setDetail(r.detail); } catch (x) { setGlobalErr(errMsg(x)); } finally { setBusy(false); } };
  const signIn = async () => { setBusy(true); setGlobalErr(""); try { const r = await api.integrations.startOAuth(d.id); window.location.assign(r.authUrl); } catch (x) { setGlobalErr(errMsg(x)); setBusy(false); } };
  const finish = async (enable: boolean) => { setBusy(true); try { if (enable) { setDetail(await api.integrations.enable(d.id)); toast(`${d.name} is on`, "success"); } else toast("Setup saved. Turn it on whenever you're ready.", "info"); onClose(); } catch (x) { setGlobalErr(errMsg(x)); } finally { setBusy(false); } };
  const togglePerm = async (id: string, granted: boolean) => { try { setDetail(await api.integrations.setPermission(d.id, id, granted)); } catch (x) { setGlobalErr(errMsg(x)); } };

  const isOAuth = m.authMode === "oauth"; const showGloss = m.authMode !== "none";
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wizard" role="dialog" aria-modal="true" aria-labelledby="wiz-title" ref={ref}>
        <header className="wiz-head"><IntIcon name={m.icon} /><div className="grow"><h2 id="wiz-title">Set up {d.name}</h2><p className="small muted" aria-live="polite">Step {i + 1} of {steps.length}{"title" in step ? ` · ${(step as { step: SetupStep }).step.title}` : step.kind === "welcome" ? " · Before you start" : step.kind === "deps" ? " · Requirements" : step.kind === "perms" ? " · Permissions" : " · All done"}</p></div>
          <button className="icon" aria-label="Close setup (progress is saved)" onClick={onClose}><X size={18} /></button></header>
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label="Setup progress"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>

        <div className="wiz-body">
          {step.kind === "welcome" && <>
            <p>{m.setup.intro}</p>
            {m.setup.requirements.length > 0 && <><h3>You'll need</h3><ul>{m.setup.requirements.map((r) => <li key={r}>{r}</li>)}</ul></>}
            <h3>What Vera can access</h3><ul>{m.dataAccess.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="privacy-note"><strong>{m.contactsExternalServices ? "Data leaves this server:" : "Stays on this server:"}</strong> {m.sendsDataToThirdParty}</p>
            {showGloss && <details className="gloss"><summary>What do these terms mean?</summary><dl>{[GLOSSARY.token, ...(isOAuth ? [GLOSSARY.oauth, GLOSSARY.callback] : [])].map(([t, x]) => <div key={t}><dt>{t}</dt><dd>{x}</dd></div>)}</dl></details>}
          </>}

          {step.kind === "deps" && <>
            <p>{d.name} depends on {d.dependencies.length === 1 ? "another integration" : "other integrations"}. Each must be installed, set up and <strong>connected</strong> (its test passed) before this one can work.</p>
            <ul className="deps">{d.dependencies.map((x) => (
              <li key={x.id}>{x.satisfied ? <Check size={16} className="okc" aria-label="ready" /> : <AlertTriangle size={16} className="warnc" aria-label="not ready" />}
                <div className="grow"><strong>{x.name}</strong> <span className={`tag ${x.satisfied ? "okt" : ""}`}>{x.satisfied ? "ready" : "not ready"}</span><p className="small muted">{x.satisfied ? "Installed, set up and connected." : x.problem}</p><p className="small muted">{x.reason}</p></div>
                {!x.satisfied && x.action !== "none" && <button className="btn primary small-btn" disabled={busy} onClick={() => void fixDep(x)}>{x.action === "install" ? `Install ${x.name}` : `${DEP_ACTION[x.action]} ${x.name}`}</button>}</li>))}</ul>
            <div className="row"><button className="btn" disabled={busy} onClick={() => void recheck()}>Check again</button>{d.dependencies.every((x) => x.satisfied) && <span className="okc small"><Check size={13} aria-hidden /> All requirements are ready.</span>}</div>
          </>}

          {step.kind === "info" && <>{step.step.body.split("\n").map((l, k) => <p key={k}>{l}</p>)}</>}

          {step.kind === "form" && <form onSubmit={(e) => { e.preventDefault(); void next(); }} noValidate>
            <p className="muted">{step.step.body.split("\n")[0]}</p>
            {d.oauthRedirectUri && <CopyBox label="Redirect (callback) address to enter in your provider's console" value={d.oauthRedirectUri} />}
            {step.fields.map((f) => f.dynamicOptions ? <LiveSelect key={f.key} id={d.id} f={f} value={vals[f.key]} error={errors[f.key]} onChange={(v) => { setVals((o) => ({ ...o, [f.key]: v })); setErrors((e) => { const { [f.key]: _drop, ...rest } = e; void _drop; return rest; }); }} /> : <FieldInput key={f.key} f={f} value={vals[f.key]} saved={!!d.secretsSaved[f.key]} willClear={clear.has(f.key)} error={errors[f.key]} onChange={(v) => { setVals((o) => ({ ...o, [f.key]: v })); setErrors((e) => { const { [f.key]: _drop, ...rest } = e; void _drop; return rest; }); }} onClear={() => setClear((s) => new Set(s).add(f.key))} />)}
            {step.step.body.includes("\n") && <details className="gloss"><summary>Examples and help</summary>{step.step.body.split("\n").slice(1).map((l, k) => <p key={k} className="small">{l}</p>)}</details>}
            <button type="submit" hidden />
          </form>}

          {step.kind === "oauth" && <>
            <p>{step.step.body}</p>
            {d.oauthRedirectUri && <CopyBox label="Redirect (callback) address registered with your provider" value={d.oauthRedirectUri} />}
            {d.authorised ? <div className="result ok" role="status"><strong><Check size={15} aria-hidden /> Signed in</strong><p>Vera holds a sign-in token for your account. It is stored encrypted.</p></div>
              : <div className="result warn"><strong>Not signed in yet</strong><p>You will be sent to the provider and brought back here.</p></div>}
            <button type="button" className="btn primary" disabled={busy} onClick={() => void signIn()}><ExternalLink size={14} /> {d.authorised ? "Sign in again" : "Sign in to continue"}</button>
          </>}

          {step.kind === "perms" && <>
            <p className="muted">These are the things Vera may do with {d.name}. Turn off anything you're not comfortable with: it takes effect immediately.</p>
            <ul className="perms">{d.permissions.map((p) => <li key={p.id}><label className="check"><input type="checkbox" checked={p.granted} onChange={(e) => void togglePerm(p.id, e.target.checked)} /><span className="switchstate">{p.granted ? "ON" : "OFF"}</span><span><strong>{p.label}</strong> <span className="tag">{p.access}</span><br /><span className="small muted">{p.reason} Accesses: {p.dataAccessed}.</span></span></label></li>)}</ul>
          </>}

          {step.kind === "test" && <>
            <p>{step.step.body}</p>
            <button className="btn primary" disabled={busy} onClick={() => void runTest()}>{busy ? "Testing…" : test ? "Test again" : "Test connection"}</button>
            {test ? <TestResultView code={test.code} message={test.message} at={test.testedAt} /> : d.lastTest && <p className="small muted">Last test: {d.lastTest.code === "ok" ? "succeeded" : d.lastTest.code.replace(/_/g, " ")} on {new Date(d.lastTest.at).toLocaleString()}</p>}
            {d.manifest.actions?.length ? d.manifest.actions.map((a) => <div key={a.id} className="field"><button className="btn" disabled={busy || !d.configured} onClick={async () => { setBusy(true); setActRes(null); try { setActRes((await api.integrations.action(d.id, a.id)).result); } catch (x) { setGlobalErr(errMsg(x)); } finally { setBusy(false); } }}>{a.label}</button><span className="small muted">{a.help}</span></div>) : null}
            {actRes && <div className={`result ${actRes.ok ? "ok" : "danger"}`} role="status"><strong>{actRes.ok ? "Accepted" : "Didn't work"}</strong><p>{actRes.message}</p></div>}
            {(test || d.lastTest) && (test ? !test.ok : d.lastTest?.code !== "ok") && m.setup.troubleshooting.length > 0 && <details className="gloss" open><summary>Troubleshooting</summary><dl>{m.setup.troubleshooting.map((t) => <div key={t.problem}><dt>{t.problem}</dt><dd>{t.fix}</dd></div>)}</dl></details>}
          </>}

          {step.kind === "done" && <>
            <h3>{d.configured && d.authorised ? "Setup complete" : "Setup isn't finished"}</h3>
            <p><StatusBadge s={d} /></p>
            {d.connection === "connected" ? <p>The last connection test succeeded{d.lastSuccessAt ? ` on ${new Date(d.lastSuccessAt).toLocaleString()}` : ""}.</p>
              : d.connection === "failed" ? <p className="err">The last connection test failed: {d.lastTest?.message}. You can still turn it on, but its tools will report errors until this is fixed.</p>
              : d.manifest.healthCheck && d.configured ? <p className="muted">Not tested yet. Vera only shows "Connected" after a successful test.</p> : null}
            {!d.configured && <p className="err">Still missing: {d.missing.join(", ")}.</p>}
            {d.configured && !d.authorised && <p className="err">You haven't signed in to the provider yet.</p>}
          </>}
          {globalErr && <p className="err" role="alert">{globalErr}</p>}
        </div>

        <footer className="wiz-foot">
          <button className="btn" onClick={onClose} disabled={busy}>{last ? "Close" : "Save and close"}</button><span className="grow" />
          {i > 0 && <button className="btn" disabled={busy} onClick={() => { setGlobalErr(""); setI(i - 1); }}>Back</button>}
          {!last && <button className="btn primary" disabled={busy} onClick={() => void next()}>{busy && step.kind === "form" ? "Saving…" : step.kind === "form" ? "Save and continue" : "Continue"}</button>}
          {last && <><button className="btn" disabled={busy} onClick={() => void finish(false)}>Finish, leave off</button><button className="btn primary" disabled={busy || !d.configured || !d.authorised || d.enabled} onClick={() => void finish(true)}>{d.enabled ? "Already on" : "Turn on and finish"}</button></>}
        </footer>
      </div>
    </div>
  );
}
