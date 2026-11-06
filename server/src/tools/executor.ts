import crypto from "node:crypto";
import { z } from "zod";
import type { AppDeps } from "../integrations/core/types.js";
import type { PendingConfirmation } from "../../../shared/types/index.js";
import { randomToken, safeEqual, sha256 } from "../security/crypto.js";

export type ToolOutcome =
  | { status: "ok"; result: unknown; durationMs: number; withheld: number; truncated: boolean }
  | { status: "confirmation_required"; confirmation: PendingConfirmation }
  | { status: "blocked"; code: string; message: string }
  | { status: "error"; code: string; message: string };

export interface ExecRequest {
  tool: string; args: unknown; userId: string; requestId: string; conversationId?: string | null;
  source: "model" | "user" | "local"; signal?: AbortSignal; confirmation?: { id: string; token: string };
}

const CONFIRM_TTL_MS = 5 * 60_000;
const MAX_CONCURRENT = 4; const MAX_QUEUE = 8;

/** Canonical JSON (sorted keys) so the confirmation hash is stable. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const argsHash = (userId: string, tool: string, args: unknown) => crypto.createHash("sha256").update(`${userId}\n${tool}\n${canonical(args)}`).digest("hex");

class Semaphore {
  private active = 0; private queue: (() => void)[] = [];
  async acquire(): Promise<boolean> {
    if (this.active < MAX_CONCURRENT) { this.active++; return true; }
    if (this.queue.length >= MAX_QUEUE) return false;
    await new Promise<void>((r) => this.queue.push(r)); return true;
  }
  release() { const n = this.queue.shift(); if (n) n(); else this.active--; }
}

export class ToolExecutor {
  private sem = new Semaphore();
  constructor(private deps: AppDeps) {}
  private get svc() { return this.deps.integrations!; }

  /** The single gate every tool call passes through. The model never decides whether a tool runs. */
  async execute(req: ExecRequest): Promise<ToolOutcome> {
    const started = Date.now(); const { repos, privacy } = this.deps;
    const found = this.svc.findTool(req.tool);
    const audit = (outcome: string, policy: string, integrationId?: string) => repos.audit.addToolExecution({ userId: req.userId, tool: found ? req.tool : "(unknown)", integrationId: integrationId ?? found?.module.id, outcome, policy, durationMs: Date.now() - started, correlationId: req.requestId });
    if (!found) { audit("rejected", "unknown_tool"); return { status: "error", code: "UNKNOWN_TOOL", message: "That tool does not exist." }; }
    const { tool, module } = found;

    // 2-3: installation, enablement, configuration, permissions
    const av = this.svc.toolAvailability(module, tool);
    if (av.availability !== "available") { audit("rejected", av.availability); return { status: "error", code: av.availability.toUpperCase(), message: av.reason ?? "This tool is not available." }; }

    // 4: argument validation. Issues never echo values.
    let args: unknown;
    if (req.confirmation) {
      const c = repos.confirmations.get(req.confirmation.id);
      if (!c) { audit("rejected", "confirmation_missing"); return { status: "error", code: "CONFIRMATION_INVALID", message: "Confirmation not found." }; }
      args = req.args !== undefined ? req.args : c.args; // a changed argument set fails the hash check below
    } else args = req.args;
    const parsed = (tool.args as z.ZodType).safeParse(args);
    if (!parsed.success) { audit("rejected", "invalid_arguments"); return { status: "error", code: "INVALID_ARGUMENTS", message: "Invalid arguments: " + parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") }; }
    const a = parsed.data as never;

    // 5: privacy policy on arguments (financial/credential/sensitive never reach cloud-bound or model-originated writes)
    const argText = canonical(a);
    const cls = privacy.classify(argText);
    const sensitive = ["FINANCIAL", "CREDENTIAL", "SENSITIVE_PERSONAL"].includes(cls.cls);
    if (sensitive && (tool.external || req.source === "model")) {
      repos.audit.add({ userId: req.userId, action: "tool.blocked", subject: tool.name, outcome: "privacy", metadata: { classification: cls.cls, categories: cls.categories }, requestId: req.requestId });
      audit("blocked", "privacy_" + cls.cls.toLowerCase());
      return { status: "blocked", code: "PRIVACY_BLOCKED", message: "Vera blocked this action because its details look like banking, credential or sensitive personal data." };
    }

    // 7: confirmation workflow
    const needs = typeof tool.confirm === "function" ? tool.confirm(a) : !!tool.confirm;
    if (needs) {
      if (!req.confirmation) {
        const token = randomToken(24); const summary = tool.summarize ? tool.summarize(a) : `${tool.title}`;
        const c = repos.confirmations.create({ token, userId: req.userId, conversationId: req.conversationId, tool: tool.name, args: parsed.data, argsHash: argsHash(req.userId, tool.name, parsed.data), summary: privacy.redact(summary, privacy.classify(summary).findings), ttlMs: CONFIRM_TTL_MS });
        audit("confirmation_requested", "confirm_required");
        return { status: "confirmation_required", confirmation: { id: c.id, token, tool: tool.name, summary: c.summary, expiresAt: c.expiresAt, state: "pending" } };
      }
      const c = repos.confirmations.get(req.confirmation.id)!;
      const fail = (code: string, message: string) => { audit("rejected", code); return { status: "error", code: "CONFIRMATION_INVALID", message } as ToolOutcome; };
      if (c.userId !== req.userId) return fail("confirmation_user", "This confirmation belongs to someone else.");
      if (c.tool !== tool.name) return fail("confirmation_tool", "This confirmation is for a different action.");
      if (!safeEqual(c.token, req.confirmation.token)) return fail("confirmation_token", "Invalid confirmation token.");
      if (c.consumedAt) return fail("confirmation_reused", "This confirmation was already used.");
      if (new Date(c.expiresAt).getTime() < Date.now()) return fail("confirmation_expired", "This confirmation expired. Ask again.");
      if (c.argsHash !== argsHash(req.userId, tool.name, parsed.data)) return fail("confirmation_args", "The action changed after it was approved.");
      if (!repos.confirmations.consume(c.id, "approved")) return fail("confirmation_reused", "This confirmation was already used.");
    }

    // 8-9: concurrency, timeout, execution
    if (!(await this.sem.acquire())) { audit("rejected", "busy"); return { status: "error", code: "BUSY", message: "Vera is busy running other tools. Try again shortly." }; }
    const ctl = new AbortController(); const onAbort = () => ctl.abort(); req.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(), tool.timeoutMs);
    try {
      const run = tool.handler(a, { userId: req.userId, requestId: req.requestId, conversationId: req.conversationId, signal: ctl.signal, source: req.source, integration: this.svc.context(module.id, ctl.signal), deps: this.deps });
      const result = await Promise.race([run, new Promise<never>((_, rej) => ctl.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { code: req.signal?.aborted ? "CANCELLED" : "TIMEOUT" })), { once: true }))]);
      // 10: bound result size
      let text = JSON.stringify(result ?? null) ?? "null"; let truncated = false; let value: unknown = result ?? null;
      if (Buffer.byteLength(text) > tool.maxResultBytes) { truncated = true; value = { truncated: true, note: "The result was too large and was cut off.", preview: text.slice(0, Math.floor(tool.maxResultBytes / 2)) }; text = JSON.stringify(value); }
      // 11: redaction before anything can enter model context
      let withheld = 0;
      if (req.source === "model") { const s = privacy.sanitizeForModel(value, { userId: req.userId, source: `tool:${tool.name}`, requestId: req.requestId }); value = s.value; withheld = s.withheld; }
      audit("ok", withheld ? "result_redacted" : "allowed");
      if (tool.audit === "always" || !tool.readOnly) repos.audit.add({ userId: req.userId, action: "tool.execute", subject: tool.name, outcome: "ok", requestId: req.requestId });
      return { status: "ok", result: value, durationMs: Date.now() - started, withheld, truncated };
    } catch (e) {
      const code = (e as { code?: string }).code; const known = e instanceof ToolError;
      const out = known ? { code: e.code, message: e.message } : code === "TIMEOUT" ? { code: "TIMEOUT", message: "The tool took too long and was stopped." } : code === "CANCELLED" ? { code: "CANCELLED", message: "Cancelled." } : { code: "TOOL_FAILED", message: "The tool failed." };
      if (!known && code !== "TIMEOUT" && code !== "CANCELLED") this.deps.logger.warn({ tool: tool.name, requestId: req.requestId, err: (e as Error).name }, "tool failed");
      audit("error", out.code);
      repos.audit.add({ userId: req.userId, action: "tool.execute", subject: tool.name, outcome: "error", metadata: { code: out.code }, requestId: req.requestId });
      return { status: "error", ...out };
    } finally { clearTimeout(timer); req.signal?.removeEventListener("abort", onAbort); this.sem.release(); }
  }

  /** Called by the approve route: executes exactly the stored, approved action. */
  async approve(id: string, token: string, userId: string, requestId: string, signal?: AbortSignal): Promise<ToolOutcome> {
    const c = this.deps.repos.confirmations.get(id);
    if (!c || c.userId !== userId) return { status: "error", code: "CONFIRMATION_INVALID", message: "Confirmation not found." };
    return this.execute({ tool: c.tool, args: c.args, userId, requestId, conversationId: c.conversationId, source: "user", signal, confirmation: { id, token } });
  }
  cancel(id: string, userId: string): boolean {
    const c = this.deps.repos.confirmations.get(id);
    if (!c || c.userId !== userId || c.consumedAt) return false;
    return this.deps.repos.confirmations.consume(id, "cancelled");
  }
}

/** Throw from a tool handler to return a clean, user-safe error. */
export class ToolError extends Error { constructor(public code: string, message: string) { super(message); } }
export { sha256 };
