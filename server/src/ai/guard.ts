import type { AiStatus } from "../../../shared/types/index.js";
import type { AppConfig } from "../config.js";
import type { Repos } from "../database/repos.js";
import { ProviderError } from "./provider.js";

const FAILURE_THRESHOLD = 3; const OPEN_MS = 60_000; const RETRIES = 2;

/** Cost and safety controls around the provider: enable/ack state, rate limits, usage counters, circuit breaker, bounded retries. */
export class AIGuard {
  private failures = 0; private openUntil = 0;
  constructor(private config: AppConfig, private repos: Repos, private now: () => number = Date.now) {}

  private dbEnabled() { return this.repos.settings.get<boolean>("ai.gemini.enabled", true); }
  acknowledged() { return this.repos.settings.get<boolean>("ai.gemini.acknowledged", false); }
  setEnabled(v: boolean) { this.repos.settings.set("ai.gemini.enabled", v); }
  acknowledge(v: boolean) { this.repos.settings.set("ai.gemini.acknowledged", v); }
  /** Owner-adjustable limits can only be lowered below the operator's environment ceiling. */
  limits() {
    const o = this.repos.settings.get<Partial<AppConfig["limits"]>>("ai.limits", {}); const c = this.config.limits;
    const pick = (k: keyof AppConfig["limits"]) => Math.min(c[k], typeof o[k] === "number" && o[k]! > 0 ? o[k]! : c[k]);
    return { perMinute: pick("perMinute"), perDay: pick("perDay"), toolRounds: pick("toolRounds"), inputChars: pick("inputChars"), outputTokens: pick("outputTokens"), timeoutMs: pick("timeoutMs") };
  }
  setLimits(v: Partial<AppConfig["limits"]>) { const cur = this.repos.settings.get("ai.limits", {}); this.repos.settings.set("ai.limits", { ...cur, ...v }); }

  notReadyReason(): string | null {
    const g = this.config.gemini;
    if (!g.enabled) return "Gemini is switched off (GEMINI_ENABLED is not true on the server).";
    if (!g.apiKey) return "No Gemini API key is configured on the server.";
    if (!g.model) return "No Gemini model is set. Choose one in GEMINI_MODEL after checking Google's current model list.";
    if (!this.acknowledged()) return "Confirm in Settings that you have checked your Gemini account eligibility and quota before enabling it.";
    if (!this.dbEnabled()) return "Gemini is turned off in Settings.";
    return null;
  }
  circuitOpen() { return this.now() < this.openUntil; }

  /** Called before EVERY provider request (each tool round trip counts). */
  check() {
    const r = this.notReadyReason();
    if (r) throw new ProviderError(!this.config.gemini.enabled || !this.dbEnabled() ? "disabled" : !this.acknowledged() ? "not_acknowledged" : "unconfigured", r);
    if (this.circuitOpen()) throw new ProviderError("circuit_open", "Gemini has failed several times in a row, so Vera is pausing requests for a minute.", Math.ceil((this.openUntil - this.now()) / 1000));
    const lim = this.limits(); const at = new Date(this.now());
    if (this.repos.usage.minute("gemini", at) >= lim.perMinute) throw new ProviderError("rate_limited", `Vera's own limit of ${lim.perMinute} AI requests per minute was reached.`, 60 - at.getUTCSeconds());
    if (Number(this.repos.usage.day("gemini", at).requests) >= lim.perDay) throw new ProviderError("quota_exceeded", `Vera's own daily limit of ${lim.perDay} AI requests was reached. It resets at midnight UTC.`);
  }

  /** Runs one provider call with usage accounting and a small bounded retry for transient failures. */
  async run<T extends { usage: { inputTokens: number; outputTokens: number } }>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.check();
    let last: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) { this.check(); await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1))); if (signal?.aborted) throw new ProviderError("cancelled", "Cancelled."); }
      this.repos.usage.record("gemini", { r: 1 }, new Date(this.now()));
      try {
        const out = await fn(); this.failures = 0; this.openUntil = 0;
        this.repos.usage.record("gemini", { i: out.usage.inputTokens, o: out.usage.outputTokens }, new Date(this.now())); return out;
      } catch (e) {
        last = e; const pe = e instanceof ProviderError ? e : null;
        this.repos.usage.record("gemini", { f: 1 }, new Date(this.now()));
        if (pe && (pe.code === "cancelled")) throw pe;
        if (pe && !["unavailable", "timeout"].includes(pe.code)) { if (pe.code === "auth_failed") this.trip(); throw pe; }
        this.trip(); if (this.circuitOpen()) throw pe ?? e;
      }
    }
    throw last;
  }
  private trip() { this.failures++; if (this.failures >= FAILURE_THRESHOLD) { this.openUntil = this.now() + OPEN_MS; this.failures = 0; } }

  status(): AiStatus {
    const g = this.config.gemini; const reason = this.notReadyReason(); const at = new Date(this.now()); const d = this.repos.usage.day("gemini", at) as Record<string, number>;
    return {
      provider: "gemini", enabled: g.enabled && this.dbEnabled(), keyConfigured: !!g.apiKey, modelConfigured: !!g.model, model: g.model, ready: !reason, reason, circuit: this.circuitOpen() ? "open" : "closed", limits: this.limits(),
      usage: { today: { requests: d.requests ?? 0, failures: d.failures ?? 0, inputTokens: d.input_tokens ?? 0, outputTokens: d.output_tokens ?? 0 }, thisMinute: this.repos.usage.minute("gemini", at), history: this.repos.usage.history("gemini", 14) },
    };
  }
}
