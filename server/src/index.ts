import fs from "node:fs";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

async function main() {
  try { process.loadEnvFile?.(".env"); } catch { /* no .env file: fine */ }
  let config; try { config = loadConfig(); } catch (e) { if (e instanceof ConfigError) { console.error(e.message); process.exit(1); } throw e; }
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const built = await buildApp(config);
  const { app, auth } = built;
  const shutdown = async (sig: string) => { app.log.info({ sig }, "shutting down"); const t = setTimeout(() => process.exit(1), 10_000); t.unref(); try { await built.close(); } finally { process.exit(0); } };
  process.on("SIGTERM", () => void shutdown("SIGTERM")); process.on("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ host: config.host, port: config.port });
  const g = built.guard.status();
  app.log.info({ env: config.env, host: config.host, port: config.port, fts5: built.deps.fts, ai: g.ready ? "ready" : g.reason, machineReadonly: config.machine.readonly, fileRoots: config.files.roots.length }, "Vera is running");
  if (!auth.ownerExists()) {
    const t = auth.generatedSetupToken;
    console.log(`\n  First-run setup: open ${config.publicUrl} and create the owner account.\n  Setup code: ${t ?? "(the VERA_SETUP_TOKEN you configured)"}\n`);
  }
}
main().catch((e) => { console.error("Fatal:", e instanceof Error ? e.message : e); process.exit(1); });
