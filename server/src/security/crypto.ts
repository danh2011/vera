import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const newId = () => crypto.randomUUID();
export function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest(); const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * AES-256-GCM envelope for integration credentials and OAuth tokens.
 * The key lives OUTSIDE the SQLite file: VERA_SECRET_KEY (base64, 32 bytes) or a 0600 key file.
 * Losing the key makes stored credentials unrecoverable (users re-enter them); see docs/security.md.
 */
export class SecretBox {
  constructor(private key: Buffer) { if (key.length !== 32) throw new Error("Secret key must be exactly 32 bytes."); }

  static fromConfig(cfg: Pick<AppConfig, "secretKey" | "secretKeyFile">): SecretBox {
    if (cfg.secretKey) {
      const k = Buffer.from(cfg.secretKey, "base64");
      if (k.length !== 32) throw new Error("VERA_SECRET_KEY must be 32 bytes, base64-encoded (generate with: openssl rand -base64 32).");
      return new SecretBox(k);
    }
    if (fs.existsSync(cfg.secretKeyFile)) {
      const k = Buffer.from(fs.readFileSync(cfg.secretKeyFile, "utf8").trim(), "base64");
      return new SecretBox(k);
    }
    fs.mkdirSync(path.dirname(cfg.secretKeyFile), { recursive: true, mode: 0o700 });
    const k = crypto.randomBytes(32);
    fs.writeFileSync(cfg.secretKeyFile, k.toString("base64") + "\n", { mode: 0o600, flag: "wx" });
    return new SecretBox(k);
  }

  encrypt(plain: string, aad: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv); c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]).toString("base64");
  }
  decrypt(blob: string, aad: string): string {
    const b = Buffer.from(blob, "base64");
    if (b[0] !== 1) throw new Error("Unsupported secret format");
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, b.subarray(1, 13)); d.setAAD(Buffer.from(aad)); d.setAuthTag(b.subarray(13, 29));
    return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8");
  }
}
