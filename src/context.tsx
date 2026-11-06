import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { VeraApi } from "./services/api";
import { createApi } from "./services";
import { storage } from "./services/storage";
import { DEFAULT_SETTINGS, type Settings } from "./types";
import { AuthGate } from "./Auth";
import { RunsProvider } from "./runs";
import { UNAUTH_EVENT } from "./services/http";

const ApiCtx = createContext<VeraApi | null>(null);
export const useApi = () => { const a = useContext(ApiCtx); if (!a) throw new Error("ApiProvider missing"); return a; };

type ToastKind = "success" | "error" | "info";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

interface SettingsValue { settings: Settings; update: (p: Partial<Settings>) => void; reload: () => void }
const SettingsCtx = createContext<SettingsValue>({ settings: DEFAULT_SETTINGS, update: () => {}, reload: () => {} });
export const useSettings = () => useContext(SettingsCtx);

interface SessionValue { username: string; signOut: () => Promise<void> }
export const SessionCtx = createContext<SessionValue>({ username: "", signOut: async () => {} });
export const useSession = () => useContext(SessionCtx);
export { UNAUTH_EVENT };

function readSettings(): Settings {
  const raw = storage.read("settings");
  return typeof raw === "object" && raw !== null ? { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) } : DEFAULT_SETTINGS;
}
export const notifyData = () => window.dispatchEvent(new Event("vera:data"));

export function Providers({ children, api }: { children: ReactNode; api?: VeraApi }) {
  const impl = useMemo(() => api ?? createApi(), [api]);
  const [settings, setSettings] = useState(readSettings);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const update = useCallback((p: Partial<Settings>) => setSettings((s) => { const n = { ...s, ...p }; storage.write("settings", n); return n; }), []);
  const reload = useCallback(() => setSettings(readSettings()), []);
  useEffect(() => {
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
    const theme = settings.theme === "system" ? (dark ? "dark" : "light") : settings.theme;
    const d = document.documentElement.dataset;
    d.theme = theme; d.accent = settings.accent; d.compact = String(settings.compact); d.reduceMotion = String(settings.reduceMotion);
  }, [settings]);
  return (
    <ApiCtx.Provider value={impl}><SettingsCtx.Provider value={{ settings, update, reload }}><ToastCtx.Provider value={push}>
      <AuthGate><RunsProvider>{children}</RunsProvider></AuthGate>
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider></SettingsCtx.Provider></ApiCtx.Provider>
  );
}

export function Confirm({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onCancel(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onCancel]);
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2><p className="muted">{body}</p>
        <div className="row end"><button className="btn" onClick={onCancel} autoFocus>Cancel</button><button className="btn danger" onClick={onConfirm}>{confirmLabel}</button></div>
      </div>
    </div>
  );
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
