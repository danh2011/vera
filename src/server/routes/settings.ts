import { Router } from "express";
import { db } from "../database/db.js";
import { env, isGeminiConfigured } from "../env.js";

export const settingsRouter = Router();

const DEFAULTS: Record<string, string> = {
  theme: "system",
  developerMode: env.DEV_MODE ? "true" : "false",
};

settingsRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) settings[r.key] = r.value;
  res.json({
    ...settings,
    developerMode: settings.developerMode === "true",
    geminiConfigured: isGeminiConfigured(),
    geminiModel: env.GEMINI_MODEL,
  });
});

settingsRouter.put("/", (req, res) => {
  const body = req.body ?? {};
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) upsert.run(key, String(value));
  });
  tx(Object.entries(body) as [string, string][]);
  res.json({ ok: true });
});
