import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { VeraApi } from "../api/api";
import { NativeVeraApi } from "../api/client";
import { errMsg } from "../api/errors";
import { store } from "./storage";

export type AuthState =
  | { k: "booting" } | { k: "no-server" } | { k: "connecting" } | { k: "error"; msg: string }
  | { k: "setup" } | { k: "login" } | { k: "ok"; username: string };

interface Value {
  auth: AuthState; serverUrl: string | null; api: VeraApi | null;
  /** Save a (already validated) server address and start a session check against it. */
  connect: (url: string) => Promise<void>; retry: () => void; signedIn: (username: string) => void;
  signOut: () => Promise<void>; changeServer: () => Promise<void>;
}
const Ctx = createContext<Value | null>(null);
export const useConnection = () => { const v = useContext(Ctx); if (!v) throw new Error("ConnectionProvider missing"); return v; };
/** For screens that only render once signed in. */
export const useApi = (): VeraApi => { const { api } = useConnection(); if (!api) throw new Error("No server connection"); return api; };
export const useSession = () => { const { auth, signOut } = useConnection(); return { username: auth.k === "ok" ? auth.username : "", signOut }; };

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ k: "booting" }); const [serverUrl, setServerUrl] = useState<string | null>(null); const [api, setApi] = useState<VeraApi | null>(null);

  const start = useCallback(async (url: string, cookie: string | null) => {
    const a = new NativeVeraApi({ baseUrl: url, cookie, onCookie: (t) => void store.writeCookie(t), onUnauthenticated: () => setAuth((s) => (s.k === "ok" ? { k: "login" } : s)) });
    setServerUrl(url); setApi(a); setAuth({ k: "connecting" });
    try {
      const s = await a.getSession();
      if (s.authenticated) return setAuth({ k: "ok", username: s.username ?? "" });
      setAuth({ k: (await a.getSetupStatus()).ownerExists ? "login" : "setup" });
    } catch (e) { setAuth({ k: "error", msg: errMsg(e) }); }
  }, []);

  useEffect(() => { let live = true; (async () => {
    const url = await store.readServer(); if (!live) return;
    if (!url) return setAuth({ k: "no-server" });
    await start(url, await store.readCookie());
  })(); return () => { live = false; }; }, [start]);

  const connect = useCallback(async (url: string) => { await store.writeServer(url); await store.writeCookie(null); await start(url, null); }, [start]);
  const retry = useCallback(() => { if (serverUrl) void store.readCookie().then((ck) => start(serverUrl, ck)); }, [serverUrl, start]);
  const signedIn = useCallback((username: string) => setAuth({ k: "ok", username }), []);
  const signOut = useCallback(async () => { try { await api?.logout(); } catch { /* the session is dropped locally either way */ } await store.writeCookie(null); setAuth({ k: "login" }); }, [api]);
  const changeServer = useCallback(async () => { try { await api?.logout(); } catch { /* ignore */ } await store.writeServer(null); await store.writeCookie(null); setApi(null); setServerUrl(null); setAuth({ k: "no-server" }); }, [api]);

  const value = useMemo(() => ({ auth, serverUrl, api, connect, retry, signedIn, signOut, changeServer }), [auth, serverUrl, api, connect, retry, signedIn, signOut, changeServer]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
