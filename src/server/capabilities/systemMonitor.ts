import { z } from "zod";
import si from "systeminformation";
import os from "node:os";
import { Capability, CapabilityResult } from "./types.js";

export const systemMonitorCapability: Capability = {
  name: "system_monitor",
  description: "Reports basic server information: CPU, RAM, disk, uptime, hostname.",
  actions: [
    {
      name: "system_monitor_status",
      description: "Get current CPU, RAM, disk usage, uptime, and hostname.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        try {
          const [cpu, mem, disks] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
          const primaryDisk = disks[0];
          const data = {
            hostname: os.hostname(),
            uptimeSeconds: Math.floor(os.uptime()),
            cpuLoadPercent: Math.round(cpu.currentLoad),
            ramUsedPercent: Math.round((mem.active / mem.total) * 100),
            ramTotalGb: Number((mem.total / 1024 ** 3).toFixed(1)),
            diskUsedPercent: primaryDisk ? Math.round(primaryDisk.use) : null,
          };
          return {
            ok: true,
            summary: `CPU ${data.cpuLoadPercent}% · RAM ${data.ramUsedPercent}% · Disk ${data.diskUsedPercent ?? "?"}%`,
            data,
          };
        } catch (err) {
          return { ok: false, summary: "I couldn't read system stats.", error: String(err) };
        }
      },
    },
  ],
};
