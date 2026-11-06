import type { ConfigField, IntegrationManifest, PermissionInfo, SetupStep } from "../../../../shared/types/index.js";
import type { AnyTool, AppDeps, ConfigValidation, IntegrationContext, IntegrationHealth, IntegrationModule, OAuthSpec, ToolDefinition } from "./types.js";

export function defineTool<A>(t: ToolDefinition<A>): AnyTool { return t as unknown as AnyTool; }

type ManifestInput = Partial<Omit<IntegrationManifest, "setup" | "uninstall" | "installationType">> &
  Pick<IntegrationManifest, "id" | "name" | "version" | "category" | "description"> & {
    setup?: Partial<IntegrationManifest["setup"]>; uninstall?: Partial<IntegrationManifest["uninstall"]>;
  };

export interface ModuleSpec {
  manifest: ManifestInput; config?: ConfigField[]; tools: AnyTool[];
  validate?: (cfg: Record<string, unknown>) => Promise<ConfigValidation> | ConfigValidation;
  health?: (ctx: IntegrationContext) => Promise<IntegrationHealth>;
  platform?: (deps: AppDeps) => { available: boolean; reason?: string };
  requireAny?: string[][]; oauth?: OAuthSpec;
  missingConfig?: IntegrationModule["missingConfig"]; dynamicOptions?: IntegrationModule["dynamicOptions"]; actions?: IntegrationModule["actions"];
}

/** Builds a complete module from a compact spec. Manifest defaults are deliberately conservative. */
export function makeModule(spec: ModuleSpec): IntegrationModule {
  const m = spec.manifest; const config = spec.config ?? [];
  const steps: SetupStep[] = m.setup?.steps ?? [
    ...(config.length ? [{ id: "settings", title: "Connection details", body: "Enter the details below. Secrets are encrypted on the server and never shown again.", kind: "form" as const, fields: config.map((f) => f.key) }] : []),
    ...(m.authMode === "oauth" ? [{ id: "authorise", title: "Sign in", body: "Authorise Vera with the provider. You can revoke access at any time from your provider account.", kind: "oauth" as const }] : []),
    ...(spec.health ? [{ id: "test", title: "Test the connection", body: "Vera will make a real request to check that everything works.", kind: "test" as const }] : []),
  ];
  const manifest: IntegrationManifest = {
    icon: "puzzle", capabilities: [], defaultInstalled: false, required: false, runsLocally: true, contactsExternalServices: false, externalServices: [],
    sendsDataToThirdParty: "No. Everything stays on this server.", requiresCredentials: false, authMode: "none", dataAccess: [], permissions: [], healthCheck: !!spec.health,
    ...m, installationType: "builtin",
    setup: { intro: m.description, requirements: [], troubleshooting: [], ...m.setup, steps },
    uninstall: { removes: ["This integration's saved settings and credentials"], keeps: ["Anything you created (tasks, notes, memories, chats)"], ...m.uninstall },
  };
  return {
    id: m.id, name: m.name, version: m.version, description: m.description, category: m.category,
    getManifest: () => manifest, getConfigSchema: () => config, getTools: () => spec.tools,
    validateConfig: async (cfg) => (spec.validate ? spec.validate(cfg) : { ok: true, errors: {} }),
    healthCheck: async (ctx) => (spec.health ? spec.health(ctx) : { ok: false, code: "not_supported", message: "This integration has no connection to test." }),
    ...(spec.platform ? { platformAvailability: spec.platform } : {}), ...(spec.requireAny ? { requireAny: spec.requireAny } : {}), ...(spec.oauth ? { oauth: spec.oauth } : {}), ...(spec.missingConfig ? { missingConfig: spec.missingConfig } : {}), ...(spec.dynamicOptions ? { dynamicOptions: spec.dynamicOptions } : {}), ...(spec.actions ? { actions: spec.actions } : {}),
  };
}

export const perm = (id: string, label: string, reason: string, access: PermissionInfo["access"], dataAccessed: string, defaultGranted = true): PermissionInfo => ({ id, label, reason, access, dataAccessed, defaultGranted });
