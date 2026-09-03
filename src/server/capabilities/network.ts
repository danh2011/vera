import { z } from "zod";
import os from "node:os";
import { Capability, CapabilityResult } from "./types.js";

function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://1.1.1.1", { signal: controller.signal, method: "HEAD" });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export const networkCapability: Capability = {
  name: "network",
  description: "Basic network information: local IP, hostname, connectivity, configured service checks.",
  actions: [
    {
      name: "network_info",
      description: "Get local IP address and hostname.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        const data = { localIp: getLocalIp(), hostname: os.hostname() };
        return { ok: true, summary: `${data.hostname} @ ${data.localIp ?? "unknown"}`, data };
      },
    },
    {
      name: "network_connectivity_check",
      description: "Check whether the server has outbound internet connectivity.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        const online = await checkConnectivity();
        return { ok: true, summary: online ? "Online." : "No internet connectivity detected.", data: { online } };
      },
    },
    {
      name: "network_check_service",
      description: "Check if a given host:port is reachable.",
      permission: "read",
      inputSchema: z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { host, port } = input as { host: string; port: number };
        const net = await import("node:net");
        const reachable = await new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(2000);
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
          });
          socket.once("error", () => resolve(false));
          socket.connect(port, host);
        });
        return {
          ok: true,
          summary: `${host}:${port} is ${reachable ? "reachable" : "unreachable"}.`,
          data: { reachable },
        };
      },
    },
  ],
};
