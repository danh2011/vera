import path from "node:path";
import fs from "node:fs";
import { env } from "../env.js";

if (!fs.existsSync(env.WORKSPACE_PATH)) {
  fs.mkdirSync(env.WORKSPACE_PATH, { recursive: true });
}

/**
 * Resolves a user/AI-supplied relative path against the Vera workspace and
 * guarantees the result stays inside it. Throws on any attempt to escape
 * (e.g. "../../etc/passwd", absolute paths, symlink tricks are out of scope
 * for V0.1 but traversal via ".." is fully blocked).
 */
export function resolveWorkspacePath(relativePath: string): string {
  const cleaned = relativePath.replace(/^[/\\]+/, "");
  const resolved = path.resolve(env.WORKSPACE_PATH, cleaned);
  const root = path.resolve(env.WORKSPACE_PATH);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes the Vera workspace and was blocked.");
  }
  return resolved;
}

export function workspaceRoot(): string {
  return env.WORKSPACE_PATH;
}
