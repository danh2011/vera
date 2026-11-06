import pino, { type Logger } from "pino";

/** Bounded in-memory ring of recent (already redacted) log lines, used for Vera's own diagnostics. */
export class LogRing {
  private lines: string[] = [];
  constructor(private max = 300) {}
  write(line: string) { this.lines.push(line.trimEnd().slice(0, 2000)); if (this.lines.length > this.max) this.lines.shift(); }
  tail(n: number): string[] { return this.lines.slice(-Math.max(1, Math.min(n, this.max))); }
}

export const REDACT_PATHS = [
  "req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']",
  "*.password", "*.apiKey", "*.token", "*.secret", "*.accessToken", "*.refreshToken", "*.clientSecret", "body",
];

export function createLogger(level: string, ring?: LogRing): Logger {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (ring) streams.push({ stream: { write: (s: string) => ring.write(s) } as unknown as NodeJS.WritableStream });
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[redacted]" }, base: { app: "vera" } }, pino.multistream(streams));
}
