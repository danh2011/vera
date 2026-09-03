import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import "./database/db.js"; // runs migrations on import
import { registerAllCapabilities, validateCapabilities } from "./capabilities/index.js";
import { startReminderScheduler } from "./capabilities/reminders.js";
import { loadAutomationsOnStartup } from "./capabilities/automation.js";
import { checkGeminiHealth } from "./ai/gemini.js";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { dataRouter } from "./routes/data.js";
import { settingsRouter } from "./routes/settings.js";
import { healthRouter } from "./routes/health.js";
import { versionRouter } from "./routes/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Startup initialization and health checks ---
async function startup() {
  // Register capabilities and validate them
  registerAllCapabilities();
  const validationErrors = validateCapabilities();
  if (validationErrors.length > 0) {
    console.warn("[vera] validation warnings:");
    validationErrors.forEach((err) => console.warn(`  - ${err}`));
  }

  // Start background schedulers
  startReminderScheduler();
  loadAutomationsOnStartup();

  // Check AI provider health
  if (env.GEMINI_API_KEY) {
    const geminiHealth = await checkGeminiHealth();
    if (geminiHealth) {
      console.log("[vera] Gemini API is reachable");
    } else {
      console.warn("[vera] warning: Gemini API is not reachable or API key may be invalid");
    }
  } else {
    console.warn("[vera] GEMINI_API_KEY not configured - AI features disabled");
  }
}

await startup();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/chat", chatRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/data", dataRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/version", versionRouter);
app.use("/health", healthRouter);

if (env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Never leak raw exceptions to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(env.PORT, () => {
  console.log(`[vera] server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
