import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Minus, X } from "lucide-react";
import type { ActionResult, IntegrationDetail, TestResult, ToolInfo } from "../../../shared/types";
import { errMsg, useApi, useToast } from "../../context";
import { IntIcon, StatusBadge, TestResultView, Where } from "./parts";
import { ACTION_LABEL, DEP_ACTION, OPEN_ROUTE, needsWizard, useFocusTrap, when } from "./util";
import { Wizard } from "./Wizard";

const AVAIL: Record<ToolInfo["availability"], string> = { needs_dependency: "Needs another integration", available: "Available", needs_install: "Install first", needs_enable: "Turned off", needs_configuration: "Needs setup", needs_authorisation: "Needs sign-in", permission_denied: "Permission off", unavailable: "Unavailable" };
const Tick = ({ on, na }: { on: boolean; na?: boolean }) => (na ? <Minus size={14} aria-label="not applicable" /> : on ? <Check size={14} className="okc" aria-label="yes" /> : <X size={14} className="mutedc" aria-label="no" />);

export function DetailSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const api = useApi(); const toast = useToast(); const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const ref = useRef<HTMLElement>(null);
  const [d, setD] = useState<IntegrationDetail | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(""); const [test, setTest] = useState<TestResult | null>(null); const [ask, setAsk] = useState(false); const [act, setAct] = useState<ActionResult | null>(null);
  const load = useCallback(async () => { setErr(""); try { setD(await api.integrations.detail(id)); } catch (e) { setErr(errMsg(e)); } }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  useFocusTrap(ref, onClose);
  const wizard = sp.get("setup") === "1"; const oauth = sp.get("oauth");
  const openWizard = (at?: "test" | "oauth" | "deps" | string) => { const n = new URLSearchParams(sp); n.set("setup", "1"); if (at) n.set("step", at); else n.delete("step"); n.delete("oauth"); setSp(n, { replace: true }); };
  const closeWizard = () => { const n = new URLSearchParams(sp); n.delete("setup"); n.delete("step"); n.delete("oauth"); setSp(n, { replace: true }); void load(); onChanged(); };
  useEffect(() => { if (!oauth) return; if (oauth === "success") { toast("Signed in. One more step: test the connection.", "success"); openWizard("test"); } else { toast(oauth === "denied" ? "Sign-in was cancelled." : "Sign-in didn't complete. Try again.", "error"); openWizard("oauth"); } }, [oauth]);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); await load(); onChanged(); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(""); } };
  const primary = () => {
    if (!d) return;
    if (d.nextAction === "install") return void run("install", async () => { const r = await api.integrations.install(d.id); setD(r.detail); if (needsWizard(r.detail)) { toast(`${d.name} installed. Let's set it up.`, "success"); openWizard(r.detail.dependencies.some((x) => !x.satisfied) ? "deps" : undefined); } else toast(`${d.name} installed and ready.`, "success"); });
    if (d.nextAction === "configure" || d.nextAction === "connect") return openWizard(d.status === "needs_dependency" ? "deps" : d.nextAction === "connect" ? "oauth" : undefined);
    if (d.nextAction === "enable") return void run("enable", async () => { setD(await api.integrations.enable(d.id)); toast(`${d.name} is on`, "success"); });
    if (d.nextAction === "open") { const r = OPEN_ROUTE[d.id]; if (r) nav(r); else { toast(`Ask Vera in chat. For example: "${d.capabilities[0] ?? d.name}".`, "info"); nav("/chat"); } }
  };
  const runTest = () => run("test", async () => { const r = await api.integrations.test(id); setTest(r.result); setD(r.detail); });

  return (
    <div className="overlay sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={d ? `${d.name} details` : "Integration details"} ref={ref}>
        <header className="sheet-head">
          {d ? <><IntIcon name={d.manifest.icon} size={26} /><div className="grow"><h2>{d.name}</h2><p className="small muted">{d.manifest.category.replace(/_/g, " ")} · v{d.version}</p></div></> : <div className="grow"><h2>Integration</h2></div>}
          <button className="icon" aria-label="Close details" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="sheet-body">
          {!d && !err && <div className="skeleton" role="status" aria-label="Loading"><i /><i /><i /></div>}
          {err && <div role="alert" className="errbox col"><span>{err}</span><button className="btn" onClick={() => void load()}>Retry</button></div>}
          {d && <>
            <div className="row wrap between"><StatusBadge s={d} /><Where s={d} /></div>
            {d.statusDetail && <p className={d.status === "error" ? "err" : "muted small"}>{d.statusDetail}</p>}
            <p className="lead">{d.description}</p>
            <div className="row wrap">
              {d.nextAction !== "none" && <button className="btn primary" disabled={!!busy} onClick={primary}>{busy === "install" ? "Installing…" : busy === "enable" ? "Turning on…" : d.nextAction === "open" && !OPEN_ROUTE[d.id] ? "Use in chat" : ACTION_LABEL[d.nextAction]}</button>}
              {d.status === "unavailable" && <p className="err small">{d.statusDetail}</p>}
              {d.installed && d.status !== "unavailable" && <button className="btn" onClick={() => openWizard()}>{d.configured ? "Reconfigure" : "Resume setup"}</button>}
            </div>

            <section aria-labelledby="s-status"><h3 id="s-status">Status</h3>
              <ul className="checks">
                <li><Tick on={d.installed} /> Installed</li>
                <li><Tick on={d.configured} na={d.manifest.setup.steps.every((s) => s.kind !== "form")} /> Configured{d.missing.length > 0 && d.installed ? <span className="small muted"> · missing: {d.missing.join(", ")}</span> : null}</li>
                {d.authMode === "oauth" && <li><Tick on={d.authorised} /> Signed in to provider</li>}
                <li><Tick on={d.enabled} /> Enabled</li>
                <li><Tick on={d.connection === "connected"} na={d.connection === "not_applicable"} /> Connected{d.connection === "untested" ? <span className="small muted"> · not tested yet</span> : d.connection === "failed" ? <span className="small err"> · last test failed</span> : null}</li>
              </ul>
              {d.installed && d.manifest.healthCheck && <div className="row wrap"><button className="btn" disabled={!!busy || d.missing.length > 0} onClick={() => void runTest()}>{busy === "test" ? "Testing…" : "Test connection"}</button>{d.lastSuccessAt && <span className="small muted">Last successful test {when(d.lastSuccessAt)}</span>}</div>}
              {test ? <TestResultView code={test.code} message={test.message} at={test.testedAt} /> : d.lastTest && d.lastTest.code !== "ok" && <TestResultView code={d.lastTest.code} message={d.lastTest.message} at={d.lastTest.at} />}
              {d.installed && !d.manifest.required && d.configured && d.authorised && <label className="check switchrow"><input type="checkbox" checked={d.enabled} disabled={!!busy} onChange={(e) => void run("toggle", async () => { setD(e.target.checked ? await api.integrations.enable(d.id) : await api.integrations.disable(d.id)); })} /><span className="switchstate">{d.enabled ? "ON" : "OFF"}</span> {d.enabled ? "On: the assistant can use its tools" : "Off: no tools can run"}</label>}
            </section>

            {d.dependencies.length > 0 && <section aria-labelledby="s-req"><h3 id="s-req">Requires</h3>
              <ul className="deps">{d.dependencies.map((x) => <li key={x.id}><Tick on={x.satisfied} /><div className="grow"><strong>{x.name}</strong> <span className={`tag ${x.satisfied ? "okt" : ""}`}>{x.satisfied ? "ready" : x.state === "available" ? "not installed" : x.state.replace(/_/g, " ")}</span><br /><span className="small muted">{x.satisfied ? "Installed, set up and connected." : x.problem}</span>{!x.satisfied && <><br /><span className="small muted">{x.reason}</span></>}</div>
                {!x.satisfied && x.action !== "none" && <button className="btn small-btn" onClick={() => nav(`/integrations/${x.id}${x.action === "install" ? "" : "?setup=1"}`)}>{x.action === "install" ? "View" : DEP_ACTION[x.action]} {x.name}</button>}</li>)}</ul></section>}

            {d.installed && d.manifest.actions && d.manifest.actions.length > 0 && <section aria-labelledby="s-act2"><h3 id="s-act2">Try it</h3>
              {d.manifest.actions.map((a) => <div key={a.id}><button className="btn" disabled={!!busy || !d.configured || d.dependencies.some((x) => !x.satisfied)} onClick={() => void run("action", async () => { setAct((await api.integrations.action(d.id, a.id)).result); })}>{busy === "action" ? "Working…" : a.label}</button><p className="small muted">{a.help}</p></div>)}
              {act && <div className={`result ${act.ok ? "ok" : "danger"}`} role="status"><strong>{act.ok ? "Accepted" : "Didn't work"}</strong><p>{act.message}</p></div>}</section>}

            <section aria-labelledby="s-priv"><h3 id="s-priv">Privacy and data</h3>
              <p>{d.manifest.sendsDataToThirdParty}</p>
              <ul>{d.manifest.dataAccess.map((x) => <li key={x}>{x}</li>)}</ul>
              {d.manifest.externalServices.length > 0 && <p className="small muted">Contacts: {d.manifest.externalServices.join("; ")}</p>}
            </section>

            <section aria-labelledby="s-feat"><h3 id="s-feat">What it can do</h3><ul>{d.capabilities.map((c) => <li key={c}>{c}</li>)}</ul></section>

            <section aria-labelledby="s-perm"><h3 id="s-perm">Permissions</h3>
              <ul className="perms">{d.permissions.map((p) => <li key={p.id}>
                {d.installed ? <label className="check"><input type="checkbox" checked={p.granted} disabled={!!busy} onChange={(e) => void run("perm", async () => { setD(await api.integrations.setPermission(d.id, p.id, e.target.checked)); })} /><span className="switchstate">{p.granted ? "ON" : "OFF"}</span><span><strong>{p.label}</strong> <span className="tag">{p.access}</span><br /><span className="small muted">{p.reason} Accesses: {p.dataAccessed}.</span></span></label>
                  : <div><strong>{p.label}</strong> <span className="tag">{p.access}</span>{!p.defaultGranted && <span className="tag">off until you turn it on</span>}<br /><span className="small muted">{p.reason} Accesses: {p.dataAccessed}.</span></div>}
              </li>)}</ul>
            </section>

            <section aria-labelledby="s-tools"><h3 id="s-tools">Tools ({d.tools.length})</h3>
              <ul className="tools">{d.tools.map((t) => <li key={t.name}><div className="grow"><code>{t.name}</code> <span className={`tag ${t.availability === "available" ? "okt" : ""}`}>{AVAIL[t.availability]}</span>{t.requiresConfirmation && <span className="tag">asks first</span>}{t.readOnly && <span className="tag">read-only</span>}<br /><span className="small muted">{t.description}</span>{t.availability !== "available" && t.availabilityReason && <><br /><span className="small warnc">{t.availabilityReason}</span></>}</div></li>)}</ul>
            </section>

            {d.installed && d.configSchema.length > 0 && <section aria-labelledby="s-cfg"><h3 id="s-cfg">Saved settings</h3>
              <dl className="metrics">{d.configSchema.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{f.type === "secret" ? (d.secretsSaved[f.key] ? "Credential saved" : "Credential not configured") : Array.isArray(d.config[f.key]) ? `${(d.config[f.key] as string[]).length} entries` : String(d.config[f.key] ?? "Not set")}</dd></div>)}</dl>
              <p className="small muted">Secrets are encrypted on the server and never shown again. To replace one, choose Reconfigure.</p></section>}

            <section aria-labelledby="s-help"><h3 id="s-help">Setup and troubleshooting</h3>
              {d.manifest.setup.requirements.length > 0 && <><p className="small muted">You'll need:</p><ul>{d.manifest.setup.requirements.map((r) => <li key={r}>{r}</li>)}</ul></>}
              {d.manifest.setup.troubleshooting.length > 0 && <dl className="gloss-list">{d.manifest.setup.troubleshooting.map((t) => <div key={t.problem}><dt>{t.problem}</dt><dd>{t.fix}</dd></div>)}</dl>}
              {!d.manifest.setup.requirements.length && !d.manifest.setup.troubleshooting.length && <p className="muted">Nothing to set up.</p>}
            </section>

            {d.installed && d.recentActivity.length > 0 && <section aria-labelledby="s-act"><h3 id="s-act">Recent activity</h3>
              <ul className="tools">{d.recentActivity.map((a, k) => <li key={k}><code>{a.tool}</code> <span className={`tag ${a.outcome === "ok" ? "okt" : ""}`}>{a.outcome}</span> <span className="small muted">{when(a.at)}{a.durationMs !== null ? ` · ${a.durationMs} ms` : ""}</span></li>)}</ul></section>}

            {d.installed && !d.manifest.required && <section><h3>Remove</h3><p className="small muted">Uninstalling stops all its tools right away.</p><button className="btn danger-outline" disabled={!!busy} onClick={() => setAsk(true)}>Uninstall {d.name}</button></section>}
            {d.manifest.required && <p className="small muted">{d.name} is part of Vera's core and can't be removed.</p>}
          </>}
        </div>
      </aside>
      {d && wizard && <Wizard detail={d} startAt={sp.get("step") === "test" ? "test" : sp.get("step") === "oauth" ? "oauth" : sp.get("step") === "deps" ? "deps" : undefined} onClose={closeWizard} onUpdated={setD} />}
      {d && ask && (
        <div className="overlay" onMouseDown={() => setAsk(false)}><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="un-t" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setAsk(false)}>
          <h2 id="un-t">Uninstall {d.name}?</h2>
          <p>This stops the assistant from using it immediately.</p>
          <h3 className="small">Will be removed</h3><ul>{d.manifest.uninstall.removes.map((x) => <li key={x}>{x}</li>)}<li>Its saved settings and any stored credentials or sign-in</li></ul>
          {d.dependents.length > 0 && <><h3 className="small">Will stop working</h3><ul>{d.dependents.map((x) => <li key={x.id}>{x.name} (it relies on {d.name})</li>)}</ul></>}
          <h3 className="small">Will be kept</h3><ul>{d.manifest.uninstall.keeps.length ? d.manifest.uninstall.keeps.map((x) => <li key={x}>{x}</li>) : <li>Nothing of yours is stored by this integration.</li>}</ul>
          <div className="row end"><button className="btn" autoFocus onClick={() => setAsk(false)}>Cancel</button>
            <button className="btn danger" onClick={() => { setAsk(false); void run("uninstall", async () => { const r = await api.integrations.uninstall(d.id); setD(r.detail); setTest(null); toast(`${d.name} uninstalled`, "success"); }); }}>Uninstall</button></div>
        </div></div>
      )}
    </div>
  );
}
