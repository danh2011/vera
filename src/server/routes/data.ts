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
