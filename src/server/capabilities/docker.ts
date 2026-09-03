import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Capability, CapabilityResult } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Explicit whitelist of container names Vera is allowed to restart.
 * Empty by default - operators must opt in per-container. This is the
 * ONLY write-ish action in this capability; everything else is read-only,
 * and there is no arbitrary shell execution anywhere in this module.
 */
const RESTART_WHITELIST: string[] = [];

export const dockerCapability: Capability = {
  name: "docker",
  description: "Very limited, mostly read-only Docker/process visibility.",
  actions: [
    {
      name: "docker_list_containers",
      description: "List configured Docker containers and their status.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        try {
          const { stdout } = await execFileAsync("docker", [
            "ps",
            "-a",
            "--format",
            "{{.Names}}\t{{.Status}}\t{{.Image}}",
          ]);
          const containers = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [name, status, image] = line.split("\t");
              return { name, status, image };
            });
          return { ok: true, summary: `${containers.length} container(s).`, data: containers };
        } catch (err) {
          return {
            ok: false,
            summary: "I couldn't reach Docker (it may not be installed or accessible here).",
            error: String(err),
          };
        }
      },
    },
    {
      name: "docker_inspect_status",
      description: "Inspect a single container's status by name.",
      permission: "read",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { name } = input as { name: string };
        try {
          const { stdout } = await execFileAsync("docker", ["inspect", "--format", "{{.State.Status}}", name]);
          return { ok: true, summary: `${name}: ${stdout.trim()}`, data: { name, status: stdout.trim() } };
        } catch (err) {
          return { ok: false, summary: `I couldn't find a container named "${name}".`, error: String(err) };
        }
      },
    },
    {
      name: "docker_restart_whitelisted",
      description: "Restart a container, but ONLY if it is on the explicit server-side whitelist.",
      permission: "system",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { name } = input as { name: string };
        if (!RESTART_WHITELIST.includes(name)) {
          return {
            ok: false,
            summary: `"${name}" isn't on the restart whitelist. Nothing was done.`,
            error: "not_whitelisted",
          };
        }
        try {
          await execFileAsync("docker", ["restart", name]);
          return { ok: true, summary: `Restarted "${name}".` };
        } catch (err) {
          return { ok: false, summary: `Failed to restart "${name}".`, error: String(err) };
        }
      },
    },
  ],
};
