import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import "./database/db.js"; // runs migrations on import
import { registerAllCapabilities } from "./capabilities/index.js";
import { startReminderScheduler } from "./capabilities/reminders.js";
import { loadAutomationsOnStartup } from "./capabilities/automation.js";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { dataRouter } from "./routes/data.js";
import { settingsRouter } from "./routes/settings.js";
import { healthRouter } from "./routes/health.js";
import { versionRouter } from "./routes/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerAllCapabilities();
startReminderScheduler();
loadAutomationsOnStartup();

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
