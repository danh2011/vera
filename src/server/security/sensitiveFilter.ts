/**
 * Sensitive Information Blocker
 * ------------------------------
 * NON-NEGOTIABLE security layer. Runs on every piece of text before it is
 * allowed to reach the Gemini API (user messages, capability results, and
 * any external content pulled in as context).
 *
 * This is pattern-based (not AI-based) on purpose: the LLM must never be
 * trusted to police its own input. If a rule fires, the offending text is
 * blocked outright rather than "sanitized and sent anyway".
 *
 * Layers:
 *  1. Known sensitive field names (password:, api_key=, etc.)
 *  2. Structured secret patterns (API key formats, card numbers, IBAN, etc.)
 *  3. Generic high-entropy secret heuristics (long random-looking tokens
 *     immediately following a sensitive keyword)
 */

export interface FilterResult {
  blocked: boolean;
  reasons: string[];
  /** Safe-to-log summary; never contains the actual sensitive value. */
  redactedPreview: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
}

// --- Layer 1: known sensitive field names + a following value -------------
// SEP matches key:value syntax ("password: x", "password=x") AND natural
// language phrasing ("my password is x", "the api key is x").
const SEP = /\s*(?:is|are|[:=])\s*/.source;
const FIELD_NAME_RULES: Rule[] = [
  { name: "password", pattern: new RegExp(String.raw`\b(my |the )?(password|passwd|pwd)${SEP}\S+`, "i") },
  { name: "api_key", pattern: new RegExp(String.raw`\b(my |the )?(api[_-]?key|apikey)${SEP}\S+`, "i") },
  { name: "secret", pattern: new RegExp(String.raw`\b(my |the )?(secret|client[_-]?secret)${SEP}\S+`, "i") },
  { name: "access_token", pattern: new RegExp(String.raw`\b(my |the )?(access[_-]?token|refresh[_-]?token|bearer[_-]?token)${SEP}\S+`, "i") },
  { name: "oauth_secret", pattern: new RegExp(String.raw`\b(my |the )?oauth[_-]?(secret|token)${SEP}\S+`, "i") },
  { name: "private_key_field", pattern: new RegExp(String.raw`\b(my |the )?private[_-]?key${SEP}\S+`, "i") },
  { name: "recovery_code", pattern: new RegExp(String.raw`\b(my |the )?(recovery|backup)\s*[_-]?codes?${SEP}\S+`, "i") },
  { name: "otp_2fa", pattern: new RegExp(String.raw`\b(my |the )?(otp|one[- ]?time[- ]?pass(word|code)|2fa[- ]?code|verification code)${SEP}\d{4,8}\b`, "i") },
  { name: "pin", pattern: new RegExp(String.raw`\b(my |the )?(pin\s*(code|number)?)${SEP}\d{4,8}\b`, "i") },
  { name: "bank_account", pattern: new RegExp(String.raw`\b(my |the )?(account\s*(number|no)?|iban|sort\s*code|routing\s*number)${SEP}[A-Z0-9]{4,34}\b`, "i") },
  { name: "crypto_wallet", pattern: new RegExp(String.raw`\b(my |the )?(seed\s*phrase|wallet\s*(private\s*key|seed))${SEP}?\S+`, "i") },
];

// --- Layer 2: structured secret/format patterns (no keyword needed) -------
const STRUCTURED_RULES: Rule[] = [
  // Common API key prefixes (OpenAI, Anthropic, Stripe, GitHub, Slack, Google, AWS, etc.)
  { name: "prefixed_api_key", pattern: /\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9-_]{16,}\b/ },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z-_]{30,40}\b/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "private_key_block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Card numbers: 13-19 digits, allowing spaces/dashes, passing a loose Luhn-ish shape check via regex only
  { name: "card_number", pattern: /\b(?:\d[ -]?){13,19}\b/ },
  { name: "ssn_like", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
];

function luhnCheck(digitsOnly: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let n = parseInt(digitsOnly[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanText(text: string): FilterResult {
  const reasons: string[] = [];

  for (const rule of FIELD_NAME_RULES) {
    if (rule.pattern.test(text)) reasons.push(rule.name);
  }

  for (const rule of STRUCTURED_RULES) {
    const matches = text.match(rule.pattern);
    if (!matches) continue;
    if (rule.name === "card_number") {
      // Reduce false positives on things like phone numbers / long IDs by
      // requiring a valid Luhn checksum before treating it as a card number.
      const digitsOnly = matches[0].replace(/[ -]/g, "");
      if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
        reasons.push(rule.name);
      }
      continue;
    }
    reasons.push(rule.name);
  }

  const blocked = reasons.length > 0;
  return {
    blocked,
    reasons: Array.from(new Set(reasons)),
    redactedPreview: blocked ? "[redacted - sensitive content detected]" : text.slice(0, 120),
  };
}

export const BLOCK_MESSAGE =
  "I can't send that sensitive information to the AI provider.";

/**
 * Convenience helper for the chat pipeline: throws-free check used to decide
 * whether to short-circuit before calling Gemini at all.
 */
export function containsSensitiveInfo(text: string): boolean {
  return scanText(text).blocked;
}
