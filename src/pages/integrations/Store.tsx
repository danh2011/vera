import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import type { IntegrationSummary, IntegrationsCatalogue } from "../../../shared/types";
import { errMsg, useApi, useToast } from "../../context";
import { DetailSheet } from "./Detail";
import { IntIcon, StatusBadge, Where } from "./parts";
import { ACTION_LABEL, FILTERS, OPEN_ROUTE, filterCounts, filterIntegrations, needsWizard, type Filter } from "./util";

function Card({ s, busy, onOpen, onAction }: { s: IntegrationSummary; busy: boolean; onOpen: () => void; onAction: () => void }) {
  const label = busy ? "Working…" : s.nextAction === "open" && !OPEN_ROUTE[s.id] ? "Use in chat" : ACTION_LABEL[s.nextAction];
  return (
    <li className="int-card" data-id={s.id}>
      <button className="int-main" onClick={onOpen} aria-label={`${s.name}: ${s.statusLabel}. Open details`}>
        <IntIcon name={s.icon} />
        <span className="int-text"><strong>{s.name}</strong><span className="int-desc">{s.description}</span></span>
      </button>
      <div className="int-meta"><StatusBadge s={s} /><Where s={s} />{s.dependencies.length > 0 && <span className="tags">{s.dependencies.map((d) => <span key={d.id} className={`tag ${d.satisfied ? "okt" : ""}`}>Needs {d.name}</span>)}</span>}</div>
      {s.statusDetail && s.attention && <p className="small warnc int-note">{s.statusDetail}</p>}
      <div className="int-foot"><span className="small muted">{s.installed ? `${s.toolsAvailable} of ${s.toolCount} tools ready` : `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`}</span><span className="grow" />
        {s.nextAction !== "none" && <button className={`btn small-btn ${s.nextAction === "install" || s.attention ? "primary" : ""}`} disabled={busy} onClick={onAction} aria-label={`${label} ${s.name}`}>{label}</button>}</div>
    </li>
  );
}

export default function IntegrationsPage() {
  const api = useApi(); const toast = useToast(); const nav = useNavigate(); const { id } = useParams();
  const [cat, setCat] = useState<IntegrationsCatalogue | null>(null); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [filter, setFilter] = useState<Filter>("all"); const [category, setCategory] = useState("all"); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { setErr(""); try { setCat(await api.integrations.catalogue()); } catch (e) { setErr(errMsg(e)); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const labels = useMemo(() => Object.fromEntries((cat?.categories ?? []).map((c) => [c.id, c.label])), [cat]);
  const list = cat?.integrations ?? []; const counts = useMemo(() => filterCounts(list), [list]);
  const shown = useMemo(() => filterIntegrations(list, { q, filter, category, categoryLabels: labels }), [list, q, filter, category, labels]);
  const filtering = q.trim() !== "" || filter !== "all" || category !== "all";

  const act = async (s: IntegrationSummary) => {
    if (s.nextAction === "configure" || s.nextAction === "connect") return nav(`/integrations/${s.id}?setup=1${s.status === "needs_dependency" ? "&step=deps" : s.nextAction === "connect" ? "&step=oauth" : ""}`);
    if (s.nextAction === "open") { const r = OPEN_ROUTE[s.id]; if (r) return nav(r); toast(`Ask Vera in chat to use ${s.name}.`, "info"); return nav("/chat"); }
    setBusy(s.id);
    try {
      if (s.nextAction === "install") { const r = await api.integrations.install(s.id); const d = await api.integrations.detail(s.id); if (needsWizard(d)) { toast(`${s.name} installed. Let's set it up.`, "success"); nav(`/integrations/${s.id}?setup=1${d.dependencies.some((x) => !x.satisfied) ? "&step=deps" : ""}`); } else toast(`${s.name} installed and ready.`, "success"); void r; }
      else if (s.nextAction === "enable") { await api.integrations.enable(s.id); toast(`${s.name} is on`, "success"); }
      await load();
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(null); }
  };
  const Grid = ({ items }: { items: IntegrationSummary[] }) => <ul className="int-grid">{items.map((s) => <Card key={s.id} s={s} busy={busy === s.id} onOpen={() => nav(`/integrations/${s.id}`)} onAction={() => void act(s)} />)}</ul>;
  const Section = ({ title, hint, items }: { title: string; hint?: string; items: IntegrationSummary[] }) => items.length ? <section aria-label={title}><h2>{title} <span className="muted small">{items.length}</span></h2>{hint && <p className="muted small">{hint}</p>}<Grid items={items} /></section> : null;

  const attention = shown.filter((s) => s.attention); const installed = shown.filter((s) => s.installed && !s.attention); const available = shown.filter((s) => !s.installed);
  const oneClick = available.filter((s) => s.runsLocally && !s.requiresCredentials && !s.contactsExternalServices && s.status !== "unavailable");

  return (
    <main className="page wide store">
      <h1>Integrations</h1>
      <p className="muted">Add abilities to Vera. Browse, install in one click, follow the short setup if one is needed, then ask Vera in chat. Everything here is reviewed and bundled with Vera: nothing is downloaded when you install.</p>
      {cat && <p className="overview" role="status">{cat.counts.installed} installed · {cat.counts.enabled} enabled · <span className={cat.counts.needsAttention ? "warnc" : ""}>{cat.counts.needsAttention} need attention</span> · {cat.counts.total} available in total</p>}

      <div className="store-controls">
        <label className="search big"><Search size={16} aria-hidden /><input type="search" aria-label="Search integrations" placeholder="Search integrations and what they can do" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="chips" role="group" aria-label="Filter integrations">{FILTERS.map((f) => <button key={f.id} className={`chipbtn ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <span className="count">{counts[f.id]}</span></button>)}</div>
        {cat && <div className="chips" role="group" aria-label="Categories"><button className={`chipbtn ${category === "all" ? "on" : ""}`} aria-pressed={category === "all"} onClick={() => setCategory("all")}>All categories</button>{cat.categories.map((c) => <button key={c.id} className={`chipbtn ${category === c.id ? "on" : ""}`} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label} <span className="count">{c.count}</span></button>)}</div>}
      </div>

      {!cat && !err && <ul className="int-grid" role="status" aria-label="Loading integrations">{[0, 1, 2, 3].map((k) => <li key={k} className="int-card skeleton-card"><i /><i /><i /></li>)}</ul>}
      {err && <div role="alert" className="errbox col"><span>Couldn't load integrations. {err}</span><button className="btn" onClick={() => void load()}>Retry</button></div>}

      {cat && !filtering && <>
        <Section title="Needs attention" hint="These are installed but not working yet." items={attention} />
        <Section title="Ready in one click" hint="Works on this server, needs no account or setup." items={oneClick} />
        <Section title="Installed" items={installed} />
        <Section title="Available" items={available.filter((s) => !oneClick.includes(s))} />
        {!list.length && <p className="empty">No integrations are bundled with this build.</p>}
        {list.length > 0 && !cat.counts.installed && <p className="empty">Nothing installed yet. Pick something above and press Install to get started.</p>}
      </>}
      {cat && filtering && <section aria-label="Results"><h2>{shown.length} result{shown.length === 1 ? "" : "s"}</h2>{shown.length ? <Grid items={shown} /> : <div className="empty"><p>No integrations match.</p><button className="btn" onClick={() => { setQ(""); setFilter("all"); setCategory("all"); }}>Clear search and filters</button></div>}</section>}

      {id && <DetailSheet key={id} id={id} onClose={() => nav("/integrations")} onChanged={() => void load()} />}
    </main>
  );
}
