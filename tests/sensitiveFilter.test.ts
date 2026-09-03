import { describe, it, expect } from "vitest";
import { scanText, containsSensitiveInfo } from "../src/server/security/sensitiveFilter.js";

describe("sensitive information blocker", () => {
  it("blocks natural-language passwords", () => {
    expect(containsSensitiveInfo("my password is hunter2secret123")).toBe(true);
    expect(containsSensitiveInfo("the password is Sw0rdfish!")).toBe(true);
    expect(containsSensitiveInfo("password: abc123XYZ")).toBe(true);
  });

  it("blocks API keys by keyword and by known formats", () => {
    expect(containsSensitiveInfo("my api key is sk-test1234567890abcdef")).toBe(true);
    expect(containsSensitiveInfo("sk-ant-api03-abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(containsSensitiveInfo("here's my token ghp_1234567890abcdefghij1234567890")).toBe(true);
    expect(containsSensitiveInfo("AIzaSyD-1234567890abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("blocks AWS access keys and JWTs", () => {
    expect(containsSensitiveInfo("AKIAABCDEFGHIJKLMNOP")).toBe(true);
    expect(
      containsSensitiveInfo(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQmR9k7-abcdefghijklmno",
      ),
    ).toBe(true);
  });

  it("blocks private key blocks", () => {
    expect(containsSensitiveInfo("-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...")).toBe(true);
  });

  it("blocks valid credit card numbers (Luhn-valid) but not random long digit strings", () => {
    expect(containsSensitiveInfo("4111 1111 1111 1111")).toBe(true); // valid test Visa number
    expect(containsSensitiveInfo("order number 1234567890123456789")).toBe(false); // fails luhn
  });

  it("blocks bank account / IBAN phrasing", () => {
    expect(containsSensitiveInfo("my account number is GB29NWBK60161331926819")).toBe(true);
    expect(containsSensitiveInfo("sort code: 123456")).toBe(true);
  });

  it("blocks 2FA/OTP codes and PINs", () => {
    expect(containsSensitiveInfo("my 2fa code is 483920")).toBe(true);
    expect(containsSensitiveInfo("the pin is 4821")).toBe(true);
  });

  it("blocks SSNs", () => {
    expect(containsSensitiveInfo("123-45-6789")).toBe(true);
  });

  it("does NOT block ordinary safe messages", () => {
    expect(containsSensitiveInfo("What's on my calendar tomorrow?")).toBe(false);
    expect(containsSensitiveInfo("Remember that I prefer AMD CPUs.")).toBe(false);
    expect(containsSensitiveInfo("Search the web for the latest Ryzen 5 7600 prices.")).toBe(false);
    expect(containsSensitiveInfo("Can you set a timer for 10 minutes?")).toBe(false);
    expect(containsSensitiveInfo("My favorite number is 42.")).toBe(false);
  });

  it("never includes the raw sensitive value in the redacted preview", () => {
    const result = scanText("my password is TopSecret123!");
    expect(result.blocked).toBe(true);
    expect(result.redactedPreview).not.toContain("TopSecret123");
  });
});
