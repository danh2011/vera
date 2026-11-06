import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PathError, resolveWithinRoots } from "../../security/paths.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { AppDeps } from "../core/types.js";

const MAX_READ = 1_000_000;
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".yml", ".yaml", ".toml", ".ini", ".conf", ".cfg", ".xml", ".html", ".htm", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".css", ".sql", ".rst", ".tex", ".env.example"]);
const BLOCKED_NAMES = /(^\.env$|^\.env\..*(?<!\.example)$|id_(rsa|dsa|ecdsa|ed25519)|\.pem$|\.key$|\.p12$|\.pfx$|\.kdbx$|\.htpasswd$|^secret\.key$|\.sqlite3?$|\.db$|credentials?\.json$|shadow$)/i;
const MIME: Record<string, string> = { ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json", ".csv": "text/csv", ".html": "text/html", ".xml": "application/xml", ".yml": "application/yaml", ".yaml": "application/yaml", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const roots = (d: AppDeps) => d.config.files.roots;
const common = { risk: "low" as const, audit: "minimal" as const, timeoutMs: 10_000 };

async function resolve(d: AppDeps, p: string) {
  try { return await resolveWithinRoots(roots(d), p); }
  catch (e) { if (e instanceof PathError) throw new ToolError(e.code === "NOT_FOUND" ? "NOT_FOUND" : "PATH_NOT_ALLOWED", e.message); throw e; }
}
function checkReadable(real: string) {
  const name = path.basename(real); const ext = path.extname(real).toLowerCase();
  if (BLOCKED_NAMES.test(name)) throw new ToolError("FILE_BLOCKED", "Vera never reads key, credential, database or environment files.");
  if (!TEXT_EXT.has(ext) && ext !== "") throw new ToolError("UNSUPPORTED_TYPE", `Files of type "${ext}" can't be read as text.`);
}
async function readText(d: AppDeps, p: string, maxChars: number) {
  const { real } = await resolve(d, p); checkReadable(real);
  const st = await fs.stat(real); if (!st.isFile()) throw new ToolError("NOT_A_FILE", "That path is not a file.");
  if (st.size > MAX_READ) throw new ToolError("TOO_LARGE", `That file is larger than ${MAX_READ / 1000} KB.`);
  const buf = await fs.readFile(real); if (buf.includes(0)) throw new ToolError("BINARY_FILE", "That looks like a binary file.");
  const text = buf.toString("utf8"); return { real, st, text: text.length > maxChars ? text.slice(0, maxChars) : text, truncated: text.length > maxChars, total: text.length };
}
function summarise(text: string, n: number): string[] {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter((s) => s.length > 30 && s.length < 400) ?? [];
  if (sentences.length <= n) return sentences;
  const freq = new Map<string, number>(); for (const w of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = sentences.map((s, i) => ({ s, i, score: (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt(s.length) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}

export default makeModule({
  manifest: {
    id: "files", name: "Files and documents", version: "1.0.0", category: "files", icon: "folder", requiresCredentials: false, contactsExternalServices: false,
    description: "Let Vera list, search and read text files inside folders you approve on the server. Everything stays local; nothing outside the approved folders is reachable.",
    capabilities: ["List approved folders", "Search file names and contents", "Read text files", "Summarise documents locally", "Show file metadata"],
    dataAccess: ["Files inside the folders listed in VERA_ALLOWED_FILE_ROOTS (text files up to 1 MB)", "Key, credential, database and .env files are always refused"],
    permissions: [perm("read", "Read approved files", "To list, search and read documents you ask about.", "read", "Text files inside approved folders")],
    setup: {
      intro: "Choose which folders on the server Vera may read. This is a server setting so a chat message can never widen it.",
      requirements: ["Access to the server's environment settings (the .env file or docker-compose.yml)"],
      steps: [{ id: "roots", title: "Approve folders", kind: "info", body: "Set VERA_ALLOWED_FILE_ROOTS to a comma-separated list of folders, for example /srv/documents,/srv/notes. In Docker, mount those folders into the container read-only (:ro) and use the container paths. Restart Vera, then come back here." }],
      troubleshooting: [{ problem: "This integration says it is unavailable", fix: "VERA_ALLOWED_FILE_ROOTS is empty or the folders don't exist inside the container. Check the volume mounts." }, { problem: "A file is refused", fix: "Vera only reads text-like files up to 1 MB and never reads keys, credentials, databases or .env files." }],
    },
    uninstall: { removes: ["Assistant access to files"], keeps: ["Your files are never modified or deleted by Vera"] },
  },
  platform: (d) => (roots(d).length ? { available: true } : { available: false, reason: "No folders are approved. Set VERA_ALLOWED_FILE_ROOTS on the server to enable file access." }),
  tools: [
    defineTool({ ...common, name: "list_allowed_files", title: "List files", description: "List files and folders inside the approved folders. With no path, lists the approved roots.", permission: "read", readOnly: true, maxResultBytes: 30_000,
      args: z.object({ path: z.string().max(1000).optional(), limit: z.number().int().min(1).max(200).default(100) }),
      handler: async (a, c) => {
        if (!a.path) return { roots: roots(c.deps).map((r) => path.basename(r) || r), rootPaths: roots(c.deps) };
        const { real } = await resolve(c.deps, a.path); const st = await fs.stat(real); if (!st.isDirectory()) throw new ToolError("NOT_A_DIRECTORY", "That path is not a folder.");
        const entries = await fs.readdir(real, { withFileTypes: true }); const out = [];
        for (const e of entries.slice(0, 1000)) { if (e.name.startsWith(".") || BLOCKED_NAMES.test(e.name)) continue; try { const s = await fs.stat(path.join(real, e.name)); out.push({ name: e.name, type: s.isDirectory() ? "folder" : "file", size: s.isFile() ? s.size : undefined, modified: s.mtime.toISOString() }); } catch { /* unreadable entry skipped */ } if (out.length >= a.limit) break; }
        return { path: real, entries: out };
      } }),
    defineTool({ ...common, name: "search_files", title: "Search files", description: "Search file names (and optionally text contents) inside the approved folders.", permission: "read", readOnly: true, maxResultBytes: 30_000, timeoutMs: 15_000,
      args: z.object({ query: z.string().trim().min(1).max(100), path: z.string().max(1000).optional(), search_contents: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) }),
      handler: async (a, c) => {
        const start = a.path ? (await resolve(c.deps, a.path)).real : null; const bases = start ? [start] : roots(c.deps);
        const q = a.query.toLowerCase(); const hits: { path: string; match: string; snippet?: string }[] = []; let scanned = 0;
        const walk = async (dir: string, depth: number) => {
          if (depth > 6 || scanned > 5000 || hits.length >= a.limit || c.signal.aborted) return;
          let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (e.name.startsWith(".") || BLOCKED_NAMES.test(e.name) || e.isSymbolicLink()) continue; scanned++;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await walk(full, depth + 1);
            else if (e.isFile()) {
              if (e.name.toLowerCase().includes(q)) hits.push({ path: full, match: "name" });
              else if (a.search_contents && TEXT_EXT.has(path.extname(e.name).toLowerCase())) { try { const st = await fs.stat(full); if (st.size <= 200_000) { const t = await fs.readFile(full, "utf8"); const i = t.toLowerCase().indexOf(q); if (i >= 0) hits.push({ path: full, match: "content", snippet: t.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, " ") }); } } catch { /* skip */ } }
            }
            if (hits.length >= a.limit) return;
          }
        };
        for (const b of bases) { try { await resolve(c.deps, b); } catch { continue; } await walk(b, 0); }
        return { query: a.query, results: hits, scanned, note: scanned > 5000 ? "Search stopped early after scanning 5000 entries." : undefined };
      } }),
    defineTool({ ...common, name: "read_allowed_file", title: "Read file", description: "Read a text file inside the approved folders (up to 1 MB; text is cut to max_chars).", permission: "read", readOnly: true, maxResultBytes: 60_000,
      args: z.object({ path: z.string().min(1).max(1000), max_chars: z.number().int().min(100).max(40_000).default(12_000) }),
      handler: async (a, c) => { const r = await readText(c.deps, a.path, a.max_chars); return { path: r.real, content: r.text, truncated: r.truncated, totalChars: r.total }; } }),
    defineTool({ ...common, name: "summarise_document", title: "Summarise document", description: "Produce a local, extractive summary (the most informative sentences) of a text document. No AI model is used by this tool.", permission: "read", readOnly: true, maxResultBytes: 12_000,
      args: z.object({ path: z.string().min(1).max(1000), sentences: z.number().int().min(1).max(10).default(5) }),
      handler: async (a, c) => { const r = await readText(c.deps, a.path, 200_000); const headings = r.text.split("\n").filter((l) => /^#{1,3}\s/.test(l)).slice(0, 15).map((l) => l.replace(/^#+\s*/, "")); return { path: r.real, method: "extractive", headings, summary: summarise(r.text, a.sentences), words: (r.text.match(/\S+/g) ?? []).length }; } }),
    defineTool({ ...common, name: "get_document_metadata", title: "Get file details", description: "Get size, type, modified date and line/word counts for a file in the approved folders.", permission: "read", readOnly: true, maxResultBytes: 3000,
      args: z.object({ path: z.string().min(1).max(1000) }),
      handler: async (a, c) => {
        const { real } = await resolve(c.deps, a.path); const st = await fs.stat(real); const ext = path.extname(real).toLowerCase();
        const out: Record<string, unknown> = { path: real, name: path.basename(real), type: st.isDirectory() ? "folder" : "file", extension: ext, mime: MIME[ext] ?? "application/octet-stream", size: st.size, modified: st.mtime.toISOString(), created: st.birthtime.toISOString() };
        if (st.isFile() && TEXT_EXT.has(ext) && st.size <= MAX_READ && !BLOCKED_NAMES.test(path.basename(real))) { const t = await fs.readFile(real, "utf8"); out.lines = t.split("\n").length; out.words = (t.match(/\S+/g) ?? []).length; }
        return out;
      } }),
  ],
});
