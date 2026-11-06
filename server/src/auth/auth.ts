import crypto from "node:crypto";
import { argon2Verify, argon2id } from "hash-wasm";
import type { AppConfig } from "../config.js";
import type { Repos, UserRow } from "../database/repos.js";
import { randomToken, safeEqual, sha256 } from "../security/crypto.js";

export const COOKIE = "vera_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
/** Argon2id via WebAssembly (hash-wasm): no native binary, so it installs on any OS/Node version. OWASP-minimum cost (19 MiB, 2 passes). */
const hashPw = (password: string) => argon2id({ password, salt: crypto.randomBytes(16), parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: "encoded" });
const verifyPw = (password: string, hash: string) => argon2Verify({ password, hash });

export class AuthError extends Error { constructor(public code: string, message: string, public status = 401, public retryAfter?: number) { super(message); } }

export function passwordProblem(pw: string, username?: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 256) return "That password is too long.";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "The password must not contain your username.";
  if (new Set(pw).size < 5) return "Use a more varied password.";
  return null;
}

/** In-memory brute-force limiter, per client address and per username. Bounded size. */
export class LoginLimiter {
  private m = new Map<string, { fails: number; until: number; first: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000, private now: () => number = Date.now) {}
  check(...keys: string[]) { for (const k of keys) { const e = this.m.get(k); if (e && e.until > this.now()) throw new AuthError("TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again later.", 429, Math.ceil((e.until - this.now()) / 1000)); } }
  fail(...keys: string[]) {
    if (this.m.size > 5000) this.m.clear();
    for (const k of keys) { let e = this.m.get(k); if (!e || this.now() - e.first > this.windowMs) e = { fails: 0, until: 0, first: this.now() }; e.fails++; if (e.fails >= this.max) e.until = this.now() + this.windowMs; this.m.set(k, e); }
  }
  success(...keys: string[]) { for (const k of keys) this.m.delete(k); }
}

export class AuthService {
  readonly limiter = new LoginLimiter();
  private setupToken: string; private dummy: Promise<string>;
  constructor(private config: AppConfig, private repos: Repos) {
    this.setupToken = config.setupToken ?? randomToken(12);
    this.dummy = hashPw("dummy-password-for-timing");
  }
  get generatedSetupToken(): string | null { return this.config.setupToken ? null : this.setupToken; }
  ownerExists() { return this.repos.users.count() > 0; }

  async createOwner(username: string, password: string, token: string, ip: string): Promise<UserRow> {
    this.limiter.check("setup:" + ip);
    if (this.ownerExists()) throw new AuthError("SETUP_COMPLETE", "Setup has already been completed.", 409);
    if (!safeEqual(token, this.setupToken)) { this.limiter.fail("setup:" + ip); throw new AuthError("BAD_SETUP_TOKEN", "That setup code is not correct. It is printed in the server log when Vera starts.", 403); }
    const problem = passwordProblem(password, username); if (problem) throw new AuthError("WEAK_PASSWORD", problem, 422);
    try { return this.repos.users.create(username, await hashPw(password)); }
    catch { throw new AuthError("SETUP_COMPLETE", "Setup has already been completed.", 409); }
  }

  async login(username: string, password: string, ip: string, ua: string | null) {
    const keys = ["ip:" + ip, "user:" + username.toLowerCase()]; this.limiter.check(...keys);
    const user = this.repos.users.byUsername(username);
    const ok = await verifyPw(password, user?.passwordHash ?? (await this.dummy)).catch(() => false);
    if (!user || !ok) { this.limiter.fail(...keys); throw new AuthError("INVALID_CREDENTIALS", "Incorrect username or password."); }
    this.limiter.success(...keys);
    return { user, ...this.startSession(user.id, ua) };
  }
  startSession(userId: string, ua: string | null) {
    const token = randomToken(32); const csrf = randomToken(24);
    this.repos.sessions.create(sha256(token), userId, csrf, SESSION_TTL_MS, ua);
    return { token, csrf, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  }
  resolve(token: string | undefined) {
    if (!token || token.length > 200) return null;
    const hash = sha256(token); const s = this.repos.sessions.get(hash); if (!s) return null;
    const user = this.repos.users.byId(s.userId); if (!user) return null;
    if (Date.now() - new Date(s.lastSeenAt).getTime() > 60_000) this.repos.sessions.touch(hash);
    return { user, session: s, hash };
  }
  logout(token: string | undefined) { if (token) this.repos.sessions.revoke(sha256(token)); }
  async changePassword(userId: string, current: string, next: string, keepHash: string) {
    const u = this.repos.users.byId(userId); if (!u || !(await verifyPw(current, u.passwordHash).catch(() => false))) throw new AuthError("INVALID_CREDENTIALS", "Your current password is not correct.", 403);
    const p = passwordProblem(next, u.username); if (p) throw new AuthError("WEAK_PASSWORD", p, 422);
    this.repos.users.setPassword(userId, await hashPw(next)); return this.repos.sessions.revokeOthers(userId, keepHash);
  }
  async resetPassword(userId: string, next: string) { const p = passwordProblem(next); if (p) throw new Error(p); this.repos.users.setPassword(userId, await hashPw(next)); this.repos.sessions.revokeAll(userId); }
}
