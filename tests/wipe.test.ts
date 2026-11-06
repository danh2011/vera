import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../server/src/database/db.js";
import { tmp } from "./helpers.js";

const run = (dir: string, args: string[]) => spawnSync("npx", ["tsx", "server/src/cli/wipe-data.ts", ...args], { env: { ...process.env, VERA_DATA_DIR: dir, NODE_ENV: "development" }, encoding: "utf8", input: "" });

describe("npm run reset-data", () => {
  it("deletes the database, WAL files and key; refuses while the database is in use; is safe on an empty folder", () => {
    const dir = tmp(); const empty = run(dir, ["--yes"]); expect(empty.stdout).toMatch(/Nothing to delete/);
    const { db } = openDatabase(path.join(dir, "vera.db")); db.prepare("INSERT INTO settings VALUES ('x','1','now')").run(); fs.writeFileSync(path.join(dir, "secret.key"), "k");
    db.exec("BEGIN EXCLUSIVE"); const busy = run(dir, ["--yes"]); expect(busy.status).toBe(1); expect(busy.stderr).toMatch(/in use/); expect(fs.existsSync(path.join(dir, "vera.db"))).toBe(true);
    db.exec("ROLLBACK"); db.close();
    const cancelled = run(dir, []); expect(cancelled.stdout).toMatch(/Cancelled/); expect(fs.existsSync(path.join(dir, "vera.db"))).toBe(true);
    const done = run(dir, ["--yes"]); expect(done.status).toBe(0); expect(done.stdout).toMatch(/Done/); expect(fs.readdirSync(dir)).toEqual([]);
    const { applied } = openDatabase(path.join(dir, "vera.db")); expect(applied.length).toBeGreaterThan(0); // a fresh database is created from scratch afterwards
  });
  it("can keep the encryption key", () => { const dir = tmp(); openDatabase(path.join(dir, "vera.db")).db.close(); fs.writeFileSync(path.join(dir, "secret.key"), "k"); execFileSync("npx", ["tsx", "server/src/cli/wipe-data.ts", "--yes", "--keep-key"], { env: { ...process.env, VERA_DATA_DIR: dir }, encoding: "utf8" }); expect(fs.readdirSync(dir)).toEqual(["secret.key"]); });
});
