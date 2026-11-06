import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Confirm, errMsg, useApi, useToast } from "../context";
import type { MemoryCategory, MemoryItem } from "../types";

export default function MemoryPage() {
  const api = useApi(); const toast = useToast(); const [tab, setTab] = useState<"memory" | "notes">("memory"); const notes = tab === "notes";
  const [items, setItems] = useState<MemoryItem[]>([]); const [q, setQ] = useState("");
  const [edit, setEdit] = useState<MemoryItem | "new" | null>(null); const [del, setDel] = useState<MemoryItem | null>(null);
  const load = useCallback(() => { (notes ? api.listNotes() : api.listMemories()).then(setItems).catch((e) => toast(errMsg(e), "error")); }, [api, toast, notes]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "success"); load(); } catch (e) { toast(errMsg(e), "error"); } };
  const shown = items.filter((m) => `${m.title} ${m.content}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <main className="page">
      <h1>Memory</h1>
      <div className="chips" role="tablist" aria-label="Memory or notes"><button role="tab" aria-selected={!notes} className={`chipbtn ${!notes ? "on" : ""}`} onClick={() => { setTab("memory"); setQ(""); }}>Memory</button><button role="tab" aria-selected={notes} className={`chipbtn ${notes ? "on" : ""}`} onClick={() => { setTab("notes"); setQ(""); }}>Notes</button></div>
      <p className="muted">{notes ? "Notes are longer pieces of text you or the assistant save. They stay in Vera's database and can be searched." : api.kind === "mock" ? "A plain list you create and edit yourself. Nothing is extracted automatically." : "Facts and preferences the assistant may use to personalise answers. It must ask your approval before saving one, and you can edit or delete anything here. Sensitive details are never sent to a cloud AI."}</p>
      <div className="row wrap"><button className="btn primary" onClick={() => setEdit("new")}>{notes ? "Add note" : "Add memory"}</button><input aria-label="Search memory" placeholder={notes ? "Search notes" : "Search memory"} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!shown.length ? <p className="empty">{items.length ? "No results." : notes ? "No notes yet." : "Nothing saved yet."}</p> : (
        <ul className="list">{shown.map((m) => (
          <li key={m.id}><div className="grow"><strong>{m.title}</strong> {!notes && <span className="badge">{m.category}</span>}{!notes && m.source === "assistant" && <span className="badge">saved by Vera</span>}<div>{m.content}</div><div className="small muted">Updated {new Date(m.updatedAt).toLocaleDateString()}</div></div>
            <button className="icon" aria-label={`Edit ${m.title}`} onClick={() => setEdit(m)}><Pencil size={15} /></button>
            <button className="icon" aria-label={`Delete ${m.title}`} onClick={() => setDel(m)}><Trash2 size={15} /></button></li>))}</ul>)}
      {edit && <MemForm notes={notes} item={edit === "new" ? null : edit} onCancel={() => setEdit(null)} onSave={(v) => { const t = edit; setEdit(null); void run(() => notes ? (t === "new" ? api.createNote(v) : api.updateNote(t.id, v)) : (t === "new" ? api.createMemory(v) : api.updateMemory(t.id, v)), notes ? "Note saved" : "Memory saved"); }} />}
      {del && <Confirm title={notes ? "Delete note?" : "Delete memory?"} body={`"${del.title}" will be removed.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const t = del; setDel(null); void run(() => (notes ? api.deleteNote(t.id) : api.deleteMemory(t.id)), notes ? "Note deleted" : "Memory deleted"); }} />}
    </main>
  );
}
function MemForm({ notes, item, onSave, onCancel }: { notes: boolean; item: MemoryItem | null; onSave: (v: { title: string; content: string; category: MemoryCategory }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item?.title ?? ""); const [content, setContent] = useState(item?.content ?? ""); const [category, setCategory] = useState<MemoryCategory>(item?.category ?? "note"); const [err, setErr] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (!title.trim() || !content.trim()) return setErr("Title and content are required."); onSave({ title: title.trim(), content: content.trim(), category }); };
  return (
    <div className="overlay" onClick={onCancel}><form className="dialog" role="dialog" aria-modal="true" aria-label={(item ? "Edit " : "New ") + (notes ? "note" : "memory")} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
      <h2>{(item ? "Edit " : "New ") + (notes ? "note" : "memory")}</h2>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
      <label>Content<textarea rows={notes ? 8 : 4} value={content} onChange={(e) => setContent(e.target.value)} /></label>
      {err && <p className="err" role="alert">{err}</p>}
      {!notes && <label>Type<select value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}><option>note</option><option>fact</option><option>preference</option></select></label>}
      <div className="row end"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Save</button></div>
    </form></div>
  );
}
