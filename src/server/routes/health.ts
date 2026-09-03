import { Router } from "express";
import fs from "node:fs";
import { db } from "../database/db.js";
import { env, isGeminiConfigured } from "../env.js";
import { checkGeminiHealth } from "../ai/chatEngine.js";
import { HealthStatus } from "../../shared/types.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let dbOk = false;
  try {
    db.prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const workspaceOk = fs.existsSync(env.WORKSPACE_PATH);
  const geminiConfigured = isGeminiConfigured();
  const geminiOk = geminiConfigured ? await checkGeminiHealth() : null;

  const status: HealthStatus = {
    status: dbOk && workspaceOk && (geminiOk !== false) ? "ok" : geminiConfigured && geminiOk === false ? "degraded" : "error",
    checks: {
      application: true,
      database: dbOk,
      gemini: { configured: geminiConfigured, ok: geminiOk },
      workspace: workspaceOk,
    },
    version: "0.1.0",
  };

  res.json(status);
});
