import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Brain, CheckSquare, ChevronDown, MoreHorizontal, PanelLeft, Pencil, Search, Server, Settings as Cog, Blocks, SquarePen, Trash2, Check } from "lucide-react";
import { Confirm, errMsg, notifyData, useApi, useToast } from "./context";
import type { ConversationSummary } from "./types";
import { ChatPage } from "./pages/Chat";
import { Onboarding } from "./Onboarding";
import { useSettings, useSession } from "./context";
import { useRuns } from "./runs";
import type { ServerSettings } from "../shared/types";
const TasksPage = lazy(() => import("./pages/Tasks"));
const MemoryPage = lazy(() => import("./pages/Memory"));
const SystemsPage = lazy(() => import("./pages/Systems"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const IntegrationsPage = lazy(() => import("./pages/integrations/Store"));

const NAV = [{ to: "/tasks", label: "Tasks", icon: CheckSquare }, { to: "/memory", label: "Memory", icon: Brain }, { to: "/integrations", label: "Integrations", icon: Blocks }, { to: "/systems", label: "Systems", icon: Server }];
const groupOf = (iso: string) => { const d = (Date.now() - new Date(iso).getTime()) / 864e5; return d < 1 ? "Today" : d < 2 ? "Yesterday" : d < 7 ? "Previous 7 days" : "Older"; };
const Logo = () => <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="16" fill="var(--accent)" /><path d="M18 22l14 24 14-24" fill="none" stroke="var(--on-accent)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function Sidebar({ close, toggle }: { close: () => void; toggle: () => void }) {
  const api = useApi(); const { signOut, username } = useSession(); const { runs, anyRunning } = useRuns(); const nav = useNavigate(); const toast = useToast(); const loc = useLocation();
  const [list, setList] = useState<ConversationSummary[]>([]); const [q, setQ] = useState("");
  const [del, setDel] = useState<ConversationSummary | null>(null); const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; v: string } | null>(null);
  const refresh = useCallback(() => { api.listConversations().then(setList).catch((e) => toast(errMsg(e), "error")); }, [api, toast]);
  useEffect(() => { refresh(); window.addEventListener("vera:data", refresh); return () => window.removeEventListener("vera:data", refresh); }, [refresh]);
  useEffect(() => { if (!menu) return; const h = () => setMenu(null); const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null); window.addEventListener("click", h); window.addEventListener("keydown", k); return () => { window.removeEventListener("click", h); window.removeEventListener("keydown", k); }; }, [menu]);
  const commit = async () => { const r = renaming; setRenaming(null); if (!r) return; try { await api.renameConversation(r.id, r.v); refresh(); } catch (e) { toast(errMsg(e), "error"); } };
  const shown = list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const groups = ["Today", "Yesterday", "Previous 7 days", "Older"].map((g) => [g, shown.filter((c) => groupOf(c.updatedAt) === g)] as const).filter(([, l]) => l.length);
  return (
    <div className="side-inner">
      <div className="side-head"><Logo /><span className="brand">Vera</span><button className="icon push" aria-label="Close sidebar" onClick={toggle}><PanelLeft size={18} /></button></div>
      <button className="side-item strong" onClick={() => { nav("/chat"); close(); }}><SquarePen size={17} /> New chat</button>
      <nav aria-label="Primary">{NAV.map(({ to, label, icon: I }) => <NavLink key={to} to={to} onClick={close} className="side-item"><I size={17} /> {label}{to === "/chat" && anyRunning && !loc.pathname.startsWith("/chat") && <span className="run-ind" role="status" aria-label="Vera is working on a reply"><span className="spin" /></span>}{to === "/chat" && !anyRunning && !loc.pathname.startsWith("/chat") && Object.values(runs).some((r) => r.status !== "running" && !r.seen) && <span className="run-dot" role="status" aria-label="A reply is ready" />}</NavLink>)}</nav>
      <label className="search"><Search size={15} /><input aria-label="Search conversations" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="convs" aria-label="Conversations">
        {groups.map(([g, items]) => (
          <section key={g}><h3>{g}</h3>
            <ul>{items.map((c) => (
              <li key={c.id} className={`${loc.pathname === `/chat/${c.id}` ? "active" : ""} ${menu === c.id ? "open" : ""}`}>
                {renaming?.id === c.id ? <input className="rename" autoFocus aria-label="Conversation title" value={renaming.v} onChange={(e) => setRenaming({ id: c.id, v: e.target.value })} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setRenaming(null); }} />
                  : <NavLink to={`/chat/${c.id}`} onClick={close}><span>{c.title}</span>{runs[c.id]?.status === "running" ? <span className="run-ind" role="status" aria-label="Vera is replying in this chat"><span className="spin" /></span> : runs[c.id] && !runs[c.id]!.seen && loc.pathname !== `/chat/${c.id}` ? <span className="run-dot" role="status" aria-label="New reply" /> : null}</NavLink>}
                <button className="icon more" aria-label={`Options for ${c.title}`} aria-haspopup="menu" aria-expanded={menu === c.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id); }}><MoreHorizontal size={16} /></button>
                {menu === c.id && <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => setRenaming({ id: c.id, v: c.title })}><Pencil size={14} /> Rename</button>
                  <button role="menuitem" className="danger-text" onClick={() => setDel(c)}><Trash2 size={14} /> Delete</button></div>}
              </li>))}</ul></section>))}
        {!shown.length && <p className="muted small pad">{q ? "No matching chats" : "No conversations yet"}</p>}
      </div>
      {username && <button className="side-item" onClick={() => void signOut()} aria-label={`Sign out ${username}`}><span className="avatar sm" aria-hidden>{username[0]?.toUpperCase()}</span> {username} <span className="muted small push">Sign out</span></button>}
      <NavLink to="/settings" onClick={close} className="side-item foot"><Cog size={17} /> Settings {api.kind === "mock" && <span className="badge warn">Demo</span>}</NavLink>
      {del && <Confirm title="Delete chat?" body={`This will delete "${del.title}" and its messages${api.kind === "mock" ? " from this device" : " from the server"}.`} confirmLabel="Delete"
        onCancel={() => setDel(null)} onConfirm={async () => {
          try { await api.deleteConversation(del.id); toast("Chat deleted", "success"); if (loc.pathname === `/chat/${del.id}`) nav("/chat"); notifyData(); } catch (e) { toast(errMsg(e), "error"); }
          setDel(null);
        }} />}
    </div>
  );
}

function ModelPicker() {
  const api = useApi(); const nav = useNavigate(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const [st, setSt] = useState<ServerSettings | null>(null);
  useEffect(() => { let live = true; api.getServerSettings().then((v) => live && setSt(v)).catch(() => {}); return () => { live = false; }; }, [api, open]);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; window.addEventListener("mousedown", h); return () => window.removeEventListener("mousedown", h); }, [open]);
  const mock = api.kind === "mock"; const ai = st?.ai;
  return (
    <div className="picker" ref={ref}>
      <button className="pill" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>Vera <span className="muted">{mock ? "Demo" : ai?.ready ? "AI on" : "Local"}</span> <ChevronDown size={15} /></button>
      {open && <div className="menu pop" role="listbox">
        {mock ? <button role="option" aria-selected="true"><span>Local demo<small>Scripted replies, runs on this device</small></span><Check size={15} /></button> : <>
          <button role="option" aria-selected={!ai?.ready}><span>Local tools only<small>Time, maths, tasks, notes and more: no cloud AI</small></span>{!ai?.ready && <Check size={15} />}</button>
          <button role="option" aria-selected={!!ai?.ready} disabled={!ai?.ready}><span>{ai?.ready ? `Gemini · ${ai.model}` : "Gemini is not active"}<small>{ai?.ready ? `${ai.usage.today.requests} of ${ai.limits.perDay} requests used today` : ai?.reason ?? "Loading…"}</small></span>{ai?.ready && <Check size={15} />}</button>
          {!ai?.ready && <button role="menuitem" onClick={() => { setOpen(false); nav("/settings"); }}><span>Open AI settings</span></button>}</>}
      </div>}
    </div>
  );
}

export function App() {
  const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(false); const loc = useLocation(); const { settings } = useSettings();
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  if (!settings.onboarded) return <Onboarding />;
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Sidebar"><Sidebar close={() => setOpen(false)} toggle={() => { setCollapsed(true); setOpen(false); }} /></aside>
      <div className={`scrim ${open ? "show" : ""}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className={`icon ${collapsed ? "" : "mobile-only"}`} aria-label="Open sidebar" onClick={() => { setOpen(true); setCollapsed(false); }}><PanelLeft size={19} /></button>
          {loc.pathname.startsWith("/chat") && <ModelPicker />}
        </header>
        <Suspense fallback={<p className="pad muted">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<ChatPage />} /><Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/tasks" element={<TasksPage />} /><Route path="/memory" element={<MemoryPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} /><Route path="/integrations/:id" element={<IntegrationsPage />} /><Route path="/systems" element={<SystemsPage />} /><Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
