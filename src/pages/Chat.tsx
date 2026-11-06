import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { ArrowDown, ArrowUp, Check, Copy, Mic, Plus, RefreshCw, Square, Volume2, X, FileText, AlertCircle, ShieldAlert, ShieldCheck, ChevronRight } from "lucide-react";
import { errMsg, notifyData, useApi, useSettings, useToast } from "../context";
import type { ChatStep, Conversation, Message } from "../types";
import { useRuns, type Run } from "../runs";

interface Rec { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; abort(): void }
const recCtor = (): (new () => Rec) | null => { const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
const toBottom = (el: HTMLElement | null, smooth = false) => { if (!el) return; if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" }); else el.scrollTop = el.scrollHeight; };
const PROMPTS = ["Help me organise my week.", "Check my home-server status.", "Find a note in my memory.", "Explain something I'm learning."];

function Code({ children }: { children?: ReactNode }) {
  const toast = useToast(); const ref = useRef<HTMLPreElement>(null); const [ok, setOk] = useState(false);
  return <div className="code"><button className="icon copy" aria-label="Copy code" onClick={() => { void navigator.clipboard?.writeText(ref.current?.innerText ?? ""); setOk(true); toast("Code copied", "success"); setTimeout(() => setOk(false), 1500); }}>{ok ? <Check size={14} /> : <Copy size={14} />}</button><pre ref={ref}>{children}</pre></div>;
}
const MD = { pre: Code, a: ({ href, children }: { href?: string; children?: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> };

/** Reveals already-generated demo text progressively so replies feel like they stream. */
function Reveal({ text, animate, onTick }: { text: string; animate: boolean; onTick: () => void }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || n >= text.length) return;
    const t = setTimeout(() => { setN((v) => Math.min(text.length, v + Math.max(3, Math.ceil(text.length / 70)))); onTick(); }, 16);
    return () => clearTimeout(t);
  }, [n, text, animate, onTick]);
  return <div className={`md ${animate && n < text.length ? "typing" : ""}`}><Markdown components={MD}>{animate ? text.slice(0, n) : text}</Markdown></div>;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(1, Math.round(ms))} ms`);
function StepList({ steps }: { steps: ChatStep[] }) {
  return (
    <ul className="steps" aria-label="Steps Vera took">
      {steps.map((st) => (
        <li key={st.id} className={st.state}>
          <span className="sd" aria-hidden>{st.state === "running" ? <span className="spin" /> : st.state === "error" ? <AlertCircle size={14} color="var(--danger)" /> : <Check size={14} color="var(--ok)" />}</span>
          <span><span className="st-label">{st.label}</span>{st.detail && <span className="st-detail">{st.detail}</span>}</span>
          {st.ms !== undefined && st.ms >= 1 && <span className="st-ms">{fmtMs(st.ms)}</span>}
        </li>))}
    </ul>
  );
}

/** One quiet line (like other assistants' "thinking" rows). Click to see every real step; it stays where it is when the answer arrives. */
function Thinking({ steps, running, startedAt, open, onToggle }: { steps: ChatStep[]; running: boolean; startedAt?: number; open: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const cur = [...steps].reverse().find((x) => x.state === "running") ?? steps[steps.length - 1]; const err = steps.some((x) => x.state === "error"); const n = steps.length;
  const total = steps.reduce((a, x) => a + (x.ms ?? 0), 0); const local = steps.some((x) => x.label.startsWith("Answered locally")); const sec = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const text = running ? `${cur?.label ?? "Starting"}…${sec >= 3 ? ` ${sec} s` : ""}` : err ? `Finished with a problem · ${n} step${n === 1 ? "" : "s"}` : local ? `Answered on this server · ${n} steps` : `Worked for ${fmtMs(total)} · ${n} step${n === 1 ? "" : "s"}`;
  return (
    <div className={`think ${running ? "running" : ""}`}>
      <button className="think-btn" aria-expanded={open} onClick={onToggle}>
        <span className="sd" aria-hidden>{running ? <span className="spin" /> : err ? <AlertCircle size={14} color="var(--danger)" /> : <Check size={14} color="var(--ok)" />}</span>
        <span className="think-text" role={running ? "status" : undefined}>{text}</span><ChevronRight size={14} className={`chev ${open ? "open" : ""}`} aria-hidden />
      </button>
      {open && <StepList steps={steps} />}
    </div>
  );
}

function ConfirmCard({ m, busy, onResolve }: { m: Message; busy: boolean; onResolve: (a: "approve" | "cancel") => void }) {
  const c = m.confirmation!; const pending = c.state === "pending";
  return (
    <div className={`confirm-card ${c.state}`} role="group" aria-label="Approval needed">
      <div className="row"><ShieldCheck size={16} aria-hidden /><strong>{pending ? "Approval needed" : c.state === "approved" ? "Approved" : c.state === "cancelled" ? "Cancelled" : "Expired"}</strong></div>
      <p className="confirm-summary">{c.summary}</p>
      {pending ? <div className="row"><button className="btn primary" disabled={busy} onClick={() => onResolve("approve")}>Approve</button><button className="btn" disabled={busy} onClick={() => onResolve("cancel")}>Cancel</button><span className="small muted">Expires {new Date(c.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Vera checks this again on the server.</span></div>
        : c.state === "expired" && <p className="small muted">This request timed out and nothing was done. Ask again if you still want it.</p>}
    </div>
  );
}

export function ChatPage() {
  const { id } = useParams(); const nav = useNavigate(); const api = useApi(); const toast = useToast(); const { settings } = useSettings();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [listening, setListening] = useState(false); const [speaking, setSpeaking] = useState(false); const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); const [openMap, setOpenMap] = useState<Record<string, boolean>>({}); const [resolving, setResolving] = useState(false); const [error, setError] = useState<{ msg: string; retry: () => void } | null>(null);
  const { runs, start, stop, clear, markSeen, setOpen } = useRuns(); const run: Run | undefined = id ? runs[id] : undefined; const busy = run?.status === "running";
  const viewing = useRef<string | undefined>(id); const rec = useRef<Rec | null>(null); const awayRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null); const SR = recCtor();
  const reduce = settings.reduceMotion || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

  const follow = useCallback(() => { if (!awayRef.current) toBottom(scroller.current); }, []);
  useEffect(() => {
    viewing.current = id; setError(null); setFresh(null);
    if (!id) { setConv(null); return; }
    let live = true; api.getConversation(id).then((c) => { if (live) setConv(c); });
    return () => { live = false; };
  }, [id, api]);
  useEffect(() => { if (id && run && run.status !== "running" && !run.seen) markSeen(id); }, [id, run, markSeen]);
  useEffect(() => { if (!awayRef.current) toBottom(scroller.current, !reduce); }, [conv, busy, error, reduce]);

  const speak = useCallback((text: string) => {
    if (!canSpeak()) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, ""));
    u.onend = u.onerror = () => setSpeaking(false); setSpeaking(true); window.speechSynthesis.speak(u);
  }, []);

  const send = async (text: string, regenerate = false) => {
    const t = text.trim(); if (!t || busy) return;
    if (!regenerate) { setDraft(""); setFile(null); }
    setError(null);
    try {
      let cid = id; if (!cid) { cid = (await api.createConversation()).id; nav(`/chat/${cid}`, { replace: true }); viewing.current = cid; }
      awayRef.current = false; setAway(false); clear(cid); start(cid, t, regenerate);
    } catch (e) { setError({ msg: errMsg(e), retry: () => void send(t, regenerate) }); }
  };
  // When a reply finishes (even if we were on another page), load it and keep the thinking line exactly as it was.
  const doneId = run?.status === "done" ? run.message?.id : undefined;
  useEffect(() => {
    if (!id || !run || run.status !== "done" || !run.message) return; let live = true; const r = run;
    api.getConversation(id).then((c) => {
      if (!live) return; setConv(c); const recent = Date.now() - (r.finishedAt ?? 0) < 4000;
      setOpenMap((m) => ({ ...m, [r.message!.id]: r.open })); setFresh(recent ? r.message!.id : null); markSeen(id); clear(id);
      if (settings.speakReplies && recent) speak(r.message!.content);
    });
    return () => { live = false; };
  }, [doneId, id]);
  const retryRun = (r: Run) => { const l = conv?.messages[conv.messages.length - 1]; const saved = l?.role === "user" && l.content.trim() === r.text.trim(); clear(r.cid); void send(r.text, saved); };
  const resolve = async (m: Message, action: "approve" | "cancel") => {
    const c = m.confirmation; if (!c || !id) return; setResolving(true);
    try { const r = await api.resolveConfirmation(c.id, c.token, action); setFresh(r.id); setConv(await api.getConversation(id)); notifyData(); }
    catch (e) { toast(errMsg(e), "error"); if (id) setConv(await api.getConversation(id)); } finally { setResolving(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && settings.enterToSend && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } };
  const mic = () => {
    if (!SR) return; if (listening) { rec.current?.abort(); return; }
    const r = new SR(); r.lang = navigator.language; r.interimResults = true; r.continuous = false; rec.current = r;
    r.onresult = (e) => setDraft(Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" "));
    r.onerror = (e) => toast(e.error === "not-allowed" ? "Microphone permission was denied." : `Voice input error: ${e.error}`, "error");
    r.onend = () => setListening(false); setListening(true); r.start();
  };
  let msgs = conv?.messages ?? [];
  if (run?.status === "running" && id) {
    if (run.regenerate) { msgs = [...msgs]; while (msgs.length && msgs[msgs.length - 1]!.role === "assistant") msgs.pop(); }
    else { const l = msgs[msgs.length - 1]; if (!(l?.role === "user" && (l.content.trim() === run.text.trim() || new Date(l.createdAt).getTime() >= run.startedAt - 5000))) msgs = [...msgs, { id: `tmp-${run.startedAt}`, conversationId: id, role: "user", content: run.text, createdAt: new Date(run.startedAt).toISOString() }]; }
  }
  const shownError = error ?? (run?.status === "error" ? { msg: run.error ?? "Something went wrong.", retry: () => retryRun(run) } : null);
  const lastIdx = msgs.length - 1; const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const empty = !msgs.length && !busy;

  const composer = (
    <div className="composer-wrap">
      <div className={`composer ${listening ? "listening" : ""}`}>
        {file && <div className="attach"><FileText size={15} /><span className="grow">{file.name} · {Math.ceil(file.size / 1024)} KB <span className="muted">· not uploaded or processed</span></span><button className="icon" aria-label="Remove attachment" onClick={() => setFile(null)}><X size={14} /></button></div>}
        <textarea aria-label="Message" rows={1} placeholder={listening ? "Listening…" : "Message Vera"} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="row">
          <label className="icon round" aria-label="Attach file" title="Attach file (stays on this device)"><Plus size={19} /><input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <span className="grow" />
          {speaking && <button className="icon" aria-label="Stop speaking" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}><Volume2 size={18} /></button>}
          <button className={`icon round ${listening ? "on" : ""}`} aria-label={SR ? (listening ? "Cancel voice input" : "Start voice input") : "Voice input unavailable"} disabled={!SR} title={SR ? "" : "Speech recognition isn't supported here. Type instead."} onClick={mic}><Mic size={18} /></button>
          {busy ? <button className="send stop" aria-label="Stop" onClick={() => id && stop(id)}><Square size={13} fill="currentColor" /></button>
            : <button className="send" aria-label="Send" disabled={!draft.trim()} onClick={() => void send(draft)}><ArrowUp size={18} /></button>}
        </div>
      </div>
      {!empty && <p className="fine">{api.kind === "mock" ? "Vera is in demo mode. Replies are scripted and nothing leaves this device." : "Vera can make mistakes. Banking details, passwords and keys are never sent to the AI."}</p>}
    </div>
  );

  return (
    <section className={`chat ${empty ? "empty" : ""}`} aria-label="Chat">
      <div className="scroll" ref={scroller} onScroll={(e) => { const el = e.currentTarget; const a = el.scrollHeight - el.scrollTop - el.clientHeight > 80; awayRef.current = a; setAway(a); }}>
        {empty ? (
          <div className="welcome"><h1>{settings.name ? `Hello, ${settings.name}. What can I help you with?` : "Hello, I'm Vera. What can I help you with?"}</h1><p>{api.kind === "mock" ? "This build uses local demo functionality. No AI model is connected." : "Ask for the time, a sum or your tasks and Vera answers locally. Other questions use the AI provider if you have enabled one."}</p></div>
        ) : (
          <ol className="msgs">
            {msgs.map((m, i) => (
              <li key={m.id} className={`msg ${m.role}`}>
                {m.role === "assistant" && <span className="avatar" aria-hidden>V</span>}
                <div className="content">
                  {m.role === "user" ? <div className="ububble">{m.content}</div> : <>
                    {m.tool && <span className="chip">Used {m.tool}</span>}
                    {m.steps && m.steps.length > 0 && <Thinking steps={m.steps} running={false} open={!!openMap[m.id]} onToggle={() => setOpenMap((o) => ({ ...o, [m.id]: !o[m.id] }))} />}
                    <Reveal text={m.content} animate={fresh === m.id && !reduce} onTick={follow} />
                    {m.policy && <div className="policy" role="note"><ShieldAlert size={15} aria-hidden /><div><strong>Held back by the privacy policy</strong><p className="small muted">Detected: {m.policy.categories.map((c) => c.replace(/_/g, " ")).join(", ") || m.policy.classification.toLowerCase()}. Nothing was sent to any AI provider.</p>{m.policy.redactedSuggestion && <button className="btn small-btn" onClick={() => setDraft(m.policy!.redactedSuggestion!)}>Use redacted text</button>}</div></div>}
                    {m.confirmation && <ConfirmCard m={m} busy={resolving} onResolve={(a) => void resolve(m, a)} />}
                    <div className="actions">
                      <button className="icon" aria-label="Copy message" onClick={() => { void navigator.clipboard?.writeText(m.content); toast("Copied", "success"); }}><Copy size={15} /></button>
                      {canSpeak() && <button className="icon" aria-label="Read aloud" onClick={() => speak(m.content)}><Volume2 size={15} /></button>}
                      {i === lastIdx && lastUser && !busy && <button className="icon" aria-label="Regenerate response" onClick={() => void send(lastUser.content, true)}><RefreshCw size={15} /></button>}
                    </div></>}
                </div>
              </li>
            ))}
            {busy && <li className="msg assistant"><span className="avatar working" aria-hidden>V</span><div className="content thinking" role="status"><Thinking steps={run?.steps ?? []} running startedAt={run?.startedAt} open={!!run?.open} onToggle={() => id && setOpen(id, !run?.open)} /><span className="dots" aria-hidden><i /><i /><i /></span></div></li>}
            {shownError && <li className="msg assistant"><span className="avatar err" aria-hidden><AlertCircle size={15} /></span><div className="content errbox" role="alert"><span>{shownError.msg}</span><button className="btn small-btn" onClick={shownError.retry}>Retry</button></div></li>}
          </ol>
        )}
      </div>
      {away && <button className="jump" aria-label="Scroll to latest" onClick={() => { awayRef.current = false; setAway(false); toBottom(scroller.current, true); }}><ArrowDown size={16} /></button>}
      {composer}
      {empty && <div className="prompts">{(settings.interests[0] ? [...PROMPTS.slice(0, 3), `Tell me something interesting about ${settings.interests[0].toLowerCase()}.`] : PROMPTS).map((p, i) => <button key={p} className="chipbtn" style={{ animationDelay: `${120 + i * 70}ms` }} onClick={() => void send(p)}>{p}</button>)}</div>}
    </section>
  );
}
