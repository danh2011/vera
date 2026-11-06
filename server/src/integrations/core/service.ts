import { z } from "zod";
import type { ActionResult, ConfigField, ConfigureResult, DependencyInfo, IntegrationDetail, IntegrationStatus, IntegrationSummary, IntegrationsCatalogue, TestResult, ToolAvailability, ToolInfo, ConnectionState } from "../../../../shared/types/index.js";
import { validateServiceUrl } from "../../security/ssrf.js";
import { CATEGORIES, type AnyTool, type AppDeps, type IntegrationContext, type IntegrationModule } from "./types.js";

export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 400, public fields?: Record<string, string>) { super(message); }
}

const OAUTH_SECRET = "oauth_refresh_token";
const STATUS_LABEL: Record<IntegrationStatus, string> = {
  available: "Not installed", installed: "Installed", needs_dependency: "Needs another integration", needs_setup: "Needs setup", needs_authorisation: "Needs authorisation", disabled: "Installed · off",
  ready: "Enabled", connected: "Connected", degraded: "Degraded", error: "Error", unavailable: "Unavailable",
};

export function fieldSchema(f: ConfigField): z.ZodType<unknown> {
  switch (f.type) {
    case "url": return z.string().trim().max(500).refine((v) => validateServiceUrl(v).ok, { message: "Enter a full URL such as http://192.168.1.10:8123 (no username or password in the URL)." });
    case "secret": return z.string().min(1).max(4096);
    case "number": { let n = z.coerce.number().finite(); if (f.min !== undefined) n = n.min(f.min); if (f.max !== undefined) n = n.max(f.max); return n; }
    case "boolean": return z.union([z.boolean(), z.enum(["true", "false"])]).transform((v) => v === true || v === "true");
    case "select": if (f.dynamicOptions) return z.string().trim().max(200); return z.string().refine((v) => !!f.options?.some((o) => o.value === v), { message: "Choose one of the listed options." });
    case "list": return z.array(z.string().trim().min(1).max(400)).max(50);
    default: return z.string().trim().max(f.maxLength ?? 500);
  }
}

export class IntegrationService {
  private modules = new Map<string, IntegrationModule>();
  private testing = new Set<string>();
  private listeners: (() => void)[] = [];
  /** Called after any change that can alter what is usable (install, enable, configure, test…). */
  onChange(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const f of this.listeners) { try { f(); } catch { /* listeners must not break requests */ } } }
  constructor(private deps: AppDeps, modules: IntegrationModule[]) {
    for (const m of modules) { if (this.modules.has(m.id)) throw new Error(`Duplicate integration id ${m.id}`); this.modules.set(m.id, m); }
  }

  /** Registers bundled modules in the database and installs the preinstalled defaults once. */
  async init() {
    const r = this.deps.repos;
    const boot = new Set(r.settings.get<string[]>("integrations.bootstrapped", []));
    for (const m of this.modules.values()) {
      r.integrations.ensure(m.id, m.version);
      const man = m.getManifest();
      if (man.defaultInstalled && !boot.has(m.id)) { this.doInstall(m, true); boot.add(m.id); }
      await m.initialize?.(this.deps);
    }
    r.settings.set("integrations.bootstrapped", [...boot]);
  }
  async dispose() { for (const m of this.modules.values()) await m.dispose?.(); }

  module(id: string): IntegrationModule { const m = this.modules.get(id); if (!m) throw new ServiceError("INTEGRATION_NOT_FOUND", "That integration does not exist.", 404); return m; }
  modulesList() { return [...this.modules.values()]; }
  allTools(): { tool: AnyTool; module: IntegrationModule }[] { return this.modulesList().flatMap((m) => m.getTools().map((tool) => ({ tool, module: m }))); }
  findTool(name: string) { return this.allTools().find((t) => t.tool.name === name) ?? null; }

  /* ---------- configuration plumbing ---------- */
  context(id: string, signal?: AbortSignal): IntegrationContext {
    const repos = this.deps.repos.integrations; const secrets = this.deps.secrets;
    return {
      id, deps: this.deps, signal, config: { ...this.defaults(id), ...repos.settings(id) },
      secret: (key) => { const ct = repos.getSecretCt(id, key); if (!ct) return null; try { return secrets.decrypt(ct, `${id}:${key}`); } catch { return null; } },
      setSecret: (key, value) => repos.setSecretCt(id, key, secrets.encrypt(value, `${id}:${key}`)),
    };
  }
  private defaults(id: string): Record<string, string> { return Object.fromEntries(this.module(id).getConfigSchema().filter((f) => f.default !== undefined && f.type !== "secret").map((f) => [f.key, String(f.default)])); }
  private missing(m: IntegrationModule): string[] {
    const repos = this.deps.repos.integrations; const cfg = repos.settings(m.id); const secrets = new Set(repos.secretKeys(m.id));
    const isMissing = (key: string) => { const f = m.getConfigSchema().find((x) => x.key === key); return f?.type === "secret" ? !secrets.has(key) : !(cfg[key] ?? (f?.default !== undefined ? String(f.default) : "")).trim(); };
    const out = m.getConfigSchema().filter((f) => f.required && isMissing(f.key)).map((f) => f.key);
    if (m.requireAny && !m.requireAny.some((g) => g.every((k) => !isMissing(k)))) out.push(...m.requireAny[0]!.filter(isMissing));
    if (m.missingConfig) out.push(...m.missingConfig({ ...this.defaults(m.id), ...cfg }, secrets));
    return [...new Set(out)];
  }
  private authorised(m: IntegrationModule): boolean { return m.getManifest().authMode !== "oauth" || this.deps.repos.integrations.secretKeys(m.id).includes(OAUTH_SECRET); }

  private presentConfig(m: IntegrationModule) {
    const cfg = { ...this.defaults(m.id), ...this.deps.repos.integrations.settings(m.id) }; const out: Record<string, string | number | boolean | string[]> = {};
    for (const f of m.getConfigSchema()) {
      if (f.type === "secret") continue; const v = cfg[f.key]; if (v === undefined) continue;
      out[f.key] = f.type === "boolean" ? v === "true" : f.type === "number" ? Number(v) : f.type === "list" ? v.split("\n").filter(Boolean) : v;
    }
    return out;
  }

  /* ---------- state ---------- */
  toolAvailability(m: IntegrationModule, t: AnyTool): { availability: ToolAvailability; reason?: string } {
    const row = this.deps.repos.integrations.get(m.id); const plat = m.platformAvailability?.(this.deps);
    if (plat && !plat.available) return { availability: "unavailable", reason: plat.reason };
    if (!row?.installed) return { availability: "needs_install", reason: `Install ${m.name} to use this tool.` };
    const unmetDep = this.dependencies(m).find((d) => !d.satisfied); if (unmetDep) return { availability: "needs_dependency", reason: unmetDep.problem };
    const miss = this.missing(m);
    if (miss.length) return { availability: "needs_configuration", reason: `Finish setting up ${m.name}.` };
    if (!this.authorised(m)) return { availability: "needs_authorisation", reason: `Connect your ${m.name} account.` };
    if (!row.enabled) return { availability: "needs_enable", reason: `${m.name} is turned off.` };
    const cfg = this.deps.repos.integrations.settings(m.id);
    const tm = (t.needsConfig ?? []).filter((k) => !(cfg[k] ?? "").trim() && !this.deps.repos.integrations.secretKeys(m.id).includes(k));
    if (tm.length) return { availability: "needs_configuration", reason: `This tool also needs: ${tm.join(", ")}.` };
    if (this.deps.repos.integrations.permissions(m.id)[t.permission] === false) return { availability: "permission_denied", reason: "You have not granted the permission this tool needs." };
    return { availability: "available" };
  }
  toolInfos(m: IntegrationModule): ToolInfo[] {
    return m.getTools().map((t) => { const a = this.toolAvailability(m, t); return { name: t.name, title: t.title, description: t.description, risk: t.risk, permission: t.permission, requiresConfirmation: t.confirm !== undefined && t.confirm !== false, readOnly: t.readOnly, availability: a.availability, ...(a.reason ? { availabilityReason: a.reason } : {}), integrationId: m.id }; });
  }

  /** Dependencies are satisfied only when the other integration is installed, set up, on AND its last test succeeded. */
  dependencies(m: IntegrationModule): DependencyInfo[] {
    return (m.getManifest().requires ?? []).map((rq) => {
      const dm = this.modules.get(rq.id); if (!dm) return { id: rq.id, name: rq.id, reason: rq.reason, satisfied: false, state: "unavailable", problem: "This integration is not part of this build.", action: "none" } as DependencyInfo;
      const row = this.deps.repos.integrations.get(rq.id)!; const dman = dm.getManifest(); const plat = dm.platformAvailability?.(this.deps);
      const needsTest = dman.healthCheck && dman.contactsExternalServices; let problem = ""; let action: DependencyInfo["action"] = "none"; let state: DependencyInfo["state"] = "ready";
      if (plat && !plat.available) { problem = plat.reason ?? "Unavailable on this server."; state = "unavailable"; }
      else if (!row.installed) { problem = `${dm.name} isn't installed yet.`; action = "install"; state = "available"; }
      else if (this.missing(dm).length) { problem = `${dm.name} still needs to be set up.`; action = "configure"; state = "needs_setup"; }
      else if (!this.authorised(dm)) { problem = `${dm.name} needs you to sign in.`; action = "connect"; state = "needs_authorisation"; }
      else if (needsTest && row.connection !== "connected") { problem = row.connection === "failed" ? `${dm.name}'s last connection test failed.` : `${dm.name} hasn't been tested yet.`; action = "test"; state = row.connection === "failed" ? "error" : "ready"; }
      else if (!row.enabled) { problem = `${dm.name} is turned off.`; action = "enable"; state = "disabled"; }
      return { id: rq.id, name: dm.name, reason: rq.reason, satisfied: !problem, state, problem, action };
    });
  }
  dependents(id: string) { return this.modulesList().filter((m) => m.getManifest().requires?.some((r) => r.id === id) && this.deps.repos.integrations.get(m.id)?.installed).map((m) => ({ id: m.id, name: m.name })); }

  summary(id: string): IntegrationSummary {
    const m = this.module(id); const man = m.getManifest(); const row = this.deps.repos.integrations.get(id)!;
    const plat = m.platformAvailability?.(this.deps); const miss = this.missing(m); const authed = this.authorised(m); const deps = this.dependencies(m); const unmet = deps.filter((d) => !d.satisfied);
    const external = man.contactsExternalServices;
    const connection: ConnectionState = !man.healthCheck || !external ? "not_applicable" : row.connection;
    let status: IntegrationStatus; let detail: string | undefined;
    if (plat && !plat.available) { status = "unavailable"; detail = plat.reason; }
    else if (!row.installed) status = "available";
    else if (unmet.length) { status = "needs_dependency"; detail = unmet.map((d) => d.problem).join(" "); }
    else if (miss.length) { status = "needs_setup"; detail = "Some required settings are missing."; }
    else if (!authed) { status = "needs_authorisation"; detail = "Sign in to the provider to finish connecting."; }
    else if (connection === "failed") { status = ["rate_limited", "timeout"].includes(row.lastTestCode ?? "") ? "degraded" : "error"; detail = row.lastTestMessage ?? undefined; }
    else if (!row.enabled) status = "disabled";
    else if (connection === "connected") status = "connected";
    else status = "ready";
    const tools = this.toolInfos(m);
    const nextAction: IntegrationSummary["nextAction"] = status === "available" ? "install" : (status === "needs_setup" || status === "needs_dependency") ? "configure" : status === "needs_authorisation" ? "connect" : status === "disabled" ? "enable" : status === "error" || status === "degraded" ? "configure" : status === "unavailable" ? "none" : "open";
    return {
      id, name: m.name, version: m.version, category: m.category, description: m.description, icon: man.icon, capabilities: man.capabilities,
      runsLocally: man.runsLocally, contactsExternalServices: external, requiresCredentials: man.requiresCredentials, authMode: man.authMode, required: man.required,
      installed: row.installed, enabled: row.enabled, configured: miss.length === 0, authorised: authed, connection,
      status, statusLabel: STATUS_LABEL[status], ...(detail ? { statusDetail: detail } : {}),
      attention: row.installed && ["needs_setup", "needs_dependency", "needs_authorisation", "error", "degraded"].includes(status), nextAction, dependencies: deps,
      toolCount: tools.length, toolsAvailable: tools.filter((t) => t.availability === "available").length, lastTestAt: row.lastTestAt, lastSuccessAt: row.lastSuccessAt,
    };
  }

  catalogue(): IntegrationsCatalogue {
    const list = this.modulesList().map((m) => this.summary(m.id));
    const cats = new Map<string, number>(); for (const s of list) cats.set(s.category, (cats.get(s.category) ?? 0) + 1);
    return {
      integrations: list,
      categories: [...cats].map(([id, count]) => ({ id, label: CATEGORIES[id] ?? id, count })).sort((a, b) => a.label.localeCompare(b.label)),
      counts: { total: list.length, installed: list.filter((s) => s.installed).length, enabled: list.filter((s) => s.enabled).length, needsAttention: list.filter((s) => s.attention).length },
    };
  }

  detail(id: string): IntegrationDetail {
    const m = this.module(id); const s = this.summary(id); const row = this.deps.repos.integrations.get(id)!;
    const secrets = new Set(this.deps.repos.integrations.secretKeys(id)); const perms = this.deps.repos.integrations.permissions(id); const man = m.getManifest();
    return {
      ...s, dependents: this.dependents(id), manifest: man, configSchema: m.getConfigSchema(), config: this.presentConfig(m),
      secretsSaved: Object.fromEntries(m.getConfigSchema().filter((f) => f.type === "secret").map((f) => [f.key, secrets.has(f.key)])),
      missing: this.missing(m), permissions: man.permissions.map((p) => ({ ...p, granted: row.installed ? (perms[p.id] ?? p.defaultGranted) : p.defaultGranted })),
      tools: this.toolInfos(m), setupStep: row.setupStep, ...(m.oauth ? { oauthRedirectUri: `${this.deps.config.publicUrl}/api/v1/oauth/callback` } : {}),
      lastTest: row.lastTestAt ? { at: row.lastTestAt, code: (row.lastTestCode ?? "error") as never, message: row.lastTestMessage ?? "" } : null,
      recentActivity: this.deps.repos.audit.recentToolExecutions(id, 10),
    };
  }

  /* ---------- lifecycle ---------- */
  private doInstall(m: IntegrationModule, boot = false): boolean {
    const r = this.deps.repos.integrations; const man = m.getManifest();
    const changed = r.install(m.id);
    if (changed) for (const p of man.permissions) r.setPermission(m.id, p.id, p.defaultGranted);
    const noSetup = this.missing(m).length === 0 && this.authorised(m) && this.dependencies(m).every((d) => d.satisfied);
    // Only integrations with nothing to configure switch on by themselves. Anything with a setup form, sign-in, credentials or a dependency waits for the wizard.
    const selfContained = !man.contactsExternalServices && !man.requiresCredentials && !man.requires?.length && !man.setup.steps.some((s) => s.kind === "form" || s.kind === "oauth");
    if ((boot || selfContained) && noSetup && changed) r.setEnabled(m.id, true);
    return changed;
  }
  install(id: string, userId: string, requestId?: string) {
    const m = this.module(id); const plat = m.platformAvailability?.(this.deps);
    if (plat && !plat.available) throw new ServiceError("UNAVAILABLE", plat.reason ?? "This integration is not available on this server.", 409);
    const changed = this.deps.repos.integrations.get(id)?.installed ? false : this.doInstall(m);
    if (changed) this.deps.repos.audit.add({ userId, action: "integration.install", subject: id, outcome: "ok", requestId });
    this.changed(); return { changed, integration: this.summary(id) };
  }
  enable(id: string, userId: string, requestId?: string) {
    const m = this.module(id); const row = this.deps.repos.integrations.get(id)!;
    if (!row.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration first.", 409);
    const unmetDep = this.dependencies(m).find((d) => !d.satisfied); if (unmetDep) throw new ServiceError("NEEDS_DEPENDENCY", `${unmetDep.problem} Fix that first, then turn this on.`, 409);
    if (this.missing(m).length) throw new ServiceError("NEEDS_SETUP", "Finish setup before turning this on.", 409);
    if (!this.authorised(m)) throw new ServiceError("NEEDS_AUTHORISATION", "Connect your account before turning this on.", 409);
    this.deps.repos.integrations.setEnabled(id, true); this.deps.repos.audit.add({ userId, action: "integration.enable", subject: id, outcome: "ok", requestId });
    this.changed(); return this.summary(id);
  }
  disable(id: string, userId: string, requestId?: string) {
    const m = this.module(id);
    if (m.getManifest().required) throw new ServiceError("REQUIRED", `${m.name} is a core part of Vera and cannot be turned off.`, 409);
    this.deps.repos.integrations.setEnabled(id, false); this.deps.repos.audit.add({ userId, action: "integration.disable", subject: id, outcome: "ok", requestId });
    this.changed(); return this.summary(id);
  }
  uninstall(id: string, userId: string, requestId?: string) {
    const m = this.module(id);
    if (m.getManifest().required) throw new ServiceError("REQUIRED", `${m.name} is a core part of Vera and cannot be uninstalled.`, 409);
    if (!this.deps.repos.integrations.get(id)?.installed) return { changed: false, integration: this.summary(id), kept: m.getManifest().uninstall.keeps };
    this.deps.repos.integrations.wipeConfig(id);
    this.deps.repos.audit.add({ userId, action: "integration.uninstall", subject: id, outcome: "ok", requestId }); this.changed();
    return { changed: true, integration: this.summary(id), kept: m.getManifest().uninstall.keeps };
  }
  setPermission(id: string, permission: string, granted: boolean, userId: string, requestId?: string) {
    const m = this.module(id); const p = m.getManifest().permissions.find((x) => x.id === permission);
    if (!p) throw new ServiceError("UNKNOWN_PERMISSION", "That permission does not exist.", 404);
    if (!this.deps.repos.integrations.get(id)?.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration first.", 409);
    this.deps.repos.integrations.setPermission(id, permission, granted);
    this.deps.repos.audit.add({ userId, action: "integration.permission", subject: id, outcome: granted ? "granted" : "revoked", metadata: { permission }, requestId });
    return this.detail(id);
  }

  /* ---------- configuration ---------- */
  private parseValues(m: IntegrationModule, values: Record<string, unknown>) {
    const schema = new Map(m.getConfigSchema().map((f) => [f.key, f])); const parsed: Record<string, unknown> = {}; const errors: Record<string, string> = {};
    for (const [k, raw] of Object.entries(values)) {
      const f = schema.get(k); if (!f) { errors[k] = "Unknown setting."; continue; }
      if (f.type === "secret" && (raw === "" || raw === null || raw === undefined)) continue; // blank secret = keep existing
      if (!f.required && (raw === "" || raw === null) && f.type !== "boolean") { parsed[k] = null; continue; }
      let v = raw; if (f.type === "list" && typeof raw === "string") v = raw.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
      const r = fieldSchema(f).safeParse(v);
      if (!r.success) errors[k] = r.error.issues[0]?.message ?? "Invalid value."; else parsed[k] = r.data;
    }
    return { parsed, errors };
  }
  async validate(id: string, values: Record<string, unknown>) {
    const m = this.module(id); const { parsed, errors } = this.parseValues(m, values);
    const merged = { ...this.presentConfig(m), ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null)) };
    const sem = await m.validateConfig(merged); for (const [k, v] of Object.entries(sem.errors)) if (!errors[k]) errors[k] = v;
    return { ok: Object.keys(errors).length === 0, errors };
  }
  async configure(id: string, input: { values: Record<string, unknown>; clearSecrets?: string[]; step?: number }, userId: string, requestId?: string): Promise<ConfigureResult> {
    const m = this.module(id); const row = this.deps.repos.integrations.get(id)!;
    if (!row.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration before configuring it.", 409);
    const v = await this.validate(id, input.values);
    if (!v.ok) throw new ServiceError("INVALID_CONFIG", "Some settings need attention.", 422, v.errors);
    const { parsed } = this.parseValues(m, input.values); const schema = new Map(m.getConfigSchema().map((f) => [f.key, f])); const repos = this.deps.repos.integrations; const saved: string[] = [];
    this.deps.db.transaction(() => {
      for (const [k, val] of Object.entries(parsed)) {
        const f = schema.get(k)!;
        if (f.type === "secret") { repos.setSecretCt(id, k, this.deps.secrets.encrypt(String(val), `${id}:${k}`)); saved.push(k); }
        else if (val === null) { repos.deleteSetting(id, k); saved.push(k); }
        else { repos.setSetting(id, k, Array.isArray(val) ? val.join("\n") : String(val)); saved.push(k); }
      }
      for (const k of input.clearSecrets ?? []) if (schema.get(k)?.type === "secret") { repos.deleteSecret(id, k); saved.push(k); }
      if (input.step !== undefined) repos.setStep(id, Math.max(0, Math.min(input.step, 20)));
      if (saved.length) repos.resetConnection(id);
    })();
    if (this.missing(m).length) repos.setEnabled(id, false); // an incomplete integration can never stay enabled
    this.deps.repos.audit.add({ userId, action: "integration.configure", subject: id, outcome: "ok", metadata: { keys: saved }, requestId });
    this.changed(); return { saved, missing: this.missing(m), errors: {}, configured: this.missing(m).length === 0 };
  }

  async test(id: string, userId: string, requestId?: string): Promise<TestResult> {
    const m = this.module(id); const row = this.deps.repos.integrations.get(id)!; const testedAt = new Date().toISOString();
    if (!row.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration first.", 409);
    if (this.testing.has(id)) throw new ServiceError("TEST_IN_PROGRESS", "A test is already running.", 429);
    let result: TestResult;
    if (!m.getManifest().healthCheck) result = { ok: false, code: "not_supported", message: "This integration has no connection to test.", testedAt };
    else if (this.missing(m).length) result = { ok: false, code: "missing_config", message: "Some required settings are missing.", testedAt };
    else {
      this.testing.add(id); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15_000);
      try { const h = await Promise.race([m.healthCheck(this.context(id, ctl.signal)), new Promise<never>((_, rej) => ctl.signal.addEventListener("abort", () => rej(Object.assign(new Error("timeout"), { code: "timeout" })), { once: true }))]); result = { ok: h.ok, code: h.code, message: h.message, testedAt, ...(h.details ? { details: h.details } : {}) }; }
      catch (e) { const t = (e as { code?: string }).code === "timeout"; result = { ok: false, code: t ? "timeout" : "error", message: t ? "The service did not respond in time." : "The check failed unexpectedly.", testedAt }; }
      finally { clearTimeout(timer); this.testing.delete(id); }
    }
    if (result.code !== "not_supported") this.deps.repos.integrations.setTest(id, result.ok, result.code, result.message);
    this.deps.repos.audit.add({ userId, action: "integration.test", subject: id, outcome: result.code, requestId });
    this.changed(); return result;
  }

  async options(id: string, key: string, userId: string): Promise<{ options: { value: string; label: string }[]; error?: string }> {
    const m = this.module(id); const f = m.getConfigSchema().find((x) => x.key === key);
    if (!f?.dynamicOptions || !m.dynamicOptions) throw new ServiceError("NOT_FOUND", "That field has no live options.", 404);
    if (!this.deps.repos.integrations.get(id)?.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration first.", 409);
    const unmetDep = this.dependencies(m).find((d) => !d.satisfied); if (unmetDep) return { options: [], error: unmetDep.problem };
    void userId; const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10_000);
    try { return { options: (await m.dynamicOptions(this.context(id, ctl.signal), key)).slice(0, 200) }; } catch (e) { return { options: [], error: (e as Error).message || "Couldn't load the choices." }; } finally { clearTimeout(t); }
  }
  async runAction(id: string, action: string, userId: string, requestId?: string): Promise<ActionResult> {
    const m = this.module(id); const fn = m.actions?.[action]; if (!fn) throw new ServiceError("NOT_FOUND", "Unknown action.", 404);
    if (!this.deps.repos.integrations.get(id)?.installed) throw new ServiceError("NOT_INSTALLED", "Install this integration first.", 409);
    const unmetDep = this.dependencies(m).find((d) => !d.satisfied); if (unmetDep) throw new ServiceError("NEEDS_DEPENDENCY", unmetDep.problem, 409);
    if (this.missing(m).length) throw new ServiceError("NEEDS_SETUP", "Finish setup first.", 409);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
    try { const r = await fn(this.context(id, ctl.signal)); this.deps.repos.audit.add({ userId, action: "integration.action", subject: `${id}:${action}`, outcome: r.ok ? "ok" : "failed", requestId }); return r; }
    catch (e) { const msg = e instanceof Error ? e.message : "The action failed."; this.deps.repos.audit.add({ userId, action: "integration.action", subject: `${id}:${action}`, outcome: "error", requestId }); return { ok: false, message: msg }; }
    finally { clearTimeout(t); }
  }

  /** Compact, real health report across all integrations (used by the get_integration_health tool and Settings). */
  healthReport() { return this.modulesList().map((m) => { const s = this.summary(m.id); return { dependsOn: s.dependencies.map((d) => ({ id: d.id, ok: d.satisfied })), id: m.id, name: m.name, status: s.status, installed: s.installed, enabled: s.enabled, configured: s.configured, connection: s.connection, lastTestAt: s.lastTestAt, lastSuccessAt: s.lastSuccessAt, toolsAvailable: s.toolsAvailable, toolCount: s.toolCount, detail: s.statusDetail ?? null }; }); }
}
