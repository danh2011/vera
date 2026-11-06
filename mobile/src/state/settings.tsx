import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Accent, ThemeMode } from "../theme/tokens";
import { store } from "./storage";

export interface Settings {
  name: string; interests: string[]; accent: Accent; onboarded: boolean; allowFiles: boolean; allowTools: boolean;
  theme: ThemeMode; compact: boolean; reduceMotion: boolean; enterToSend: boolean; speakReplies: boolean; haptics: boolean;
}
export const DEFAULT_SETTINGS: Settings = { name: "", interests: [], accent: "neutral", onboarded: false, allowFiles: false, allowTools: false, theme: "dark", compact: false, reduceMotion: false, enterToSend: false, speakReplies: false, haptics: true };

interface Value { settings: Settings; ready: boolean; update: (p: Partial<Settings>) => void }
const Ctx = createContext<Value>({ settings: DEFAULT_SETTINGS, ready: false, update: () => {} });
export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS); const [ready, setReady] = useState(false);
  useEffect(() => { let live = true; store.readSettings<Partial<Settings>>().then((s) => { if (!live) return; if (s && typeof s === "object") setSettings({ ...DEFAULT_SETTINGS, ...s }); setReady(true); }); return () => { live = false; }; }, []);
  const update = useCallback((p: Partial<Settings>) => setSettings((s) => { const n = { ...s, ...p }; void store.writeSettings(n); return n; }), []);
  const value = useMemo(() => ({ settings, ready, update }), [settings, ready, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
