import { z } from "zod";

export type PermissionLevel = "read" | "write" | "system";

export interface CapabilityAction {
  /** Name used by the AI's function-calling interface, e.g. "memory_remember". */
  name: string;
  description: string;
  /** Zod schema describing the expected input shape. */
  inputSchema: z.ZodTypeAny;
  permission: PermissionLevel;
  /** Executes the action. Must never throw raw exceptions past this boundary. */
  execute: (input: unknown) => Promise<CapabilityResult>;
}

export interface CapabilityResult {
  ok: boolean;
  /** Short, human-readable summary safe to show the user directly. */
  summary: string;
  /** Structured data for the UI to render as a card (optional). */
  data?: unknown;
  error?: string;
}

export interface Capability {
  name: string;
  description: string;
  actions: CapabilityAction[];
}

export const capabilityRegistry: Map<string, Capability> = new Map();

export function registerCapability(capability: Capability) {
  capabilityRegistry.set(capability.name, capability);
}

export function allActions(): { capability: string; action: CapabilityAction }[] {
  const out: { capability: string; action: CapabilityAction }[] = [];
  for (const cap of capabilityRegistry.values()) {
    for (const action of cap.actions) {
      out.push({ capability: cap.name, action });
    }
  }
  return out;
}

export function findAction(actionName: string): { capability: Capability; action: CapabilityAction } | null {
  for (const cap of capabilityRegistry.values()) {
    const action = cap.actions.find((a) => a.name === actionName);
    if (action) return { capability: cap, action };
  }
  return null;
}
