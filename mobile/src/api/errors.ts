export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); this.name = "ApiError"; }
}
export class ConnectionError extends Error {
  constructor(host?: string, reason: "unreachable" | "timeout" = "unreachable") {
    super(reason === "timeout"
      ? `The Vera server${host ? ` at ${host}` : ""} took too long to answer. Check your connection and try again.`
      : `Can't reach the Vera server${host ? ` at ${host}` : ""}. Check that you're on the right network (or VPN) and that Vera is running.`);
    this.name = "ConnectionError";
  }
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
export const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
