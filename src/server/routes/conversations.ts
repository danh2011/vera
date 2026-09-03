import { Router } from "express";
import { db } from "../database/db.js";

export const conversationsRouter = Router();

conversationsRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM conversations ORDER BY updatedAt DESC").all();
  res.json(rows);
});

conversationsRouter.get("/:id/messages", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC")
    .all(req.params.id);
  res.json(rows);
});

conversationsRouter.patch("/:id", (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }
  const result = db
    .prepare("UPDATE conversations SET title = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(title.trim(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

conversationsRouter.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});

conversationsRouter.post("/", (_req, res) => {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO conversations (id, title) VALUES (?, ?)").run(id, "New conversation");
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  res.status(201).json(row);
});
