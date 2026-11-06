import type { VeraApi } from "./api";
import { HttpVeraApi } from "./http";
import { MockVeraApi } from "./mock";

/**
 * Production always talks to the real backend. The in-memory demo API exists for development and tests and must be
 * requested explicitly (VITE_VERA_API=mock); it is refused outright in production builds so fake data can never appear.
 */
export function createApi(mode: string | undefined = import.meta.env.VITE_VERA_API, production: boolean = import.meta.env.PROD): VeraApi {
  if (mode === "mock") {
    if (production) throw new Error("The mock API is disabled in production builds.");
    return new MockVeraApi();
  }
  if (mode === undefined || mode === "" || mode === "http") return new HttpVeraApi();
  throw new Error(`Unsupported VITE_VERA_API "${mode}". Use "http" (default) or, in development only, "mock".`);
}
