import fs from "node:fs/promises";
import path from "node:path";

export class PathError extends Error { constructor(public code: "OUTSIDE_ROOT" | "NOT_FOUND" | "INVALID", message: string) { super(message); } }

/** Resolves a user/model-supplied path to a real path guaranteed to be inside an approved root (symlink-safe). */
export async function resolveWithinRoots(roots: string[], requested: string): Promise<{ real: string; root: string }> {
  if (!roots.length) throw new PathError("OUTSIDE_ROOT", "No file roots are configured.");
  if (requested.includes("\0") || requested.length > 4096) throw new PathError("INVALID", "Invalid path.");
  const abs = path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(roots[0]!, requested);
  const realRoots: string[] = [];
  for (const r of roots) { try { realRoots.push(await fs.realpath(r)); } catch { /* missing root ignored */ } }
  let real: string;
  try { real = await fs.realpath(abs); } catch { // Not existing: still reject traversal lexically
    if (!realRoots.some((r) => abs === r || abs.startsWith(r + path.sep))) throw new PathError("OUTSIDE_ROOT", "Path is outside the approved folders.");
    throw new PathError("NOT_FOUND", "File not found.");
  }
  const root = realRoots.find((r) => real === r || real.startsWith(r + path.sep));
  if (!root) throw new PathError("OUTSIDE_ROOT", "Path is outside the approved folders.");
  return { real, root };
}
