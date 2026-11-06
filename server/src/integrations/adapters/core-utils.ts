import { z } from "zod";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";

/* ---------- time zones ---------- */
export function validZone(tz: string): boolean { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }
function partsIn(ts: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {}; for (const p of f.formatToParts(new Date(ts))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}
export function tzOffsetMs(ts: number, tz: string): number { const p = partsIn(ts, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000; }
/** Interprets a wall-clock time in `tz` and returns the UTC instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s); let t = guess - tzOffsetMs(guess, tz); t = guess - tzOffsetMs(t, tz); return t;
}
const fmtZone = (ts: number, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "long" }).format(new Date(ts));
const isoLocal = (ts: number, tz: string) => { const p = partsIn(ts, tz); const z = (n: number, l = 2) => String(n).padStart(l, "0"); const off = tzOffsetMs(ts, tz) / 60000; const sign = off >= 0 ? "+" : "-"; const a = Math.abs(off); return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}:${z(p.second)}${sign}${z(Math.floor(a / 60))}:${z(a % 60)}`; };

/* ---------- safe calculator (no eval) ---------- */
type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };
const FN: Record<string, (...a: number[]) => number> = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow };
export function calc(expr: string): number {
  const toks: Tok[] = []; const s = expr.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, (m, i, str) => (/[a-z]/i.test(str.slice(0, i)) ? m : ""));
  for (let i = 0; i < s.length;) {
    const c = s[i]!;
    if (/[0-9.]/.test(c)) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw new ToolError("BAD_EXPRESSION", "Invalid number."); toks.push({ t: "num", v: Number(m[0]) }); i += m[0].length; }
    else if (/[a-z]/i.test(c)) { const m = /^[a-z]+/i.exec(s.slice(i))!; toks.push({ t: "id", v: m[0].toLowerCase() }); i += m[0].length; }
    else if ("+-*/^%(),".includes(c)) { toks.push({ t: "op", v: c }); i++; }
    else throw new ToolError("BAD_EXPRESSION", `Unsupported character "${c}".`);
  }
  let p = 0; let depth = 0;
  const peek = () => toks[p]; const eat = (v: string) => { const k = toks[p]; if (k?.t === "op" && k.v === v) { p++; return true; } return false; };
  const expr_ = (): number => { let v = term(); for (;;) { if (eat("+")) v += term(); else if (eat("-")) v -= term(); else return v; } };
  const term = (): number => { let v = unary(); for (;;) { if (eat("*")) v *= unary(); else if (eat("/")) { const d = unary(); if (d === 0) throw new ToolError("DIVIDE_BY_ZERO", "Division by zero."); v /= d; } else if (eat("%")) v %= unary(); else return v; } };
  const unary = (): number => (eat("-") ? -unary() : eat("+") ? unary() : pow());
  const pow = (): number => { const b = atom(); return eat("^") ? Math.pow(b, unary()) : b; };
  const atom = (): number => {
    const k = peek(); if (!k) throw new ToolError("BAD_EXPRESSION", "Unexpected end of expression.");
    if (++depth > 50) throw new ToolError("BAD_EXPRESSION", "Expression is too deeply nested.");
    try {
      p++;
      if (k.t === "num") { const nx = toks[p + 1]; if (toks[p]?.t === "op" && (toks[p] as { v: string }).v === "%" && (!nx || (nx.t === "op" && nx.v !== "("))) { p++; return k.v / 100; } return k.v; }
      if (k.t === "id") {
        if (k.v === "pi") return Math.PI; if (k.v === "e") return Math.E;
        const fn = FN[k.v]; if (!fn) throw new ToolError("BAD_EXPRESSION", `Unknown function "${k.v}".`);
        if (!eat("(")) throw new ToolError("BAD_EXPRESSION", `Expected "(" after ${k.v}.`);
        const args: number[] = []; if (!eat(")")) { do args.push(expr_()); while (eat(",")); if (!eat(")")) throw new ToolError("BAD_EXPRESSION", "Missing ')'."); }
        return fn(...args);
      }
      if (k.v === "(") { const v = expr_(); if (!eat(")")) throw new ToolError("BAD_EXPRESSION", "Missing ')'."); return v; }
      throw new ToolError("BAD_EXPRESSION", `Unexpected "${k.v}".`);
    } finally { depth--; }
  };
  const v = expr_(); if (p < toks.length) throw new ToolError("BAD_EXPRESSION", "Unexpected input after the expression.");
  if (!Number.isFinite(v)) throw new ToolError("BAD_EXPRESSION", "The result is not a finite number.");
  return v;
}

/* ---------- unit conversion ---------- */
const U: Record<string, { dim: string; f: number; names: string[] }> = {};
const add = (dim: string, f: number, ...names: string[]) => { for (const n of names) U[n] = { dim, f, names }; };
add("length", 1, "m", "meter", "meters", "metre", "metres"); add("length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres"); add("length", 0.01, "cm", "centimeter", "centimeters"); add("length", 0.001, "mm", "millimeter", "millimeters");
add("length", 1609.344, "mi", "mile", "miles"); add("length", 0.9144, "yd", "yard", "yards"); add("length", 0.3048, "ft", "foot", "feet"); add("length", 0.0254, "in", "inch", "inches");
add("mass", 1, "kg", "kilogram", "kilograms"); add("mass", 0.001, "g", "gram", "grams"); add("mass", 0.45359237, "lb", "lbs", "pound", "pounds"); add("mass", 0.028349523125, "oz", "ounce", "ounces"); add("mass", 6.35029318, "st", "stone"); add("mass", 1000, "t", "tonne", "tonnes");
add("volume", 1, "l", "litre", "litres", "liter", "liters"); add("volume", 0.001, "ml", "millilitre", "millilitres"); add("volume", 3.785411784, "gal", "gallon", "gallons", "usgal"); add("volume", 4.54609, "ukgal"); add("volume", 0.568261485, "pint", "pints", "ukpint"); add("volume", 0.2365882365, "cup", "cups"); add("volume", 0.0147867648, "tbsp"); add("volume", 0.00492892159, "tsp");
add("speed", 1, "m/s", "mps"); add("speed", 0.277777778, "km/h", "kph", "kmh"); add("speed", 0.44704, "mph"); add("speed", 0.514444444, "kn", "knot", "knots");
add("time", 1, "s", "sec", "second", "seconds"); add("time", 60, "min", "minute", "minutes"); add("time", 3600, "h", "hr", "hour", "hours"); add("time", 86400, "day", "days", "d"); add("time", 604800, "week", "weeks");
add("data", 1, "b", "byte", "bytes"); add("data", 1e3, "kb"); add("data", 1e6, "mb"); add("data", 1e9, "gb"); add("data", 1e12, "tb"); add("data", 1024, "kib"); add("data", 1048576, "mib"); add("data", 1073741824, "gib"); add("data", 1099511627776, "tib");
add("area", 1, "m2", "sqm"); add("area", 1e6, "km2"); add("area", 0.09290304, "ft2", "sqft"); add("area", 4046.8564224, "acre", "acres"); add("area", 10000, "ha", "hectare", "hectares");
const TEMP = ["c", "f", "k", "celsius", "fahrenheit", "kelvin"];
export function convert(value: number, from: string, to: string): { value: number; dimension: string } {
  const a = from.toLowerCase().replace(/[°\s]/g, ""), b = to.toLowerCase().replace(/[°\s]/g, "");
  if (TEMP.includes(a) && TEMP.includes(b)) {
    const k = ({ c: (v: number) => v + 273.15, celsius: (v: number) => v + 273.15, f: (v: number) => (v - 32) * 5 / 9 + 273.15, fahrenheit: (v: number) => (v - 32) * 5 / 9 + 273.15, k: (v: number) => v, kelvin: (v: number) => v } as Record<string, (v: number) => number>)[a]!(value);
    const out = ({ c: (v: number) => v - 273.15, celsius: (v: number) => v - 273.15, f: (v: number) => (v - 273.15) * 9 / 5 + 32, fahrenheit: (v: number) => (v - 273.15) * 9 / 5 + 32, k: (v: number) => v, kelvin: (v: number) => v } as Record<string, (v: number) => number>)[b]!(k);
    return { value: out, dimension: "temperature" };
  }
  const x = U[a], y = U[b];
  if (!x || !y) throw new ToolError("UNKNOWN_UNIT", `I don't know the unit "${!x ? from : to}".`);
  if (x.dim !== y.dim) throw new ToolError("INCOMPATIBLE_UNITS", `Cannot convert ${x.dim} to ${y.dim}.`);
  return { value: (value * x.f) / y.f, dimension: x.dim };
}

/* ---------- natural date parsing ---------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]; const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function parseDate(text: string, tz: string, refTs = Date.now()): { ts: number; hasTime: boolean } | null {
  const s = text.toLowerCase().trim().replace(/\b(on|at|the)\b/g, " ").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ").trim();
  const ref = partsIn(refTs, tz); let y = ref.year, mo = ref.month, d = ref.day, h = 0, mi = 0, hasTime = false, dateSet = false;
  const addDays = (n: number) => { const t = new Date(Date.UTC(y, mo - 1, d + n)); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); dateSet = true; };
  let rest = s;
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midnight)\b/.exec(rest);
  if (time) {
    if (time[6]) { h = time[6] === "noon" ? 12 : 0; mi = 0; } else if (time[3]) { h = Number(time[1]) % 12 + (time[3] === "pm" ? 12 : 0); mi = Number(time[2] ?? 0); } else { h = Number(time[4]); mi = Number(time[5]); }
    hasTime = true; rest = rest.replace(time[0], " ").trim();
  }
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rest))) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; dateSet = true; }
  else if ((m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/.exec(rest))) { d = +m[1]!; mo = +m[2]!; y = +m[3]! < 100 ? 2000 + +m[3]! : +m[3]!; dateSet = true; } // day-first (UK)
  else if ((m = /\b(\d{1,2}) ([a-z]{3})[a-z]* ?(\d{4})?\b/.exec(rest)) && MONTHS.includes(m[2]!)) { d = +m[1]!; mo = MONTHS.indexOf(m[2]!) + 1; if (m[3]) y = +m[3]; dateSet = true; }
  else if ((m = /\b([a-z]{3})[a-z]* (\d{1,2}),? ?(\d{4})?\b/.exec(rest)) && MONTHS.includes(m[1]!)) { mo = MONTHS.indexOf(m[1]!) + 1; d = +m[2]!; if (m[3]) y = +m[3]; dateSet = true; }
  else if (/\btoday\b|\bnow\b/.test(rest)) { dateSet = true; if (/\bnow\b/.test(rest)) { h = ref.hour; mi = ref.minute; hasTime = true; } }
  else if (/\btomorrow\b/.test(rest)) addDays(1);
  else if (/\byesterday\b/.test(rest)) addDays(-1);
  else if ((m = /\bin (\d+) (minute|hour|day|week|month|year)s?\b/.exec(rest))) {
    const n = +m[1]!; if (m[2] === "minute" || m[2] === "hour") { return { ts: refTs + n * (m[2] === "hour" ? 3600e3 : 60e3), hasTime: true }; }
    if (m[2] === "day") addDays(n); else if (m[2] === "week") addDays(7 * n); else if (m[2] === "month") { mo += n; while (mo > 12) { mo -= 12; y++; } dateSet = true; } else { y += n; dateSet = true; }
  } else if ((m = /\b(next|last|this)? ?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(rest)) && DAYS.includes(m[2]!)) {
    const cur = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); let diff = DAYS.indexOf(m[2]!) - cur;
    if (m[1] === "last") diff = diff >= 0 ? diff - 7 : diff; else if (m[1] === "next") diff = diff <= 0 ? diff + 7 : diff; else if (diff < 0) diff += 7;
    addDays(diff);
  }
  if (!dateSet && !hasTime) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { ts: zonedToUtc(y, mo, d, h, mi, 0, tz), hasTime };
}

/* ---------- text formatting ---------- */
const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const OPS: Record<string, (t: string) => unknown> = {
  uppercase: (t) => t.toUpperCase(), lowercase: (t) => t.toLowerCase(), trim: (t) => t.replace(/[ \t]+$/gm, "").trim(),
  title: (t) => t.toLowerCase().replace(/(^|[\s\-_(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
  sentence: (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
  slug: (t) => words(t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")).join("-").toLowerCase(),
  snake_case: (t) => words(t).join("_").toLowerCase(), kebab_case: (t) => words(t).join("-").toLowerCase(),
  camel_case: (t) => words(t).map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(""),
  sort_lines: (t) => t.split("\n").sort((a, b) => a.localeCompare(b)).join("\n"), reverse_lines: (t) => t.split("\n").reverse().join("\n"),
  dedupe_lines: (t) => [...new Set(t.split("\n"))].join("\n"),
  stats: (t) => ({ characters: t.length, words: words(t).length, lines: t.split("\n").length, sentences: (t.match(/[.!?]+(\s|$)/g) ?? []).length }),
};

export default makeModule({
  manifest: {
    id: "core-utils", name: "Core utilities", version: "1.0.0", category: "utilities", icon: "calculator", defaultInstalled: true, required: true,
    description: "Time, time zones, a safe calculator, unit conversion, date parsing and text formatting. Works instantly, offline, without any AI.",
    capabilities: ["Current time", "Time-zone conversion", "Calculator", "Unit conversion", "Date parsing", "Text formatting"],
    dataAccess: ["Only the values you give each tool"], permissions: [perm("compute", "Run calculations", "Needed to answer questions about time, numbers and text.", "read", "Only the input you provide")],
    setup: { intro: "Nothing to set up. These tools run locally on this server.", requirements: [] },
    uninstall: { removes: [], keeps: [] },
  },
  tools: [
    defineTool({ name: "get_current_time", title: "Get current time", description: "Get the current date and time, optionally in a given IANA time zone (e.g. Europe/London).", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 2000,
      args: z.object({ timezone: z.string().max(64).optional() }),
      handler: async (a) => { const tz = a.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone; if (!validZone(tz)) throw new ToolError("BAD_TIMEZONE", `"${tz}" is not a valid time zone.`); const now = Date.now(); return { timezone: tz, iso: isoLocal(now, tz), utc: new Date(now).toISOString(), formatted: fmtZone(now, tz) }; } }),
    defineTool({ name: "convert_timezone", title: "Convert time zone", description: "Convert a date and time from one IANA time zone to another. datetime is local time like 2026-11-05T15:30.", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 2000,
      args: z.object({ datetime: z.string().max(40), from: z.string().max(64), to: z.string().max(64) }),
      handler: async (a) => {
        if (!validZone(a.from) || !validZone(a.to)) throw new ToolError("BAD_TIMEZONE", "Unknown time zone.");
        const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(a.datetime.trim()); if (!m) throw new ToolError("BAD_DATETIME", "Use the format YYYY-MM-DDTHH:MM.");
        const ts = zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0), a.from);
        return { from: { timezone: a.from, iso: isoLocal(ts, a.from) }, to: { timezone: a.to, iso: isoLocal(ts, a.to), formatted: fmtZone(ts, a.to) } };
      } }),
    defineTool({ name: "calculate", title: "Calculate", description: "Evaluate a maths expression: + - * / ^ % parentheses, sqrt, abs, round, floor, ceil, min, max, sin, cos, tan, ln, log, exp, pi, e.", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 1000,
      args: z.object({ expression: z.string().min(1).max(300) }), handler: async (a) => ({ expression: a.expression, result: calc(a.expression) }) }),
    defineTool({ name: "convert_units", title: "Convert units", description: "Convert between units of length, mass, volume, temperature, speed, time, data size and area.", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 1000,
      args: z.object({ value: z.number().finite(), from: z.string().max(20), to: z.string().max(20) }),
      handler: async (a) => { const r = convert(a.value, a.from, a.to); return { input: `${a.value} ${a.from}`, output: `${Number(r.value.toPrecision(10))} ${a.to}`, value: Number(r.value.toPrecision(10)), dimension: r.dimension }; } }),
    defineTool({ name: "parse_date", title: "Parse date", description: "Understand a date or time written in plain English (tomorrow, next friday 3pm, in 3 days, 5 Nov 2026, 05/11/2026 day-first).", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 1500,
      args: z.object({ text: z.string().min(1).max(100), timezone: z.string().max(64).optional() }),
      handler: async (a) => { const tz = a.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone; if (!validZone(tz)) throw new ToolError("BAD_TIMEZONE", "Unknown time zone."); const r = parseDate(a.text, tz); if (!r) throw new ToolError("UNPARSEABLE", `I couldn't understand "${a.text}" as a date.`); return { input: a.text, timezone: tz, iso: isoLocal(r.ts, tz), utc: new Date(r.ts).toISOString(), hasTime: r.hasTime, formatted: fmtZone(r.ts, tz) }; } }),
    defineTool({ name: "format_text", title: "Format text", description: "Transform text: uppercase, lowercase, title, sentence, trim, slug, snake_case, kebab_case, camel_case, sort_lines, reverse_lines, dedupe_lines, or stats (counts).", risk: "low", permission: "compute", readOnly: true, audit: "minimal", timeoutMs: 2000, maxResultBytes: 40_000,
      args: z.object({ text: z.string().max(20_000), operation: z.enum(Object.keys(OPS) as [string, ...string[]]) }), handler: async (a) => ({ operation: a.operation, result: OPS[a.operation]!(a.text) }) }),
  ],
});
