#!/usr/bin/env node
// Vera update script (npm run update)
//
// Downloads the latest GitHub release for UPDATE_REPO, backs up the current
// installation, applies the update, and validates that the new version
// starts successfully before considering the update complete. Rolls back
// automatically on any failure. Never overwrites the SQLite database or
// workspace directory - those live in `data/` and are left untouched.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repo = process.env.UPDATE_REPO;

if (!repo) {
  console.error("UPDATE_REPO is not set in .env - nothing to update from.");
  process.exit(1);
}

function log(msg) {
  console.log(`[update] ${msg}`);
}

async function main() {
  log(`Checking latest release for ${repo}...`);
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch latest release (${res.status})`);
  const release = await res.json();
  const tag = release.tag_name;
  const asset = release.assets?.find((a) => a.name.endsWith(".tar.gz"));
  if (!asset) throw new Error("No .tar.gz asset found on the latest release.");

  const backupDir = path.join(root, ".backups", `pre-${tag}-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  log(`Backing up current dist/ and package.json to ${backupDir}`);
  fs.cpSync(path.join(root, "dist"), path.join(backupDir, "dist"), { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(backupDir, "package.json"));

  const tmpFile = path.join(root, `.update-${tag}.tar.gz`);
  log(`Downloading ${asset.browser_download_url}...`);
  const download = await fetch(asset.browser_download_url);
  const buffer = Buffer.from(await download.arrayBuffer());
  fs.writeFileSync(tmpFile, buffer);

  const extractDir = path.join(root, `.update-extract-${tag}`);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tmpFile, "-C", extractDir]);

  log("Applying update...");
  fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
  fs.cpSync(path.join(extractDir, "dist"), path.join(root, "dist"), { recursive: true });
  fs.copyFileSync(path.join(extractDir, "package.json"), path.join(root, "package.json"));

  log("Installing dependencies...");
  execFileSync("npm", ["ci", "--omit=dev"], { cwd: root, stdio: "inherit" });

  log("Validating that the new version starts...");
  const ok = await validateStartup();
  if (!ok) {
    log("Validation FAILED. Rolling back...");
    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
    fs.cpSync(path.join(backupDir, "dist"), path.join(root, "dist"), { recursive: true });
    fs.copyFileSync(path.join(backupDir, "package.json"), path.join(root, "package.json"));
    execFileSync("npm", ["ci", "--omit=dev"], { cwd: root, stdio: "inherit" });
    log("Rolled back to previous version.");
    process.exitCode = 1;
  } else {
    log(`Update to ${tag} complete.`);
  }

  fs.rmSync(tmpFile, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
}

function validateStartup() {
  return new Promise((resolve) => {
    const child = spawn("node", ["dist/server/index.js"], { cwd: root, env: process.env });
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve(false);
      }
    }, 15000);

    child.stdout.on("data", (chunk) => {
      if (!settled && chunk.toString().includes("server listening")) {
        settled = true;
        clearTimeout(timeout);
        child.kill();
        resolve(true);
      }
    });
    child.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

main().catch((err) => {
  console.error("[update] Update failed:", err);
  process.exit(1);
});
