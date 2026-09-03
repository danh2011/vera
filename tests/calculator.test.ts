import { describe, it, expect } from "vitest";
import { calculatorCapability } from "../src/server/capabilities/calculator.js";

const evaluate = calculatorCapability.actions.find((a) => a.name === "calculator_evaluate")!;
const convert = calculatorCapability.actions.find((a) => a.name === "calculator_convert_units")!;

describe("calculator capability", () => {
  it("evaluates arithmetic correctly", async () => {
    const result = await evaluate.execute({ expression: "(3 + 4) * 2" });
    expect(result.ok).toBe(true);
    expect((result.data as any).result).toBe(14);
  });

  it("rejects unsafe input", async () => {
    const result = await evaluate.execute({ expression: "console.log(1)" });
    expect(result.ok).toBe(false);
  });

  it("converts units", async () => {
    const result = await convert.execute({ value: 100, from: "cm", to: "m" });
    expect(result.ok).toBe(true);
    expect((result.data as any).result).toBe(1);
  });

  it("converts temperature", async () => {
    const result = await convert.execute({ value: 0, from: "c", to: "f" });
    expect(result.ok).toBe(true);
    expect((result.data as any).result).toBe(32);
  });
});
