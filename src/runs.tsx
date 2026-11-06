import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errMsg, notifyData, useApi, useToast } from "./context";
import type { ChatStep, Message } from "./types";

/** A reply being produced by the server. It lives here, not in the chat page, so leaving the page never loses or cancels it. */
export interface Run { cid: string; text: string; regenerate: boolean; startedAt: number; steps: ChatStep[]; status: "running" | "done" | "error"; finishedAt?: number; message?: Message; error?: string; seen: boolean; open: boolean }
interface RunsValue { runs: Record<string, Run>; start(cid: string, text: string, regenerate: boolean): void; stop(cid: string): void; clear(cid: string): void; markSeen(cid: string): void; setOpen(cid: string, open: boolean): void; anyRunning: boolean }
const RunsCtx = createContext<RunsValue>({ runs: {}, start() {}, stop() {}, clear() {}, markSeen() {}, setOpen() {}, anyRunning: false });
export const useRuns = () => useContext(RunsCtx);

export const upsertStep = (steps: ChatStep[], st: ChatStep) => { const i = steps.findIndex((x) => x.id === st.id); return i >= 0 ? steps.map((x, k) => (k === i ? st : x)) : [...steps, st]; };

export function RunsProvider({ children }: { children: ReactNode }) {
  const api = useApi(); const toast = useToast(); const [runs, setRuns] = useState<Record<string, Run>>({}); const ctl = useRef(new Map<string, AbortController>());
  const patch = useCallback((cid: string, p: Partial<Run> | ((r: Run) => Partial<Run>)) => setRuns((rs) => (rs[cid] ? { ...rs, [cid]: { ...rs[cid]!, ...(typeof p === "function" ? p(rs[cid]!) : p) } } : rs)), []);
  const start = useCallback((cid: string, text: string, regenerate: boolean) => {
    if (ctl.current.has(cid)) return; const c = new AbortController(); ctl.current.set(cid, c);
    setRuns((rs) => ({ ...rs, [cid]: { cid, text, regenerate, startedAt: Date.now(), steps: [], status: "running", seen: false, open: false } })); notifyData();
    api.sendMessage(cid, { content: text, regenerate }, c.signal, (st) => patch(cid, (r) => ({ steps: upsertStep(r.steps, st) })))
      .then(({ message }) => patch(cid, { status: "done", message, finishedAt: Date.now() }))
      .catch((e) => { if (e instanceof DOMException && e.name === "AbortError") { setRuns((rs) => { const { [cid]: _gone, ...rest } = rs; void _gone; return rest; }); toast("Stopped", "info"); } else patch(cid, { status: "error", error: errMsg(e) }); })
      .finally(() => { ctl.current.delete(cid); notifyData(); });
  }, [api, patch, toast]);
  const stop = useCallback((cid: string) => ctl.current.get(cid)?.abort(), []);
  const clear = useCallback((cid: string) => setRuns((rs) => { const { [cid]: _gone, ...rest } = rs; void _gone; return rest; }), []);
  const markSeen = useCallback((cid: string) => patch(cid, { seen: true }), [patch]);
  const setOpen = useCallback((cid: string, open: boolean) => patch(cid, { open }), [patch]);
  useEffect(() => { const m = ctl.current; return () => { for (const c of m.values()) c.abort(); }; }, []);
  const value = useMemo(() => ({ runs, start, stop, clear, markSeen, setOpen, anyRunning: Object.values(runs).some((r) => r.status === "running") }), [runs, start, stop, clear, markSeen, setOpen]);
  return <RunsCtx.Provider value={value}>{children}</RunsCtx.Provider>;
}
