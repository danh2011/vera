import type { z } from "zod";
import type { Logger } from "pino";
import type { AppConfig } from "../../config.js";
import type { Db } from "../../database/db.js";
import type { Repos } from "../../database/repos.js";
import type { SecretBox } from "../../security/crypto.js";
import type { PrivacyGateway } from "../../security/privacy.js";
import type { LogRing } from "../../logger.js";
import type { ConfigField, IntegrationManifest, Risk, TestCode } from "../../../../shared/types/index.js";

export interface AppDeps {
  config: AppConfig; db: Db; repos: Repos; secrets: SecretBox; privacy: PrivacyGateway; logger: Logger; logRing: LogRing;
  fts: boolean;
  /** Late-bound: set by the application after construction (adapters use them for cross-cutting tools). */
  integrations?: import("./service.js").IntegrationService;
  reminders?: { poke(): void; channelReady(): import("../../../../shared/types/index.js").ReminderChannel };
  http?: { fetch: typeof fetch };
}

/** What an integration module can see of its own configuration. Secrets are read lazily and never logged. */
export interface IntegrationContext {
  id: string;
  config: Record<string, string>;
  secret(key: string): string | null;
  setSecret(key: string, value: string): void;
  deps: AppDeps;
  signal?: AbortSignal;
}

export interface IntegrationHealth { ok: boolean; code: TestCode; message: string; details?: Record<string, string | number | boolean> }
export interface ConfigValidation { ok: boolean; errors: Record<string, string> }

export interface ToolContext {
  userId: string; requestId: string; conversationId?: string | null; signal: AbortSignal;
  source: "model" | "user" | "local";
  integration: IntegrationContext; deps: AppDeps;
}

export interface ToolDefinition<A = never> {
  name: string; title: string; description: string; risk: Risk;
  /** id of a permission declared in the owning manifest */
  permission: string;
  args: z.ZodType<A>;
  timeoutMs: number; maxResultBytes: number;
  readOnly: boolean;
  /** Whether the tool talks to a network service outside this process. */
  external?: boolean;
  /** Static: always confirm. Function: confirm depending on the validated arguments. */
  confirm?: boolean | ((a: A) => boolean);
  /** Config keys (beyond integration-level required fields) that this particular tool needs. */
  needsConfig?: string[];
  audit: "always" | "minimal";
  summarize?: (a: A) => string;
  handler: (args: A, ctx: ToolContext) => Promise<unknown>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any>;

export interface OAuthSpec {
  scopes(ctx: IntegrationContext): string[];
  buildAuthUrl(ctx: IntegrationContext, p: { redirectUri: string; state: string; challenge: string }): string;
  exchange(ctx: IntegrationContext, p: { code: string; redirectUri: string; verifier: string }): Promise<void>;
}

export interface IntegrationModule {
  readonly id: string; readonly name: string; readonly version: string; readonly description: string; readonly category: string;
  getManifest(): IntegrationManifest;
  getConfigSchema(): ConfigField[];
  getTools(): AnyTool[];
  validateConfig(config: Record<string, unknown>): Promise<ConfigValidation>;
  healthCheck(ctx: IntegrationContext): Promise<IntegrationHealth>;
  /** Static gating (e.g. machine access disabled by the operator). */
  platformAvailability?(deps: AppDeps): { available: boolean; reason?: string };
  /** At least one of these groups of config keys must be fully set (e.g. one of several optional services). */
  requireAny?: string[][];
  /** Extra, conditional "what is still missing" (e.g. fields that are only needed for one channel). */
  missingConfig?(cfg: Record<string, string>, secrets: Set<string>): string[];
  /** Live choices for a select field (needs the connected service). */
  dynamicOptions?(ctx: IntegrationContext, key: string): Promise<{ value: string; label: string }[]>;
  /** One-off buttons shown in the UI (e.g. "Send a test notification"). */
  actions?: Record<string, (ctx: IntegrationContext) => Promise<{ ok: boolean; message: string }>>;
  oauth?: OAuthSpec;
  initialize?(deps: AppDeps): Promise<void>;
  dispose?(): Promise<void>;
}

export const CATEGORIES: Record<string, string> = {
  productivity: "Productivity", memory: "Memory and notes", files: "Files and documents", web: "Web and research",
  home_automation: "Home automation", home_server: "Home server", calendar_email: "Calendar and email", media: "Media",
  notifications: "Notifications", operations: "Operations", utilities: "Utilities",
};
