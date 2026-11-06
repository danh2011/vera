import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { AIGuard } from "./ai/guard.js";
import { GeminiProvider } from "./ai/gemini.js";
import { ChatError, ChatService } from "./ai/orchestrator.js";
import type { AIProvider } from "./ai/provider.js";
import { AuthError, AuthService, COOKIE, SESSION_TTL_MS } from "./auth/auth.js";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./database/db.js";
import { createRepos } from "./database/repos.js";
import { BUILTIN_MODULES } from "./integrations/adapters/index.js";
import { IntegrationService, ServiceError } from "./integrations/core/service.js";
import type { AppDeps, IntegrationModule } from "./integrations/core/types.js";
import { createLogger, LogRing } from "./logger.js";
import { randomToken, SecretBox, sha256 } from "./security/crypto.js";
import { PrivacyGateway, type DataClass } from "./security/privacy.js";
import { ReminderScheduler } from "./services/reminders.js";
import { systemsOverview, VERSION } from "./services/system.js";
import { ToolExecutor, type ToolOutcome } from "./tools/executor.js";

declare module "fastify" { interface FastifyRequest { auth?: { userId: string; username: string; csrf: string; hash: string } } }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public headers?: Record<string, string>) { super(message); } }
const parse = <T extends z.ZodType>(schema: T, data: unknown): z.output<T> => { const r = schema.safeParse(data); if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "Some fields are not valid.", Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message]))); return r.data; };
const idParam = z.object({ id: z.string().uuid() });
const intId = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) });
const PUBLIC = new Set(["GET /api/v1/health", "GET /api/v1/ready", "GET /api/v1/setup/status", "POST /api/v1/setup/owner", "POST /api/v1/auth/login", "GET /api/v1/auth/session", "GET /api/v1/oauth/callback"]);

export interface BuiltApp { app: FastifyInstance; deps: AppDeps; auth: AuthService; executor: ToolExecutor; guard: AIGuard; chat: ChatService; integrations: IntegrationService; close(): Promise<void> }
export interface BuildOptions { memoryDb?: boolean; modules?: IntegrationModule[]; provider?: AIProvider | null; silent?: boolean; now?: () => number }

export async function buildApp(config: AppConfig, opts: BuildOptions = {}): Promise<BuiltApp> {
  const logRing = new LogRing(); const logger = createLogger(opts.silent ? "silent" : config.logLevel, logRing);
  const { db, caps, applied } = openDatabase(config.databasePath, { memory: opts.memoryDb });
  if (applied.length) logger.info({ migrations: applied }, "database migrated");
  const repos = createRepos(db, caps.fts5);
  const secrets = opts.memoryDb && !config.secretKey ? new SecretBox(crypto.randomBytes(32)) : SecretBox.fromConfig(config);
  const privacy = new PrivacyGateway(db, repos.settings.get("privacy.extraPatterns", []));
  const deps: AppDeps = { config, db, repos, secrets, privacy, logger, logRing, fts: caps.fts5 };
  const integrations = new IntegrationService(deps, opts.modules ?? BUILTIN_MODULES); deps.integrations = integrations; await integrations.init();
  const executor = new ToolExecutor(deps); const guard = new AIGuard(config, repos, opts.now);
  const makeProvider = (): AIProvider | null => (opts.provider !== undefined ? opts.provider : config.gemini.apiKey && config.gemini.model ? new GeminiProvider({ apiKey: config.gemini.apiKey, model: config.gemini.model }) : null);
  const scheduler = new ReminderScheduler(deps, executor); deps.reminders = scheduler;
  const chat = new ChatService(deps, executor, guard, makeProvider); const auth = new AuthService(config, repos);
  const secure = config.publicUrl.startsWith("https://");

  const app = Fastify({ loggerInstance: logger, trustProxy: config.trustedProxy, bodyLimit: 512 * 1024, genReqId: () => crypto.randomUUID(), disableRequestLogging: false, requestIdHeader: false, routerOptions: { maxParamLength: 200 } });
  await app.register(fastifyHelmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "blob:"], fontSrc: ["'self'", "data:"], connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], upgradeInsecureRequests: secure ? [] : null } }, hsts: secure ? { maxAge: 15552000 } : false, referrerPolicy: { policy: "no-referrer" }, crossOriginResourcePolicy: { policy: "same-origin" } });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: opts.silent ? [] : [], errorResponseBuilder: () => new ApiError(429, "RATE_LIMITED", "Too many requests. Slow down and try again shortly.") });

  app.addHook("onSend", async (req, reply) => { reply.header("x-request-id", req.id); if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store"); });

  /* ---- errors: never leak stack traces or internals ---- */
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const send = (status: number, code: string, message: string, fields?: Record<string, string>, headers?: Record<string, string>) => { if (headers) reply.headers(headers); return reply.status(status).send({ error: { code, message, id: req.id, ...(fields ? { fields } : {}) } }); };
    if (err instanceof ApiError) return send(err.status, err.code, err.message, err.fields, err.headers);
    if (err instanceof AuthError) return send(err.status, err.code, err.message, undefined, err.retryAfter ? { "retry-after": String(err.retryAfter) } : undefined);
    if (err instanceof ServiceError) return send(err.status, err.code, err.message, err.fields);
    if (err instanceof ChatError) return send(err.status, err.code, err.message);
    if (err instanceof ZodError) return send(400, "VALIDATION_ERROR", "Some fields are not valid.");
    if (err.statusCode === 429) return send(429, "RATE_LIMITED", "Too many requests. Slow down and try again shortly.");
    if (err.statusCode === 413) return send(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
    if (err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY" || err.statusCode === 400) return send(400, "BAD_REQUEST", "The request body is not valid JSON.");
    if (err.statusCode === 415) return send(415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON with a Content-Type of application/json.");
    req.log.error({ err: { name: err.name, code: err.code } }, "unhandled error");
    return send(500, "INTERNAL_ERROR", "Something went wrong on the server. Quote the error id if you report it.");
  });

  /* ---- authentication, CSRF and origin checks ---- */
  const allowedOrigins = new Set(config.allowedOrigins);
  app.addHook("onRequest", async (req) => {
    const url = req.url.split("?")[0]!; if (!url.startsWith("/api/")) return;
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const origin = req.headers.origin;
    if (unsafe && origin && !allowedOrigins.has(origin)) throw new ApiError(403, "BAD_ORIGIN", "This request came from an origin Vera does not trust.");
    if (PUBLIC.has(`${req.method} ${url}`)) return;
    const s = auth.resolve(req.cookies[COOKIE]);
    if (!s) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in.");
    if (unsafe) { const h = req.headers["x-csrf-token"]; if (typeof h !== "string" || h.length !== s.session.csrfToken.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(s.session.csrfToken))) throw new ApiError(403, "CSRF_FAILED", "Missing or invalid security token. Reload the page."); }
    req.auth = { userId: s.user.id, username: s.user.username, csrf: s.session.csrfToken, hash: s.hash };
  });
  const uid = (r: FastifyRequest) => r.auth!.userId;
  const setCookie = (reply: FastifyReply, token: string) => reply.setCookie(COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
  const audit = (r: FastifyRequest, action: string, subject?: string, outcome = "ok", metadata?: Record<string, unknown>) => repos.audit.add({ userId: r.auth?.userId, action, subject, outcome, metadata, requestId: r.id });
  const sendOutcome = (reply: FastifyReply, r: ToolOutcome) => {
    if (r.status === "ok") return r.result;
    if (r.status === "confirmation_required") return reply.status(202).send({ confirmation: r.confirmation });
    const status = r.status === "blocked" ? 403 : /^NEEDS_|UNAVAILABLE|NOT_ENABLED|PERMISSION_DENIED|NOT_CONFIGURED/.test(r.code) ? 409 : r.code === "NOT_FOUND" ? 404 : r.code === "INVALID_ARGUMENTS" ? 422 : r.code === "PATH_NOT_ALLOWED" || r.code === "FILE_BLOCKED" ? 403 : r.code === "TIMEOUT" ? 504 : 400;
    return reply.status(status).send({ error: { code: r.code, message: r.message } });
  };
  const pending = new Map<string, AbortController>();

  await app.register(async (api) => {
    /* ---------- health & setup ---------- */
    api.get("/health", async () => ({ status: "ok", version: VERSION, uptimeSeconds: Math.round(process.uptime()) }));
    api.get("/ready", async (_q, reply) => { try { db.prepare("SELECT 1").get(); const v = (db.prepare("SELECT MAX(version) v FROM schema_migrations").get() as { v: number }).v; return { ready: true, database: "ok", schemaVersion: v }; } catch { return reply.status(503).send({ ready: false, database: "error" }); } });
    api.get("/setup/status", async () => ({ ownerExists: auth.ownerExists(), setupTokenRequired: !auth.ownerExists() }));
    api.post("/setup/owner", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = parse(z.object({ username: z.string().trim().min(3).max(40).regex(/^[\w.@-]+$/, "Use letters, numbers and . _ @ - only"), password: z.string().max(300), setupCode: z.string().max(100) }), req.body);
      const user = await auth.createOwner(b.username, b.password, b.setupCode, req.ip); const s = auth.startSession(user.id, req.headers["user-agent"] ?? null);
      repos.audit.add({ userId: user.id, action: "auth.owner_created", outcome: "ok", requestId: req.id }); setCookie(reply, s.token);
      return reply.status(201).send({ authenticated: true, username: user.username, csrfToken: s.csrf, expiresAt: s.expiresAt });
    });

    /* ---------- auth ---------- */
    api.post("/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = parse(z.object({ username: z.string().max(100), password: z.string().max(300) }), req.body);
      try { const r = await auth.login(b.username, b.password, req.ip, req.headers["user-agent"] ?? null); repos.audit.add({ userId: r.user.id, action: "auth.login", outcome: "ok", requestId: req.id }); setCookie(reply, r.token); return { authenticated: true, username: r.user.username, csrfToken: r.csrf, expiresAt: r.expiresAt }; }
      catch (e) { if (e instanceof AuthError) repos.audit.add({ action: "auth.login", outcome: e.code, requestId: req.id }); throw e; }
    });
    api.post("/auth/logout", async (req, reply) => { auth.logout(req.cookies[COOKIE]); audit(req, "auth.logout"); reply.clearCookie(COOKIE, { path: "/" }); return { ok: true }; });
    api.get("/auth/session", async (req) => { const s = auth.resolve(req.cookies[COOKIE]); return s ? { authenticated: true, username: s.user.username, csrfToken: s.session.csrfToken, expiresAt: s.session.expiresAt } : { authenticated: false }; });
    api.get("/auth/sessions", async (req) => ({ sessions: repos.sessions.list(uid(req)).map((s) => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, userAgent: s.userAgent, current: s.fullId === req.auth!.hash })) }));
    api.post("/auth/sessions/revoke-others", async (req) => { const n = repos.sessions.revokeOthers(uid(req), req.auth!.hash); audit(req, "auth.revoke_sessions", undefined, "ok", { count: n }); return { revoked: n }; });
    api.post("/auth/password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => { const b = parse(z.object({ currentPassword: z.string().max(300), newPassword: z.string().max(300) }), req.body); const n = await auth.changePassword(uid(req), b.currentPassword, b.newPassword, req.auth!.hash); audit(req, "auth.password_changed", undefined, "ok", { sessionsRevoked: n }); return { ok: true, sessionsRevoked: n }; });

    /* ---------- chat ---------- */
    api.get("/conversations", async (req) => { const q = parse(z.object({ q: z.string().max(100).optional() }), req.query); return { conversations: repos.conversations.list(uid(req), 100, q.q) }; });
    api.post("/conversations", async (req, reply) => { const c = repos.conversations.create(uid(req)); return reply.status(201).send({ ...c, messages: [] }); });
    api.get("/conversations/:id", async (req) => { const { id } = parse(idParam, req.params); const c = repos.conversations.get(uid(req), id); if (!c) throw new ApiError(404, "NOT_FOUND", "Conversation not found."); return { ...c, messages: repos.conversations.messages(id).map((m) => ({ ...chat.present(m), conversationId: id })) }; });
    api.patch("/conversations/:id", async (req) => { const { id } = parse(idParam, req.params); const b = parse(z.object({ title: z.string().trim().min(1).max(120) }), req.body); if (!repos.conversations.rename(uid(req), id, b.title)) throw new ApiError(404, "NOT_FOUND", "Conversation not found."); return { ok: true }; });
    api.delete("/conversations/:id", async (req) => { const { id } = parse(idParam, req.params); if (!repos.conversations.delete(uid(req), id)) throw new ApiError(404, "NOT_FOUND", "Conversation not found."); audit(req, "conversation.delete", id); return { ok: true }; });
    api.get("/conversations/:id/tool-calls", async (req) => { const { id } = parse(idParam, req.params); return { toolCalls: repos.conversations.toolCalls(uid(req), id) }; });
    api.post("/conversations/:id/cancel", async (req) => { const { id } = parse(idParam, req.params); const c = pending.get(`${uid(req)}:${id}`); c?.abort(); return { cancelled: !!c }; });
    api.post("/conversations/:id/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
      const { id } = parse(idParam, req.params); const q = parse(z.object({ stream: z.enum(["0", "1"]).optional() }), req.query);
      const b = parse(z.object({ content: z.string().max(200_000), regenerate: z.boolean().optional() }), req.body); const key = `${uid(req)}:${id}`;
      if (pending.has(key)) throw new ApiError(409, "BUSY", "Vera is still answering the previous message in this chat.");
      if (!repos.conversations.get(uid(req), id)) throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
      let content = b.content;
      if (b.regenerate) { const msgs = repos.conversations.messages(id, 50); const lastUser = [...msgs].reverse().find((m) => m.role === "user"); if (!lastUser) throw new ApiError(400, "NOTHING_TO_REGENERATE", "There's no message to regenerate from."); repos.conversations.deleteTrailingAssistant(id); content = lastUser.content; db.prepare("DELETE FROM messages WHERE id=?").run(lastUser.id); }
      const ctl = new AbortController(); pending.set(key, ctl);
      reply.raw.on("close", () => { if (!reply.raw.writableFinished) ctl.abort(); });
      const run = () => chat.send(uid(req), id, content, { requestId: req.id, signal: ctl.signal, emit: q.stream === "1" ? (e) => { if (!reply.raw.writableEnded) reply.raw.write(JSON.stringify(e) + "\n"); } : undefined });
      if (q.stream === "1") {
        reply.hijack(); reply.raw.writeHead(200, { ...reply.getHeaders() as Record<string, string>, "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" } as never);
        try { const r = await run(); reply.raw.write(JSON.stringify({ type: "message", message: { ...r.message, conversationId: id }, userMessage: { ...r.userMessage, conversationId: id } }) + "\n"); }
        catch (e) { const code = e instanceof ChatError ? e.code : "INTERNAL_ERROR"; if (!(e instanceof ChatError)) req.log.error({ err: (e as Error).name }, "chat failed"); reply.raw.write(JSON.stringify({ type: "error", code, message: e instanceof ChatError ? e.message : "Something went wrong." }) + "\n"); }
        finally { pending.delete(key); reply.raw.end(); }
        return reply;
      }
      try { const r = await run(); return { message: { ...r.message, conversationId: id }, userMessage: { ...r.userMessage, conversationId: id } }; } finally { pending.delete(key); }
    });
    api.post("/confirmations/:id/approve", async (req) => { const { id } = parse(idParam, req.params); const b = parse(z.object({ token: z.string().max(200) }), req.body); const m = await chat.resolveConfirmation(uid(req), id, b.token, "approve", req.id); audit(req, "confirmation.approve", id); return { message: m }; });
    api.post("/confirmations/:id/cancel", async (req) => { const { id } = parse(idParam, req.params); const m = await chat.resolveConfirmation(uid(req), id, "", "cancel", req.id); audit(req, "confirmation.cancel", id); return { message: m }; });

    /* ---------- tasks & reminders ---------- */
    const due = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date").transform((s) => new Date(s).toISOString()).nullable();
    const taskIn = z.object({ title: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional(), dueAt: due.optional(), priority: z.enum(["low", "medium", "high"]).optional() });
    api.get("/tasks", async (req) => { const q = parse(z.object({ completed: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query); return { tasks: repos.tasks.list(uid(req), { completed: q.completed === undefined ? undefined : q.completed === "true", limit: q.limit, offset: q.offset }) }; });
    api.post("/tasks", async (req, reply) => reply.status(201).send(repos.tasks.create(uid(req), parse(taskIn, req.body))));
    api.get("/tasks/:id", async (req) => { const { id } = parse(idParam, req.params); const t = repos.tasks.get(uid(req), id); if (!t) throw new ApiError(404, "NOT_FOUND", "Task not found."); return t; });
    api.patch("/tasks/:id", async (req) => { const { id } = parse(idParam, req.params); const b = parse(taskIn.partial().extend({ completed: z.boolean().optional() }), req.body); const t = repos.tasks.update(uid(req), id, b); if (!t) throw new ApiError(404, "NOT_FOUND", "Task not found."); return t; });
    api.post("/tasks/:id/complete", async (req) => { const { id } = parse(idParam, req.params); const t = repos.tasks.update(uid(req), id, { completed: true }); if (!t) throw new ApiError(404, "NOT_FOUND", "Task not found."); return t; });
    api.delete("/tasks/:id", async (req) => { const { id } = parse(idParam, req.params); if (!repos.tasks.delete(uid(req), id)) throw new ApiError(404, "NOT_FOUND", "Task not found."); return { ok: true }; });
    api.get("/reminders", async (req) => ({ reminders: repos.reminders.list(uid(req)), channel: scheduler.channelReady() }));
    api.post("/reminders", async (req, reply) => { const b = parse(z.object({ title: z.string().trim().min(1).max(200), remindAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date").transform((s) => new Date(s).toISOString()), taskId: z.string().uuid().optional() }), req.body); if (Date.parse(b.remindAt) < Date.now() - 60_000) throw new ApiError(422, "IN_THE_PAST", "That time has already passed.", { remindAt: "Choose a time in the future." }); const r = repos.reminders.create(uid(req), b); scheduler.poke(); return reply.status(201).send(r); });
    api.delete("/reminders/:id", async (req) => { const { id } = parse(idParam, req.params); if (!repos.reminders.cancel(uid(req), id)) throw new ApiError(404, "NOT_FOUND", "Reminder not found or already finished."); scheduler.poke(); return { ok: true }; });

    /* ---------- notes & memory ---------- */
    for (const [name, repo] of [["notes", repos.notes], ["memory", repos.memories]] as const) {
      const isMem = name === "memory";
      const body = z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(isMem ? 2000 : 20_000), ...(isMem ? { category: z.enum(["note", "fact", "preference"]).default("note") } : {}) });
      api.get(`/${name}`, async (req) => { const q = parse(z.object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) }), req.query); return { items: q.q ? repo.search(uid(req), q.q, q.limit) : repo.list(uid(req), q.limit, q.offset) }; });
      api.post(`/${name}`, async (req, reply) => reply.status(201).send(repo.create(uid(req), parse(body, req.body) as never)));
      api.patch(`/${name}/:id`, async (req) => { const { id } = parse(idParam, req.params); const r = repo.update(uid(req), id, parse(body.partial(), req.body) as never); if (!r) throw new ApiError(404, "NOT_FOUND", "Not found."); return r; });
      api.delete(`/${name}/:id`, async (req) => { const { id } = parse(idParam, req.params); if (!repo.delete(uid(req), id)) throw new ApiError(404, "NOT_FOUND", "Not found."); audit(req, `${name}.delete`, id); return { ok: true }; });
    }

    /* ---------- files (through the same executor and policies as the assistant) ---------- */
    const runTool = (req: FastifyRequest, tool: string, args: unknown) => executor.execute({ tool, args, userId: uid(req), requestId: req.id, source: "user" });
    api.get("/files", async (req, reply) => { const q = parse(z.object({ path: z.string().max(1000).optional() }), req.query); return sendOutcome(reply, await runTool(req, "list_allowed_files", q)); });
    api.get("/files/search", async (req, reply) => { const q = parse(z.object({ q: z.string().min(1).max(100), contents: z.enum(["true", "false"]).optional() }), req.query); return sendOutcome(reply, await runTool(req, "search_files", { query: q.q, search_contents: q.contents === "true" })); });
    api.get("/files/read", async (req, reply) => { const q = parse(z.object({ path: z.string().min(1).max(1000) }), req.query); return sendOutcome(reply, await runTool(req, "read_allowed_file", { path: q.path })); });

    /* ---------- systems ---------- */
    api.get("/system/overview", async (req) => systemsOverview(deps, executor, uid(req), req.id, guard.status().ready));

    /* ---------- integrations ---------- */
    api.get("/integrations", async () => integrations.catalogue());
    const det = (id: string, changed?: boolean) => ({ ...(changed === undefined ? {} : { changed }), detail: integrations.detail(id) });
    api.get("/integrations/:id", async (req) => integrations.detail(parse(intId, req.params).id));
    api.post("/integrations/:id/install", async (req) => { const { id } = parse(intId, req.params); const r = integrations.install(id, uid(req), req.id); return det(id, r.changed); });
    api.post("/integrations/:id/uninstall", async (req) => { const { id } = parse(intId, req.params); parse(z.object({ acknowledge: z.literal(true) }), req.body); const r = integrations.uninstall(id, uid(req), req.id); return { ...det(id, r.changed), kept: r.kept }; });
    api.post("/integrations/:id/enable", async (req) => { const { id } = parse(intId, req.params); integrations.enable(id, uid(req), req.id); return det(id); });
    api.post("/integrations/:id/disable", async (req) => { const { id } = parse(intId, req.params); integrations.disable(id, uid(req), req.id); return det(id); });
    api.get("/integrations/:id/status", async (req) => { const d = integrations.detail(parse(intId, req.params).id); return { id: d.id, status: d.status, statusLabel: d.statusLabel, statusDetail: d.statusDetail ?? null, installed: d.installed, enabled: d.enabled, configured: d.configured, authorised: d.authorised, connection: d.connection, lastTest: d.lastTest, lastSuccessAt: d.lastSuccessAt }; });
    api.get("/integrations/:id/config-schema", async (req) => { const d = integrations.detail(parse(intId, req.params).id); return { fields: d.configSchema, steps: d.manifest.setup.steps, saved: d.config, secretsSaved: d.secretsSaved, missing: d.missing }; });
    const cfgBody = z.object({ values: z.record(z.string().max(60), z.unknown()).default({}), clearSecrets: z.array(z.string().max(60)).max(20).optional(), step: z.number().int().min(0).max(20).optional() });
    api.post("/integrations/:id/configure", async (req) => { const { id } = parse(intId, req.params); const r = await integrations.configure(id, parse(cfgBody, req.body), uid(req), req.id); return { result: r, detail: integrations.detail(id) }; });
    api.post("/integrations/:id/validate-config", async (req) => { const { id } = parse(intId, req.params); const b = parse(cfgBody, req.body); return integrations.validate(id, b.values); });
    api.post("/integrations/:id/test-connection", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req) => { const { id } = parse(intId, req.params); const r = await integrations.test(id, uid(req), req.id); return { result: r, detail: integrations.detail(id) }; });
    api.get("/integrations/:id/tools", async (req) => ({ tools: integrations.detail(parse(intId, req.params).id).tools }));
    api.get("/integrations/:id/permissions", async (req) => ({ permissions: integrations.detail(parse(intId, req.params).id).permissions }));
    api.patch("/integrations/:id/permissions/:permission", async (req) => { const p = parse(z.object({ id: intId.shape.id, permission: z.string().regex(/^[a-z_]{2,30}$/) }), req.params); const b = parse(z.object({ granted: z.boolean() }), req.body); return integrations.setPermission(p.id, p.permission, b.granted, uid(req), req.id); });
    api.get("/integrations/:id/options/:key", async (req) => { const p = parse(z.object({ id: intId.shape.id, key: z.string().regex(/^[a-z_]{2,40}$/) }), req.params); return integrations.options(p.id, p.key, uid(req)); });
    api.post("/integrations/:id/actions/:action", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => { const p = parse(z.object({ id: intId.shape.id, action: z.string().regex(/^[a-z_]{2,40}$/) }), req.params); return { result: await integrations.runAction(p.id, p.action, uid(req), req.id), detail: integrations.detail(p.id) }; });
    api.post("/integrations/:id/oauth/start", async (req) => {
      const { id } = parse(intId, req.params); const m = integrations.module(id); const sum = integrations.summary(id);
      if (!m.oauth) throw new ApiError(400, "NOT_OAUTH", "This integration does not use sign-in."); if (!sum.installed) throw new ApiError(409, "NOT_INSTALLED", "Install it first.");
      if (!sum.configured) throw new ApiError(409, "NEEDS_SETUP", "Save the app details first.");
      const state = randomToken(24); const verifier = randomToken(48); const challenge = crypto.createHash("sha256").update(verifier).digest("base64url"); const sh = sha256(state);
      repos.oauth.create(sh, uid(req), id, secrets.encrypt(verifier, `oauth:${sh}`));
      audit(req, "integration.oauth_start", id);
      return { authUrl: m.oauth.buildAuthUrl(integrations.context(id), { redirectUri: `${config.publicUrl}/api/v1/oauth/callback`, state, challenge }), redirectUri: `${config.publicUrl}/api/v1/oauth/callback` };
    });
    api.get("/oauth/callback", async (req, reply) => {
      const q = parse(z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }), req.query);
      const back = (id: string, r: string) => reply.redirect(`${config.publicUrl}/#/integrations/${id}?oauth=${r}`);
      const s = auth.resolve(req.cookies[COOKIE]); if (!s) return reply.redirect(`${config.publicUrl}/#/chat`);
      if (!q.state) throw new ApiError(400, "BAD_STATE", "Missing state.");
      const sh = sha256(q.state); const st = repos.oauth.consume(sh);
      if (!st || st.userId !== s.user.id) { repos.audit.add({ userId: s.user.id, action: "integration.oauth_callback", outcome: "state_invalid", requestId: req.id }); throw new ApiError(400, "BAD_STATE", "This sign-in link is invalid or has expired. Start again from the integration page."); }
      if (q.error || !q.code) { audit(req, "integration.oauth_callback", st.integrationId, "denied"); return back(st.integrationId, "denied"); }
      try { const m = integrations.module(st.integrationId); await m.oauth!.exchange(integrations.context(st.integrationId), { code: q.code, redirectUri: `${config.publicUrl}/api/v1/oauth/callback`, verifier: secrets.decrypt(st.verifierCt, `oauth:${sh}`) }); repos.integrations.resetConnection(st.integrationId); audit(req, "integration.oauth_callback", st.integrationId, "ok"); return back(st.integrationId, "success"); }
      catch (e) { audit(req, "integration.oauth_callback", st.integrationId, "failed", { code: (e as { code?: string }).code }); return back(st.integrationId, "error"); }
    });

    /* ---------- settings, usage, audit ---------- */
    api.get("/settings", async () => ({
      version: VERSION, environment: config.env,
      security: { authRequired: true, secureCookies: secure, trustedProxy: !!config.trustedProxy, csrfProtection: true },
      ai: guard.status(), aiAcknowledged: guard.acknowledged(),
      privacy: { enabled: true, blockedByDefault: ["FINANCIAL", "CREDENTIAL", "SENSITIVE_PERSONAL"] as DataClass[], last24h: repos.audit.privacyCounts(new Date(Date.now() - 864e5).toISOString()), recent: repos.audit.recentPrivacy(10), disclaimer: "Automated detection reduces risk but cannot guarantee perfect protection." },
      machine: { readonly: config.machine.readonly }, files: { rootCount: config.files.roots.length }, storage: { fts5: caps.fts5 },
    }));
    api.get("/settings/ai", async () => guard.status());
    api.patch("/settings/ai", async (req) => { const b = parse(z.object({ enabled: z.boolean().optional(), limits: z.object({ perMinute: z.number().int().min(1).max(600), perDay: z.number().int().min(1).max(100000), toolRounds: z.number().int().min(1).max(10), outputTokens: z.number().int().min(16).max(8192) }).partial().optional() }), req.body); if (b.enabled !== undefined) guard.setEnabled(b.enabled); if (b.limits) guard.setLimits(b.limits); audit(req, "settings.ai", "gemini", "ok", { enabled: b.enabled, limits: b.limits }); return guard.status(); });
    api.post("/settings/ai/acknowledge", async (req) => { const b = parse(z.object({ eligibilityChecked: z.literal(true), quotaChecked: z.literal(true) }), req.body); void b; guard.acknowledge(true); audit(req, "settings.ai_acknowledged", "gemini"); return guard.status(); });
    api.get("/usage", async () => { const s = guard.status(); return { provider: "gemini", limits: s.limits, ...s.usage, note: "Token counts are reported by the provider. Vera shows no money estimate because it holds no verified pricing data." }; });
    const auditQ = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().max(40).optional(), action: z.string().max(40).optional() });
    api.get("/audit", async (req) => repos.audit.list(parse(auditQ, req.query)));
  }, { prefix: "/api/v1" });

  /* ---- static frontend (production) ---- */
  const staticDir = config.staticDir ?? (config.env === "production" ? path.resolve("dist") : null);
  if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false, setHeaders: (res, p) => { if (/\.(js|css|woff2?)$/.test(p) && p.includes(`${path.sep}assets${path.sep}`)) res.header("cache-control", "public, max-age=31536000, immutable"); } });
    app.setNotFoundHandler((req, reply) => { if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html"); return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found.", id: req.id } }); });
  } else app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found.", id: req.id } }));

  scheduler.start();
  const cleanup = setInterval(() => { try { repos.sessions.purgeExpired(); repos.oauth.purge(); repos.confirmations.purge(); repos.usage.purgeOld(); } catch { /* best effort */ } }, 3600_000); cleanup.unref();
  return { app: app as unknown as FastifyInstance, deps, auth, executor, guard, chat, integrations, async close() { clearInterval(cleanup); scheduler.stop(); for (const c of pending.values()) c.abort(); await app.close(); await integrations.dispose(); db.close(); } };
}
