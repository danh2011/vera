import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { errMsg, useApi } from "../context";
import type { SystemsOverview } from "../types";

export default function SystemsPage() {
  const api = useApi(); const [data, setData] = useState<SystemsOverview | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); setErr(""); try { setData(await api.getSystemsOverview()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const sample = data?.isSample;
  return (
    <main className="page">
      <div className="row between"><h1>Systems</h1><button className="btn" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> {busy ? "Checking…" : "Refresh"}</button></div>
      {sample && <p className="notice">Sample data only. This demo is not connected to any server and reads no real metrics.</p>}
      {data?.notice && <p className="notice" role="status">{data.notice}</p>}
      {err && <div role="alert" className="errbox col"><span>Couldn't read system status. {err}</span><button className="btn" onClick={() => void load()}>Retry</button></div>}
      {!data && !err && <p className="muted" role="status">Loading…</p>}
      {data && <div className="grid">{data.cards.map((c) => (
        <details key={c.id} className="card" open={c.id === "host" || c.id === "overall" || c.id === "services"}>
          <summary><span className={`dot ${c.state}`} role="img" aria-label={c.state === "ok" ? "healthy" : c.state === "warn" ? "warning" : "down"} /> <strong>{c.title}</strong>{sample && <span className="badge">Sample</span>}</summary>
          <p className="muted">{c.summary}</p>
          {c.metrics.length > 0 && <dl className="metrics">{c.metrics.map((m) => <div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>}
          {c.services && <ul className="plain">{c.services.map((s) => <li key={s.name}><span className={`dot ${s.state}`} /> {s.name} <span className="muted small">{s.detail}</span></li>)}</ul>}
          <p className="small muted">Checked {new Date(c.lastCheck).toLocaleTimeString()}{sample ? " (sample)" : ""}</p>
        </details>))}</div>}
    </main>
  );
}
