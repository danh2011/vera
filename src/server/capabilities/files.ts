import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { Capability, CapabilityResult } from "./types.js";
import { resolveWorkspacePath, workspaceRoot } from "../security/workspace.js";

function listDir(relativePath: string): string[] {
  const abs = resolveWorkspacePath(relativePath);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
}

export const filesCapability: Capability = {
  name: "files",
  description: "List, search, read, create, and modify text files inside Vera's sandboxed workspace.",
  actions: [
    {
      name: "files_list",
      description: "List files in a workspace directory (default: root).",
      permission: "read",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p } = input as { path: string };
        try {
          const items = listDir(p);
          return { ok: true, summary: `${items.length} item(s) in ${p}`, data: items };
        } catch (err) {
          return { ok: false, summary: "I can't access that path.", error: String(err) };
        }
      },
    },
    {
      name: "files_search",
      description: "Search filenames within the workspace for a substring.",
      permission: "read",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { query } = input as { query: string };
        const root = workspaceRoot();
        const matches: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(full);
            } else if (entry.name.toLowerCase().includes(query.toLowerCase())) {
              matches.push(path.relative(root, full));
            }
          }
        };
        walk(root);
        return { ok: true, summary: `${matches.length} match(es).`, data: matches };
      },
    },
    {
      name: "files_read",
      description: "Read a text file's contents.",
      permission: "read",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p } = input as { path: string };
        try {
          const abs = resolveWorkspacePath(p);
          if (!fs.existsSync(abs)) return { ok: false, summary: "File not found.", error: "not_found" };
          const content = fs.readFileSync(abs, "utf-8");
          return { ok: true, summary: `Read ${p} (${content.length} chars).`, data: content };
        } catch (err) {
          return { ok: false, summary: "I can't read that file.", error: String(err) };
        }
      },
    },
    {
      name: "files_create",
      description: "Create a new text file with given content.",
      permission: "write",
      inputSchema: z.object({ path: z.string().min(1), content: z.string().default("") }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p, content } = input as { path: string; content: string };
        try {
          const abs = resolveWorkspacePath(p);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, "utf-8");
          return { ok: true, summary: `Created ${p}.` };
        } catch (err) {
          return { ok: false, summary: "I can't create that file.", error: String(err) };
        }
      },
    },
    {
      name: "files_modify",
      description: "Overwrite an existing text file's contents.",
      permission: "write",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p, content } = input as { path: string; content: string };
        try {
          const abs = resolveWorkspacePath(p);
          if (!fs.existsSync(abs)) return { ok: false, summary: "File not found.", error: "not_found" };
          fs.writeFileSync(abs, content, "utf-8");
          return { ok: true, summary: `Updated ${p}.` };
        } catch (err) {
          return { ok: false, summary: "I can't modify that file.", error: String(err) };
        }
      },
    },
  ],
};
