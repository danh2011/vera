import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { Capability, CapabilityResult } from "./types.js";
import { resolveWorkspacePath } from "../security/workspace.js";

/**
 * Code assistant works entirely within the Vera workspace and reuses the
 * same sandboxed file access as the Files capability. It never executes
 * generated or read code - "explain" and "analyse" are handed back to
 * Gemini as plain text for reasoning, not run.
 */
export const codeAssistantCapability: Capability = {
  name: "code_assistant",
  description: "Reads, creates, and modifies code files in the workspace, and surfaces code/errors for explanation. Never executes code.",
  actions: [
    {
      name: "code_read",
      description: "Read a code file's contents for review or explanation.",
      permission: "read",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p } = input as { path: string };
        try {
          const abs = resolveWorkspacePath(p);
          if (!fs.existsSync(abs)) return { ok: false, summary: "File not found.", error: "not_found" };
          const content = fs.readFileSync(abs, "utf-8");
          return { ok: true, summary: `Read ${p}.`, data: content };
        } catch (err) {
          return { ok: false, summary: "I can't read that file.", error: String(err) };
        }
      },
    },
    {
      name: "code_create",
      description: "Create a new code file with the given content.",
      permission: "write",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p, content } = input as { path: string; content: string };
        try {
          const abs = resolveWorkspacePath(p);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, "utf-8");
          return { ok: true, summary: `Created ${p}. (Not executed - review before running.)` };
        } catch (err) {
          return { ok: false, summary: "I can't create that file.", error: String(err) };
        }
      },
    },
    {
      name: "code_modify",
      description: "Modify an existing code file's contents.",
      permission: "write",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { path: p, content } = input as { path: string; content: string };
        try {
          const abs = resolveWorkspacePath(p);
          if (!fs.existsSync(abs)) return { ok: false, summary: "File not found.", error: "not_found" };
          fs.writeFileSync(abs, content, "utf-8");
          return { ok: true, summary: `Updated ${p}. (Not executed - review before running.)` };
        } catch (err) {
          return { ok: false, summary: "I can't modify that file.", error: String(err) };
        }
      },
    },
  ],
};
