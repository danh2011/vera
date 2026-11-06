import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type BuiltApp, type BuildOptions } from "../server/src/app.js";
import type { AIProvider, AIRequest, AIResponse } from "../server/src/ai/provider.js";
import { loadConfig } from "../server/src/config.js";

export const PASSWORD = "correct horse battery staple";
export interface Ctx extends BuiltApp { dir: string; filesDir: string; cookie: string; csrf: string; userId: string }

export function tmp(prefix = "vera-test-"): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export async function makeApp(env: Record<string, string> = {}, opts: BuildOptions = {}): Promise<BuiltApp & { dir: string; filesDir: string }> {
  const dir = tmp(); const filesDir = path.join(dir, "files"); fs.mkdirSync(filesDir);
  const config = loadConfig({ NODE_ENV: "test", VERA_DATA_DIR: dir, VERA_ALLOWED_FILE_ROOTS: filesDir, VERA_ENABLE_MACHINE_READONLY: "true", VERA_SETUP_TOKEN: "setup-token-123456", VERA_LOG_LEVEL: "silent", ...env } as NodeJS.ProcessEnv);
  const b = await buildApp(config, { memoryDb: true, silent: true, ...opts });
  return Object.assign(b, { dir, filesDir });
}

export async function signedIn(env: Record<string, string> = {}, opts: BuildOptions = {}): Promise<Ctx> {
  const b = await makeApp(env, opts);
  const r = await b.app.inject({ method: "POST", url: "/api/v1/setup/owner", payload: { username: "owner", password: PASSWORD, setupCode: "setup-token-123456" } });
  if (r.statusCode !== 201) throw new Error("setup failed " + r.body);
  const cookie = `${r.cookies[0]!.name}=${r.cookies[0]!.value}`; const csrf = r.json().csrfToken as string;
  const userId = b.deps.repos.users.first()!.id;
  return Object.assign(b, { cookie, csrf, userId });
}

export function call(c: Ctx, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return c.app.inject({ method, url: `/api/v1${url}`, payload: payload as never, headers: { cookie: c.cookie, "x-csrf-token": c.csrf, ...headers } });
}

export class FakeProvider implements AIProvider {
  readonly id = "gemini"; calls: AIRequest[] = []; script: (((req: AIRequest) => Partial<AIResponse> | Error) | Error)[] = [];
  getCapabilities() { return { toolCalling: true, streaming: false, maxInputChars: 100000 }; }
  async healthCheck() { return { ok: true, message: "fake" }; }
  async generateResponse(req: AIRequest): Promise<AIResponse> {
    this.calls.push(structuredClone(req));
    const step = this.script.shift(); const out = step ? (typeof step === "function" ? step(req) : step) : { text: "ok" };
    if (out instanceof Error) throw out;
    const text = out.text ?? ""; const functionCalls = out.functionCalls ?? [];
    return { text, functionCalls, modelContent: { role: "model", parts: functionCalls.length ? functionCalls.map((f) => ({ functionCall: f })) : [{ text }] }, usage: { inputTokens: 10, outputTokens: 5 }, model: "test-model", ...out };
  }
}

export async function aiReadyCtx(provider: FakeProvider, env: Record<string, string> = {}) {
  const c = await signedIn({ GEMINI_ENABLED: "true", GEMINI_API_KEY: "test-key-not-real", GEMINI_MODEL: "test-model", ...env }, { provider });
  c.guard.acknowledge(true); return c;
}
