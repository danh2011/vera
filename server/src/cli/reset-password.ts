/** Owner recovery: run on the server with shell access to the data directory.  npm run reset-password */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AuthService } from "../auth/auth.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../database/db.js";
import { createRepos } from "../database/repos.js";

try { process.loadEnvFile?.(".env"); } catch { /* optional */ }
const config = loadConfig(); const { db, caps } = openDatabase(config.databasePath); const repos = createRepos(db, caps.fts5);
const owner = repos.users.first(); if (!owner) { console.error("No owner exists yet. Open Vera in the browser to run first-time setup."); process.exit(1); }
const rl = readline.createInterface({ input: stdin, output: stdout });
const pw = process.env.VERA_NEW_PASSWORD ?? await rl.question(`New password for "${owner.username}" (min 12 characters; input is visible): `); rl.close();
try { await new AuthService(config, repos).resetPassword(owner.id, pw); console.log("Password changed. All existing sessions were signed out."); }
catch (e) { console.error((e as Error).message); process.exit(1); }
db.close();
