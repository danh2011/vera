import path from "node:path";
import { z } from "zod";

const flag = z.string().optional().transform((v) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase()));
const optInt = (def: number, min: number, max: number) =>
  z.string().optional().transform((v, ctx) => {
    if (v === undefined || v.trim() === "") return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { ctx.addIssue({ code: "custom", message: `must be an integer between ${min} and ${max}` }); return z.NEVER; }
    return n;
  });
const list = z.string().optional().transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: optInt(3001, 1, 65535),
  VERA_DATA_DIR: z.string().default("./data"),
  VERA_DATABASE_PATH: z.string().optional(),
  VERA_PUBLIC_URL: z.string().url().optional(),
  VERA_ALLOWED_ORIGINS: list,
  VERA_AUTH_REQUIRED: z.string().optional(),
  VERA_TRUSTED_PROXY: flag,
  VERA_TRUSTED_PROXY_CIDRS: list,
  VERA_SETUP_TOKEN: z.string().min(12).optional(),
  VERA_SECRET_KEY: z.string().optional(),
  VERA_SECRET_KEY_FILE: z.string().optional(),
  VERA_STATIC_DIR: z.string().optional(),
  VERA_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GEMINI_ENABLED: flag,
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  VERA_MAX_REQUESTS_PER_MINUTE: optInt(10, 1, 600),
  VERA_MAX_REQUESTS_PER_DAY: optInt(200, 1, 100000),
  VERA_MAX_TOOL_ROUNDS: optInt(4, 1, 10),
  VERA_MAX_INPUT_CHARS: optInt(8000, 100, 100000),
  VERA_MAX_OUTPUT_TOKENS: optInt(1024, 16, 8192),
  VERA_AI_TIMEOUT_MS: optInt(30000, 1000, 120000),
  VERA_ALLOWED_FILE_ROOTS: list,
  VERA_ENABLE_MACHINE_READONLY: flag,
  VERA_DISK_PATHS: list,
  VERA_DOCKER_PROXY_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
});

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string; port: number;
  dataDir: string; databasePath: string; publicUrl: string; allowedOrigins: string[]; staticDir: string | null;
  trustedProxy: boolean | string[];
  setupToken: string | null;
  secretKey: string | null; secretKeyFile: string;
  logLevel: string;
  gemini: { enabled: boolean; apiKey: string | null; model: string | null };
  limits: { perMinute: number; perDay: number; toolRounds: number; inputChars: number; outputTokens: number; timeoutMs: number };
  files: { roots: string[] };
  machine: { readonly: boolean; diskPaths: string[]; dockerProxyUrl: string | null };
}

const PRIVATE_CIDRS = ["127.0.0.1/8", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError("Invalid configuration:\n" + parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === "production";
  if (e.VERA_AUTH_REQUIRED !== undefined && e.VERA_AUTH_REQUIRED.trim().toLowerCase() !== "true") {
    throw new ConfigError("VERA_AUTH_REQUIRED must be 'true'. Running Vera without authentication is not supported.");
  }
  const dataDir = path.resolve(e.VERA_DATA_DIR);
  const publicUrl = (e.VERA_PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, "");
  if (prod && !publicUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(publicUrl)) {
    throw new ConfigError("VERA_PUBLIC_URL must use https:// in production (terminate TLS at your reverse proxy).");
  }
  const nonLoopback = !["127.0.0.1", "::1", "localhost"].includes(e.HOST);
  if (prod && nonLoopback && !e.VERA_TRUSTED_PROXY && process.env.VERA_ALLOW_DIRECT_BIND !== "true" && process.env.VERA_IN_CONTAINER !== "true") {
    // Binding publicly without a proxy is allowed only when explicitly acknowledged. Containers are bound to 0.0.0.0 by design.
    throw new ConfigError("HOST is not loopback. Set VERA_TRUSTED_PROXY=true when running behind a reverse proxy, or VERA_ALLOW_DIRECT_BIND=true to acknowledge direct exposure.");
  }
  if (e.GEMINI_ENABLED && !e.GEMINI_API_KEY) {
    // Not fatal: reported as an unconfigured provider. Local features keep working.
  }
  const trusted: boolean | string[] = e.VERA_TRUSTED_PROXY ? (e.VERA_TRUSTED_PROXY_CIDRS.length ? e.VERA_TRUSTED_PROXY_CIDRS : PRIVATE_CIDRS) : false;
  return {
    env: e.NODE_ENV, host: e.HOST, port: e.PORT,
    dataDir, databasePath: path.resolve(e.VERA_DATABASE_PATH ?? path.join(dataDir, "vera.db")),
    publicUrl, allowedOrigins: [...new Set([new URL(publicUrl).origin, ...e.VERA_ALLOWED_ORIGINS.map((o) => o.replace(/\/+$/, '')), ...(prod ? [] : ["http://localhost:5173", "http://127.0.0.1:5173", `http://localhost:${e.PORT}`])])], staticDir: e.VERA_STATIC_DIR ? path.resolve(e.VERA_STATIC_DIR) : null,
    trustedProxy: trusted,
    setupToken: e.VERA_SETUP_TOKEN ?? null,
    secretKey: e.VERA_SECRET_KEY?.trim() || null,
    secretKeyFile: path.resolve(e.VERA_SECRET_KEY_FILE ?? path.join(dataDir, "secret.key")),
    logLevel: e.VERA_LOG_LEVEL,
    gemini: { enabled: e.GEMINI_ENABLED, apiKey: e.GEMINI_API_KEY?.trim() || null, model: e.GEMINI_MODEL?.trim() || null },
    limits: { perMinute: e.VERA_MAX_REQUESTS_PER_MINUTE, perDay: e.VERA_MAX_REQUESTS_PER_DAY, toolRounds: e.VERA_MAX_TOOL_ROUNDS, inputChars: e.VERA_MAX_INPUT_CHARS, outputTokens: e.VERA_MAX_OUTPUT_TOKENS, timeoutMs: e.VERA_AI_TIMEOUT_MS },
    files: { roots: e.VERA_ALLOWED_FILE_ROOTS.map((r) => path.resolve(r)) },
    machine: { readonly: e.VERA_ENABLE_MACHINE_READONLY, diskPaths: e.VERA_DISK_PATHS.length ? e.VERA_DISK_PATHS.map((p) => path.resolve(p)) : [dataDir], dockerProxyUrl: e.VERA_DOCKER_PROXY_URL ?? null },
  };
}
