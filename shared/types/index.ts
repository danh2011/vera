/** Types shared by the backend and the React frontend. Type-only: this file must not contain runtime code. */

export type Risk = "low" | "medium" | "high";
export type ConfigFieldType = "string" | "url" | "secret" | "number" | "boolean" | "select" | "list";

export interface ConfigField {
  key: string; label: string; type: ConfigFieldType; required?: boolean;
  help?: string; placeholder?: string; options?: { value: string; label: string }[];
  min?: number; max?: number; maxLength?: number; default?: string | number | boolean;
  /** Options are fetched live from the connected service (GET …/options/:key). */
  dynamicOptions?: boolean;
}
export interface SetupStep { id: string; title: string; body: string; kind: "info" | "form" | "oauth" | "test"; fields?: string[] }
export interface PermissionInfo { id: string; label: string; reason: string; access: "read" | "write" | "control" | "network"; dataAccessed: string; defaultGranted: boolean }

export interface IntegrationManifest {
  id: string; name: string; version: string; category: string; description: string; icon: string; capabilities: string[];
  installationType: "builtin"; defaultInstalled: boolean; required: boolean;
  /** Other integrations that must be installed, set up AND connected (tested) first. */
  requires?: { id: string; reason: string }[];
  actions?: { id: string; label: string; help: string }[];
  runsLocally: boolean; contactsExternalServices: boolean; externalServices: string[]; sendsDataToThirdParty: string;
  requiresCredentials: boolean; authMode: "none" | "token" | "oauth";
  dataAccess: string[]; permissions: PermissionInfo[]; setup: { intro: string; requirements: string[]; steps: SetupStep[]; troubleshooting: { problem: string; fix: string }[] };
  uninstall: { removes: string[]; keeps: string[] };
  healthCheck: boolean; compatibility?: string;
}

export type IntegrationStatus = "available" | "installed" | "needs_dependency" | "needs_setup" | "needs_authorisation" | "disabled" | "ready" | "connected" | "degraded" | "error" | "unavailable";
export type ConnectionState = "not_applicable" | "untested" | "connected" | "failed";
export type TestCode = "ok" | "auth_failed" | "missing_config" | "unreachable" | "insufficient_permission" | "rate_limited" | "timeout" | "not_supported" | "error";
export type ToolAvailability = "available" | "needs_dependency" | "needs_install" | "needs_enable" | "needs_configuration" | "needs_authorisation" | "permission_denied" | "unavailable";

export interface ToolInfo {
  name: string; title: string; description: string; risk: Risk; permission: string; requiresConfirmation: boolean; readOnly: boolean;
  availability: ToolAvailability; availabilityReason?: string; integrationId: string;
}
export interface DependencyInfo { id: string; name: string; reason: string; satisfied: boolean; state: IntegrationStatus | "available"; problem: string; action: "install" | "configure" | "connect" | "test" | "enable" | "none" }
export interface IntegrationSummary {
  dependencies: DependencyInfo[];
  id: string; name: string; version: string; category: string; description: string; icon: string; capabilities: string[];
  runsLocally: boolean; contactsExternalServices: boolean; requiresCredentials: boolean; authMode: "none" | "token" | "oauth"; required: boolean;
  installed: boolean; enabled: boolean; configured: boolean; authorised: boolean; connection: ConnectionState;
  status: IntegrationStatus; statusLabel: string; statusDetail?: string; attention: boolean;
  nextAction: "install" | "configure" | "connect" | "enable" | "open" | "none";
  toolCount: number; toolsAvailable: number; lastTestAt: string | null; lastSuccessAt: string | null;
}
export interface IntegrationDetail extends IntegrationSummary {
  /** Installed integrations that rely on this one (they stop working if it is removed). */
  dependents: { id: string; name: string }[];
  manifest: IntegrationManifest; configSchema: ConfigField[];
  config: Record<string, string | number | boolean | string[]>; secretsSaved: Record<string, boolean>; missing: string[];
  permissions: (PermissionInfo & { granted: boolean })[]; tools: ToolInfo[]; setupStep: number;
  oauthRedirectUri?: string;
  lastTest: { at: string; code: TestCode; message: string } | null;
  recentActivity: { tool: string; outcome: string; policy: string | null; durationMs: number | null; at: string }[];
}
export interface TestResult { ok: boolean; code: TestCode; message: string; testedAt: string; details?: Record<string, string | number | boolean> }
export interface ConfigureResult { saved: string[]; missing: string[]; errors: Record<string, string>; configured: boolean }
export interface IntegrationsCatalogue { integrations: IntegrationSummary[]; categories: { id: string; label: string; count: number }[]; counts: { total: number; installed: number; enabled: number; needsAttention: number } }

export interface PendingConfirmation { id: string; token: string; tool: string; summary: string; expiresAt: string; state: "pending" | "approved" | "cancelled" | "expired" }
export interface PolicyNotice { blocked: boolean; classification: string; categories: string[]; reason: string; redactedSuggestion?: string }
/** One real unit of work Vera did while answering. Contains labels, tool names and timings only: never content, arguments or secrets. */
export interface ChatStep { id: string; label: string; detail?: string; state: "running" | "done" | "error"; ms?: number }
export type StreamEvent =
  | { type: "step"; step: ChatStep }
  | { type: "message"; message: unknown }
  | { type: "error"; code: string; message: string };

export interface AiStatus {
  provider: "gemini"; enabled: boolean; keyConfigured: boolean; modelConfigured: boolean; model: string | null; ready: boolean;
  reason: string | null; circuit: "closed" | "open";
  limits: { perMinute: number; perDay: number; toolRounds: number; inputChars: number; outputTokens: number; timeoutMs: number };
  usage: { today: { requests: number; failures: number; inputTokens: number; outputTokens: number }; thisMinute: number; history: { day: string; requests: number; failures: number; inputTokens: number; outputTokens: number }[] };
}
export interface SessionInfo { authenticated: boolean; username?: string; csrfToken?: string; expiresAt?: string }
export interface SetupStatus { ownerExists: boolean; setupTokenRequired: boolean }
export interface ApiErrorBody { error: { code: string; message: string; id?: string; fields?: Record<string, string> } }

export interface ServerSettings {
  version: string; environment: string;
  security: { authRequired: boolean; secureCookies: boolean; trustedProxy: boolean; csrfProtection: boolean };
  ai: AiStatus; aiAcknowledged: boolean;
  privacy: { enabled: boolean; blockedByDefault: string[]; last24h: { total: number; blocked: number }; recent: { source: string; classification: string; blocked: boolean; categories: string[]; at: string }[]; disclaimer: string };
  machine: { readonly: boolean }; files: { rootCount: number }; storage: { fts5: boolean };
}
export interface SessionRowInfo { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; userAgent: string | null; current: boolean }
export interface AuditEvent { id: string; action: string; subject: string | null; outcome: string; metadata: Record<string, unknown> | null; createdAt: string }

export interface ReminderDto { id: string; title: string; remindAt: string; status: "scheduled" | "sent" | "failed" | "missed" | "cancelled"; delivery: string; deliveryDetail: string | null; deliveredAt: string | null; attempts: number; taskId: string | null }
export interface ReminderChannel { ready: boolean; status: string; statusLabel: string; detail: string; installed: boolean; integrationId: string }
export interface ActionResult { ok: boolean; message: string }
