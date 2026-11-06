import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Pencil, Trash2, X } from "lucide-react";
import type { ReminderChannel, ReminderDto } from "../../shared/types";
import { Confirm, errMsg, useApi, useToast } from "../context";
import type { Priority, Task } from "../types";

type Filter = "all" | "open" | "completed" | "overdue";
const overdue = (t: Task) => !t.completed && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export default function TasksPage() {
  const api = useApi(); const toast = useToast(); const nav = useNavigate();
  const [reminders, setReminders] = useState<ReminderDto[]>([]); const [channel, setChannel] = useState<ReminderChannel | null>(null); const [setting, setSetting] = useState(false);
  const loadReminders = useCallback(() => { api.listReminders().then((r) => { setReminders(r.reminders); setChannel(r.channel); }).catch(() => {}); }, [api]);
  useEffect(loadReminders, [loadReminders]);
  const [tasks, setTasks] = useState<Task[]>([]); const [filter, setFilter] = useState<Filter>("all"); const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Task | "new" | null>(null); const [del, setDel] = useState<Task | null>(null);
  const load = useCallback(() => { api.listTasks().then(setTasks).catch((e) => toast(errMsg(e), "error")); loadReminders(); }, [api, toast, loadReminders]);
  useEffect(load, [load]);
  const shown = tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()) && (filter === "all" || (filter === "open" && !t.completed) || (filter === "completed" && t.completed) || (filter === "overdue" && overdue(t))))
    .sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "success"); load(); } catch (e) { toast(errMsg(e), "error"); } };
  return (
    <main className="page">
      <h1>Tasks</h1>
      <p className="muted">{api.kind === "mock" ? "Demo data stored in this browser." : "Tasks live in Vera's database on your server."}</p>
      {channel && !channel.ready && api.kind !== "mock" && <div className="notice cta" role="note"><Bell size={16} aria-hidden /><div className="grow"><strong>Reminders can't alert you yet</strong><p className="small muted">{channel.detail} Reminders you set now are kept and sent once Notifications is working (up to a day late).</p></div>
        <button className="btn primary" disabled={setting} onClick={async () => { if (!channel.installed) { setSetting(true); try { await api.integrations.install(channel.integrationId); } catch (e) { toast(errMsg(e), "error"); setSetting(false); return; } setSetting(false); } nav(`/integrations/${channel.integrationId}?setup=1${channel.status === "needs_dependency" || !channel.installed ? "&step=deps" : ""}`); }}>{channel.installed ? "Finish setting up reminders" : "Set up reminders"}</button></div>}
      {channel?.ready && <p className="small muted"><Bell size={13} aria-hidden /> Reminders are delivered through Home Assistant.</p>}
      <div className="row wrap">
        <button className="btn primary" onClick={() => setEdit("new")}>Add task</button>
        <input aria-label="Search tasks" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="group" aria-label="Filter">{(["all", "open", "completed", "overdue"] as Filter[]).map((f) => <button key={f} className={`btn ${filter === f ? "primary" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
      </div>
      {!shown.length ? <p className="empty">{tasks.length ? "No tasks match this filter." : "No tasks yet. Add your first one."}</p> : (
        <ul className="list">{shown.map((t) => (
          <li key={t.id} className={overdue(t) ? "late" : ""}>
            <input type="checkbox" aria-label={`Mark "${t.title}" ${t.completed ? "open" : "complete"}`} checked={t.completed} onChange={() => run(() => api.updateTask(t.id, { completed: !t.completed }), t.completed ? "Task reopened" : "Task completed")} />
            <div className="grow"><div className={t.completed ? "done" : ""}>{t.title}</div>
              <div className="small muted">{t.dueAt ? new Date(t.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "No due date"}{overdue(t) && <span className="badge danger">Overdue</span>}<span className={`badge ${t.priority === "high" ? "warn" : ""}`}>{t.priority}</span></div></div>
            <button className="icon" aria-label={`Edit ${t.title}`} onClick={() => setEdit(t)}><Pencil size={15} /></button>
            <button className="icon" aria-label={`Delete ${t.title}`} onClick={() => setDel(t)}><Trash2 size={15} /></button>
          </li>))}</ul>)}
      {(reminders.length > 0) && <section aria-label="Reminders"><h2>Reminders</h2>
        <ul className="list">{reminders.map((r) => { const late = r.status === "scheduled" && new Date(r.remindAt).getTime() < Date.now(); return (
          <li key={r.id}><Bell size={15} aria-hidden /><div className="grow"><div>{r.title}</div><div className="small muted">{new Date(r.remindAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            <span className={`badge ${r.status === "failed" || r.status === "missed" ? "danger" : late ? "warn" : ""}`}>{r.status === "scheduled" ? (late ? (r.attempts ? "Retrying" : "Waiting for Notifications") : "Scheduled") : r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" : "Missed"}</span>
            {r.deliveryDetail && r.status !== "scheduled" || (late && r.deliveryDetail) ? <span> · {r.deliveryDetail}</span> : null}</div></div>
            {r.status === "scheduled" && <button className="icon" aria-label={`Cancel reminder ${r.title}`} onClick={() => void run(() => api.cancelReminder(r.id), "Reminder cancelled")}><X size={15} /></button>}</li>); })}</ul></section>}
      {edit && <TaskForm channelReady={!!channel?.ready} task={edit === "new" ? null : edit} onCancel={() => setEdit(null)} onSave={(v, remindMin) => { const t = edit; setEdit(null); void run(async () => { const saved = t === "new" ? await api.createTask(v) : await api.updateTask(t.id, v); if (remindMin !== null && saved.dueAt) await api.createReminder({ title: saved.title, remindAt: new Date(new Date(saved.dueAt).getTime() - remindMin * 60000).toISOString(), taskId: saved.id }); }, remindMin !== null ? "Task and reminder saved" : "Task saved"); }} />}
      {del && <Confirm title="Delete task?" body={`"${del.title}" will be removed.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const t = del; setDel(null); void run(() => api.deleteTask(t.id), "Task deleted"); }} />}
    </main>
  );
}

function TaskForm({ task, channelReady, onSave, onCancel }: { task: Task | null; channelReady: boolean; onSave: (v: { title: string; description?: string; dueAt?: string; priority: Priority }, remindMin: number | null) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task?.title ?? ""); const [due, setDue] = useState(toLocal(task?.dueAt)); const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium"); const [err, setErr] = useState(""); const [remind, setRemind] = useState("none");
  const submit = (e: FormEvent) => { e.preventDefault(); if (!title.trim()) return setErr("Title is required."); if (title.length > 120) return setErr("Title must be 120 characters or fewer."); const min = remind === "none" ? null : Number(remind); if (min !== null) { if (!due) return setErr("Set a due date to add a reminder."); if (new Date(due).getTime() - min * 60000 < Date.now() - 60000) return setErr("That reminder time has already passed. Choose a later due date or a shorter lead time."); } onSave({ title: title.trim(), priority, dueAt: due ? new Date(due).toISOString() : undefined }, min); };
  return (
    <div className="overlay" onClick={onCancel}><form className="dialog" role="dialog" aria-modal="true" aria-label={task ? "Edit task" : "New task"} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
      <h2>{task ? "Edit task" : "New task"}</h2>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-invalid={!!err} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      <label>Due (optional)<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label>Remind me<select value={remind} onChange={(e) => setRemind(e.target.value)} disabled={!due}><option value="none">No reminder</option><option value="0">At the due time</option><option value="15">15 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select>{due && remind !== "none" && !channelReady && <span className="small warnc">Notifications isn't set up, so this will wait until it is.</span>}</label>
      <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}><option>low</option><option>medium</option><option>high</option></select></label>
      <div className="row end"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Save</button></div>
    </form></div>
  );
}
