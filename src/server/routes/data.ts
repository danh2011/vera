import { Router } from "express";
import { db } from "../database/db.js";

export const dataRouter = Router();

// Simple read-only listing endpoints the frontend uses to render sidebar
// widgets / settings screens without going through the AI at all.

dataRouter.get("/memories", (_req, res) => {
  res.json(db.prepare("SELECT * FROM memories ORDER BY importance DESC, updatedAt DESC").all());
});

dataRouter.get("/calendar", (_req, res) => {
  res.json(db.prepare("SELECT * FROM calendar_events ORDER BY startsAt ASC").all());
});

dataRouter.get("/reminders", (_req, res) => {
  res.json(db.prepare("SELECT * FROM reminders WHERE completed = 0 ORDER BY dueAt ASC").all());
});

dataRouter.get("/notes", (_req, res) => {
  res.json(db.prepare("SELECT * FROM notes ORDER BY updatedAt DESC").all());
});

dataRouter.get("/tasks", (_req, res) => {
  res.json(db.prepare("SELECT * FROM tasks WHERE status = 'open' ORDER BY dueDate IS NULL, dueDate ASC").all());
});

dataRouter.get("/automations", (_req, res) => {
  res.json(db.prepare("SELECT * FROM automations ORDER BY name ASC").all());
});

// --- Conversation Export (v0.1.1) ---

dataRouter.get("/conversations/export/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const messages = db.prepare("SELECT * FROM messages WHERE conversationId = ? ORDER BY id ASC").all(conversationId);

  const exportData = {
    metadata: {
      exportedAt: new Date().toISOString(),
      veraVersion: "0.1.1",
    },
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    messageCount: messages.length,
    messages,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="vera-chat-${conversationId.slice(0, 8)}.json"`);
  res.json(exportData);
});

// --- Database Maintenance (v0.1.1) ---

dataRouter.get("/maintenance/stats", (_req, res) => {
  const tables = [
    "conversations",
    "messages",
    "memories",
    "calendar_events",
    "reminders",
    "notes",
    "tasks",
    "automations",
  ];

  const stats: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    tables: {},
    summary: {} as Record<string, number>,
  };

  let totalRows = 0;

  for (const table of tables) {
    try {
      const count = (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any).count;
      stats.tables[table] = count;
      stats.summary[table] = count;
      totalRows += count;
    } catch (err) {
      stats.tables[table] = null;
    }
  }

  stats.summary.totalRows = totalRows;
  stats.summary.dataPath = process.env.DATABASE_PATH || "./data/vera.db";

  res.json(stats);
});

dataRouter.post("/maintenance/vacuum", (_req, res) => {
  try {
    db.exec("VACUUM");
    res.json({ ok: true, message: "Database optimized successfully" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

