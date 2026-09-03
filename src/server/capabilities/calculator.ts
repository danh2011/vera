import { z } from "zod";
import { Capability, CapabilityResult } from "./types.js";

/**
 * Very small, safe arithmetic evaluator (no eval()). Supports + - * / ()
 * and decimal numbers. This is intentionally minimal - deterministic math
 * only, never delegated to the AI.
 */
function safeEvaluate(expression: string): number {
  const sanitized = expression.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
    throw new Error("Expression contains unsupported characters.");
  }

  let pos = 0;
  const peek = () => sanitized[pos];
  const next = () => sanitized[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      if (op === "/" && rhs === 0) throw new Error("Division by zero.");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }
  function parseFactor(): number {
    if (peek() === "-") {
      next();
      return -parseFactor();
    }
    if (peek() === "(") {
      next();
      const value = parseExpr();
      if (next() !== ")") throw new Error("Mismatched parentheses.");
      return value;
    }
    const start = pos;
    while (pos < sanitized.length && /[0-9.]/.test(sanitized[pos])) pos++;
    if (start === pos) throw new Error("Invalid expression.");
    return parseFloat(sanitized.slice(start, pos));
  }

  const result = parseExpr();
  if (pos !== sanitized.length) throw new Error("Invalid expression.");
  return result;
}

const LENGTH_TO_M: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
};

const MASS_TO_KG: Record<string, number> = {
  mg: 0.000001,
  g: 0.001,
  kg: 1,
  lb: 0.453592,
  oz: 0.0283495,
};

const VOLUME_TO_L: Record<string, number> = {
  ml: 0.001,
  l: 1,
  gal: 3.78541,
  qt: 0.946353,
  cup: 0.24,
};

function convert(value: number, from: string, to: string): number {
  const f = from.toLowerCase();
  const t = to.toLowerCase();

  if (f === "c" && t === "f") return (value * 9) / 5 + 32;
  if (f === "f" && t === "c") return ((value - 32) * 5) / 9;
  if (f === "c" && t === "k") return value + 273.15;
  if (f === "k" && t === "c") return value - 273.15;

  for (const table of [LENGTH_TO_M, MASS_TO_KG, VOLUME_TO_L]) {
    if (f in table && t in table) {
      return (value * table[f]) / table[t];
    }
  }
  throw new Error(`Unsupported or mismatched units: ${from} -> ${to}`);
}

export const calculatorCapability: Capability = {
  name: "calculator",
  description: "Deterministic arithmetic and unit conversion (never delegated to the AI for correctness).",
  actions: [
    {
      name: "calculator_evaluate",
      description: "Evaluate an arithmetic expression, e.g. '(3 + 4) * 2 / 7'.",
      permission: "read",
      inputSchema: z.object({ expression: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { expression } = input as { expression: string };
        try {
          const result = safeEvaluate(expression);
          return { ok: true, summary: `${expression} = ${result}`, data: { result } };
        } catch (err) {
          return { ok: false, summary: "I couldn't evaluate that expression.", error: String(err) };
        }
      },
    },
    {
      name: "calculator_convert_units",
      description: "Convert a value between units (length, mass, volume, or temperature C/F/K).",
      permission: "read",
      inputSchema: z.object({ value: z.number(), from: z.string(), to: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { value, from, to } = input as { value: number; from: string; to: string };
        try {
          const result = convert(value, from, to);
          return {
            ok: true,
            summary: `${value} ${from} = ${Number(result.toFixed(4))} ${to}`,
            data: { result },
          };
        } catch (err) {
          return { ok: false, summary: "I couldn't convert those units.", error: String(err) };
        }
      },
    },
  ],
};
