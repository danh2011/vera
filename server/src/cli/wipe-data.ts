/**
 * Wipes Vera's data so you can test first-run again.   npm run reset-data
 * Deletes the SQLite database (+ WAL/SHM) and the encryption key. Stop the server first.
 * Flags: --yes (skip the question)  --keep-key (keep secret.key)
 */
import fs from "node:fs";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import Database from "better-sqlite3";
import { loadConfig } from "../config.js";

try { process.loadEnvFile?.(".env"); } catch { /* optional */ }
const args = new Set(process.argv.slice(2)); const config = loadConfig();
const db = config.databasePath; const files = [db, `${db}-wal`, `${db}-shm`, `${db}-journal`, ...(args.has("--keep-key") || process.env.VERA_SECRET_KEY ? [] : [config.secretKeyFile])];
const existing = files.filter((f) => fs.existsSync(f));
if (!existing.length) { console.log(`Nothing to delete. Vera has no data at ${config.dataDir} yet.`); process.exit(0); }

// Refuse if Vera (or anything) is using the database right now.
if (fs.existsSync(db)) { try { const t = new Database(db); t.pragma("busy_timeout = 500"); t.exec("BEGIN EXCLUSIVE"); t.exec("ROLLBACK"); t.close(); } catch { console.error("The database is in use. Stop Vera first (Ctrl+C in the terminal running `npm run dev`, or `docker compose stop`), then run this again."); process.exit(1); } }

console.log("This will permanently delete:\n" + existing.map((f) => `  ${f}`).join("\n") + "\n\nAll conversations, tasks, notes, memories, integrations, credentials and the owner account will be gone.");
if (!args.has("--yes")) { const rl = readline.createInterface({ input: stdin, output: stdout }); const a = await new Promise<string>((res) => { rl.once("close", () => res("")); rl.question('Type "wipe" to continue: ', (ans) => { res(ans.trim().toLowerCase()); rl.close(); }); }); if (a !== "wipe") { console.log("Cancelled. Nothing was deleted."); process.exit(0); } }
for (const f of existing) fs.rmSync(f, { force: true });
console.log("\nDone. Start Vera again (npm run dev) and a new setup code will be printed.\nIn the browser, the setup screen will appear and the welcome tour will run again.");
