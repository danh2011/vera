import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { errMsg, SessionCtx, UNAUTH_EVENT, useApi, useSettings } from "./context";
import { ApiError, ConnectionError } from "./services/http";

type State = { k: "loading" } | { k: "error"; msg: string } | { k: "setup" } | { k: "login" } | { k: "ok"; username: string };
const Logo = () => <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="16" fill="var(--accent)" /><path d="M18 22l14 24 14-24" fill="none" stroke="var(--on-accent)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Shows the app only for a signed-in owner. Connection failures are shown as such: there is no silent fallback to demo data. */
export function AuthGate({ children }: { children: ReactNode }) {
  const api = useApi(); const { update } = useSettings(); const [st, setSt] = useState<State>({ k: "loading" });
  const load = useCallback(async () => {
    setSt({ k: "loading" });
    try { const s = await api.getSession(); if (s.authenticated) return setSt({ k: "ok", username: s.username ?? "" }); setSt({ k: (await api.getSetupStatus()).ownerExists ? "login" : "setup" }); }
    catch (e) { setSt({ k: "error", msg: errMsg(e) }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = () => setSt((s) => (s.k === "ok" ? { k: "login" } : s)); window.addEventListener(UNAUTH_EVENT, h); return () => window.removeEventListener(UNAUTH_EVENT, h); }, []);
  const signOut = useCallback(async () => { try { await api.logout(); } finally { setSt({ k: "login" }); } }, [api]);
  if (st.k === "ok") return <SessionCtx.Provider value={{ username: st.username, signOut }}>{children}</SessionCtx.Provider>;
  return (
    <main className="auth" aria-live="polite">
      <div className="auth-card">
        <div className="auth-head"><Logo /><h1>Vera</h1><p className="muted">Your AI. Your data. Your hardware.</p></div>
        {st.k === "loading" && <p className="muted center" role="status">Connecting to your Vera server…</p>}
        {st.k === "error" && <div role="alert" className="errbox col"><span>{st.msg}</span><button className="btn" onClick={() => void load()}>Try again</button></div>}
        {st.k === "setup" && <SetupForm onDone={(u) => { update({ onboarded: false }); setSt({ k: "ok", username: u }); }} />}
        {st.k === "login" && <LoginForm onDone={(u) => setSt({ k: "ok", username: u })} />}
      </div>
    </main>
  );
}

function useSubmit<T>(fn: () => Promise<T>, done: (r: T) => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(""); setFields({});
    try { done(await fn()); }
    catch (x) { if (x instanceof ApiError) { const mapped = x.fields ?? (x.code === "BAD_SETUP_TOKEN" ? { setupCode: x.message } : x.code === "WEAK_PASSWORD" ? { password: x.message } : {}); setFields(mapped); setErr(Object.keys(mapped).length ? "" : x.message); } else setErr(x instanceof ConnectionError ? x.message : errMsg(x)); }
    finally { setBusy(false); }
  };
  return { busy, err, fields, submit };
}

function LoginForm({ onDone }: { onDone: (u: string) => void }) {
  const api = useApi(); const [u, setU] = useState(""); const [p, setP] = useState("");
  const f = useSubmit(() => api.login({ username: u.trim(), password: p }), (s) => onDone(s.username ?? u));
  return (
    <form onSubmit={f.submit} noValidate aria-label="Sign in">
      <h2>Sign in</h2>
      <label>Username<input autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} autoFocus required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
      {f.err && <p className="err" role="alert">{f.err}</p>}
      <button className="btn primary wide" disabled={f.busy || !u || !p}>{f.busy ? "Signing in…" : "Sign in"}</button>
      <p className="small muted">Forgot your password? On the server run <code>npm run reset-password</code> (see docs/security.md).</p>
    </form>
  );
}

function SetupForm({ onDone }: { onDone: (u: string) => void }) {
  const api = useApi(); const [u, setU] = useState(""); const [p, setP] = useState(""); const [p2, setP2] = useState(""); const [code, setCode] = useState(""); const [local, setLocal] = useState("");
  const f = useSubmit(async () => { if (p !== p2) { setLocal("The two passwords don't match."); throw new Error("mismatch"); } setLocal(""); return api.createOwner({ username: u.trim(), password: p, setupCode: code.trim() }); }, (s) => onDone(s.username ?? u));
  return (
    <form onSubmit={f.submit} noValidate aria-label="Create owner account">
      <h2>Create the owner account</h2>
      <p className="muted small"><ShieldCheck size={14} /> This is the only account. There is no public sign-up and no default password.</p>
      <label>Setup code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus aria-describedby="code-help" required />
        <span id="code-help" className="small muted">Printed in the server log when Vera starts (run <code>docker logs vera</code>, or look at the terminal), or the VERA_SETUP_TOKEN you configured.</span>{f.fields.setupCode && <span className="err" role="alert">{f.fields.setupCode}</span>}</label>
      <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required />{f.fields.username && <span className="err" role="alert">{f.fields.username}</span>}</label>
      <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" aria-describedby="pw-help" required /><span id="pw-help" className="small muted">At least 8 characters.</span>{f.fields.password && <span className="err" role="alert">{f.fields.password}</span>}</label>
      <label>Confirm password<input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" required /></label>
      {(local || (f.err && f.err !== "mismatch")) && <p className="err" role="alert">{local || f.err}</p>}
      <button className="btn primary wide" disabled={f.busy || !u || !p || !code}>{f.busy ? "Creating…" : "Create account"}</button>
    </form>
  );
}
