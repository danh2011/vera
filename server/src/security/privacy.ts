import { newId } from "./crypto.js";
import type { Db } from "../database/db.js";

export type DataClass = "PUBLIC" | "PERSONAL" | "SENSITIVE_PERSONAL" | "FINANCIAL" | "CREDENTIAL" | "UNKNOWN";
const RANK: Record<DataClass, number> = { PUBLIC: 0, PERSONAL: 1, UNKNOWN: 2, SENSITIVE_PERSONAL: 3, CREDENTIAL: 4, FINANCIAL: 5 };
export interface Finding { category: string; cls: DataClass; start: number; end: number }
export interface Classification { cls: DataClass; findings: Finding[]; categories: string[] }
export interface Outbound { allowed: boolean; cls: DataClass; categories: string[]; text: string; reason?: string }

const MAX_SCAN = 200_000;

export function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearr = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearr) { const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97; }
  return rem === 1;
}
function entropy(s: string): number {
  const f = new Map<string, number>(); for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0; for (const n of f.values()) { const p = n / s.length; h -= p * Math.log2(p); } return h;
}

interface Rule { name: string; cls: DataClass; re: RegExp; check?: (m: RegExpExecArray, text: string) => boolean }
const FIN_WORD = "(?:bank|account|acct|card|sort\\s*code|routing|iban|swift|bic|cvv|cvc|pin)";
const RULES: Rule[] = [
  { name: "private_key", cls: "CREDENTIAL", re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "google_api_key", cls: "CREDENTIAL", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "provider_secret_key", cls: "CREDENTIAL", re: /\b(?:sk|rk|pk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{20,}\b/g },
  { name: "github_token", cls: "CREDENTIAL", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: "slack_token", cls: "CREDENTIAL", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "aws_access_key", cls: "CREDENTIAL", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "jwt", cls: "CREDENTIAL", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "bearer_token", cls: "CREDENTIAL", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { name: "secret_assignment", cls: "CREDENTIAL", re: /\b(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|passwd|password|pwd)\b["']?\s*[:=]\s*["']?[^\s"',;]{6,}/gi },
  { name: "password_phrase", cls: "CREDENTIAL", re: /\b(?:my|the|his|her|our)\s+(?:\w+\s+)?(?:password|passcode|passphrase)\s+(?:is|was|=|:)\s*\S{4,}/gi },
  { name: "url_credentials", cls: "CREDENTIAL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi },
  { name: "iban", cls: "FINANCIAL", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, check: (m) => ibanValid(m[0]) },
  { name: "payment_card", cls: "FINANCIAL", re: /(?<![A-Za-z0-9-])(?:\d[ -]?){13,19}(?![A-Za-z0-9-])/g, check: (m) => { const d = m[0].replace(/[ -]/g, ""); return d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d); } },
  { name: "sort_code_account", cls: "FINANCIAL", re: /\b\d{2}-\d{2}-\d{2}\b(?=[\s\S]{0,40}\b\d{6,8}\b)|\b\d{6,8}\b(?=[\s\S]{0,40}\b\d{2}-\d{2}-\d{2}\b)/g },
  { name: "account_number_labelled", cls: "FINANCIAL", re: new RegExp(`\\b${FIN_WORD}(?:\\s+(?:number|no\\.?|num|details|code))?\\s*(?:is|:|=|#)?\\s*\\d[\\d -]{5,20}\\d\\b`, "gi"), check: (m) => /(account|acct|sort|routing|iban|card|cvv|cvc|pin)/i.test(m[0]) },
  { name: "banking_intent", cls: "FINANCIAL", re: /\b(?:my|our)\s+(?:bank|banking|current|savings|credit card|debit card)\s+(?:account\s+)?(?:balance|transactions?|statements?|details|login|credentials)\b/gi },
  { name: "us_ssn", cls: "SENSITIVE_PERSONAL", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "uk_ni_number", cls: "SENSITIVE_PERSONAL", re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  { name: "passport_number", cls: "SENSITIVE_PERSONAL", re: /\bpassport\s*(?:no\.?|number|#)?\s*[:=]?\s*[A-Z0-9]{7,9}\b/gi },
  { name: "date_of_birth", cls: "SENSITIVE_PERSONAL", re: /\b(?:dob|date of birth|born on)\b[^\n]{0,6}\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/gi },
  { name: "medical_record", cls: "SENSITIVE_PERSONAL", re: /\b(?:my|his|her)\s+(?:diagnosis|prescription|medical records?|test results?|medication list)\b/gi },
  { name: "email", cls: "PERSONAL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: "phone", cls: "PERSONAL", re: /(?<!\d)(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)\d{3,4}[ -]?\d{3,4}(?!\d)/g, check: (m) => m[0].replace(/\D/g, "").length >= 10 && m[0].replace(/\D/g, "").length <= 13 && /[ +()-]/.test(m[0]) },
];

export interface ExtraPattern { name: string; pattern: string; cls: DataClass }

export class PrivacyGateway {
  private extra: Rule[] = [];
  constructor(private db: Db | null = null, extra: ExtraPattern[] = []) { this.setExtraPatterns(extra); }

  setExtraPatterns(list: ExtraPattern[]) {
    this.extra = [];
    for (const p of list.slice(0, 50)) {
      if (!p.pattern || p.pattern.length > 200 || !(p.cls in RANK)) continue;
      try { this.extra.push({ name: `custom:${p.name.slice(0, 40)}`, cls: p.cls, re: new RegExp(p.pattern, "gi") }); } catch { /* ignore invalid pattern */ }
    }
  }

  classify(input: string): Classification {
    // Identifiers that are random-looking by design (UUIDs) must not trip digit-based rules. Same length keeps offsets valid.
    const text = (input.length > MAX_SCAN ? input.slice(0, MAX_SCAN) : input).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (m) => "x".repeat(m.length));
    const findings: Finding[] = [];
    for (const rule of [...RULES, ...this.extra]) {
      rule.re.lastIndex = 0; let m: RegExpExecArray | null; let guard = 0;
      while ((m = rule.re.exec(text)) && guard++ < 500) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue; }
        if (rule.check && !rule.check(m, text)) continue;
        findings.push({ category: rule.name, cls: rule.cls, start: m.index, end: m.index + m[0].length });
      }
    }
    // Unknown high-entropy tokens: conservative handling for secrets that match no known pattern.
    for (const m of text.matchAll(/[A-Za-z0-9_\-+/=]{32,}/g)) {
      const t = m[0]; const i = m.index ?? 0;
      if ((t.match(/\//g) ?? []).length >= 2 || text.slice(Math.max(0, i - 8), i).includes("://")) continue;
      if (/[A-Za-z]/.test(t) && /\d/.test(t) && entropy(t) >= 3.8 && !findings.some((f) => f.start <= i && f.end >= i + t.length)) findings.push({ category: "high_entropy_token", cls: "UNKNOWN", start: i, end: i + t.length });
    }
    let cls: DataClass = "PUBLIC";
    for (const f of findings) if (RANK[f.cls] > RANK[cls]) cls = f.cls;
    return { cls, findings, categories: [...new Set(findings.map((f) => f.category))] };
  }

  redact(text: string, findings: Finding[], only?: (f: Finding) => boolean): string {
    const spans = findings.filter((f) => !only || only(f)).sort((a, b) => a.start - b.start);
    let out = "", pos = 0;
    for (const f of spans) { if (f.start < pos) { pos = Math.max(pos, f.end); continue; } out += text.slice(pos, f.start) + `[REDACTED:${f.category}]`; pos = f.end; }
    return out + text.slice(pos);
  }

  /**
   * Gate for any text that would enter a cloud model context or a cloud-bound tool.
   * FINANCIAL, CREDENTIAL and SENSITIVE_PERSONAL are blocked (fail closed); UNKNOWN is redacted; PERSONAL passes.
   * Records minimal metadata only: never the payload.
   */
  checkOutbound(text: string, meta: { userId?: string | null; source: string; requestId?: string }): Outbound {
    const c = this.classify(text);
    const blocked = c.cls === "FINANCIAL" || c.cls === "CREDENTIAL" || c.cls === "SENSITIVE_PERSONAL";
    if (c.cls !== "PUBLIC" && c.cls !== "PERSONAL") this.record(meta, c, blocked);
    if (blocked) return { allowed: false, cls: c.cls, categories: c.categories, text: this.redact(text, c.findings, (f) => RANK[f.cls] >= RANK.UNKNOWN), reason: reasonFor(c.cls) };
    if (c.cls === "UNKNOWN") return { allowed: true, cls: c.cls, categories: c.categories, text: this.redact(text, c.findings, (f) => f.cls === "UNKNOWN") };
    return { allowed: true, cls: c.cls, categories: c.categories, text };
  }

  /** Deep-sanitises a tool result before it can enter model context. Blocked strings are replaced, not forwarded. */
  sanitizeForModel<T>(value: T, meta: { userId?: string | null; source: string; requestId?: string }): { value: T; withheld: number } {
    let withheld = 0;
    const walk = (v: unknown, depth: number): unknown => {
      if (depth > 8) return "[truncated]";
      if (typeof v === "string") { const o = this.checkOutbound(v, meta); if (!o.allowed) { withheld++; return "[withheld by privacy policy]"; } return o.text; }
      if (Array.isArray(v)) return v.slice(0, 200).map((x) => walk(x, depth + 1));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 100).map(([k, x]) => [k, walk(x, depth + 1)]));
      return v;
    };
    return { value: walk(value, 0) as T, withheld };
  }

  private record(meta: { userId?: string | null; source: string; requestId?: string }, c: Classification, blocked: boolean) {
    if (!this.db) return;
    try { this.db.prepare("INSERT INTO privacy_events (id,user_id,direction,source,classification,blocked,categories,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(newId(), meta.userId ?? null, "outbound", meta.source, c.cls, blocked ? 1 : 0, c.categories.join(","), meta.requestId ?? null, new Date().toISOString()); } catch { /* never fail the request on telemetry */ }
  }
}

export function reasonFor(cls: DataClass): string {
  switch (cls) {
    case "FINANCIAL": return "This looks like banking or payment information. Vera never sends financial data to a cloud AI or to cloud tools.";
    case "CREDENTIAL": return "This looks like a password, key or token. Vera never sends credentials to a cloud AI.";
    case "SENSITIVE_PERSONAL": return "This looks like sensitive personal information (such as an identity or medical detail). Cloud transmission of this is blocked by default.";
    default: return "This content was held back by Vera's privacy policy.";
  }
}
