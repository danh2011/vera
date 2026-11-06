export type ProviderErrorCode = "unconfigured" | "disabled" | "not_acknowledged" | "rate_limited" | "quota_exceeded" | "unavailable" | "circuit_open" | "timeout" | "cancelled" | "auth_failed" | "invalid_request" | "blocked";

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public retryAfterSeconds?: number) { super(message); }
}

export interface AIToolDecl { name: string; description: string; parameters: Record<string, unknown> }
export interface AIPart { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }
export interface AIMessage { role: "user" | "model"; parts: AIPart[] }
export interface AIRequest { system: string; contents: AIMessage[]; tools: AIToolDecl[]; maxOutputTokens: number }
export interface AIRequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface AIResponse { text: string; functionCalls: { name: string; args: Record<string, unknown> }[]; modelContent: AIMessage; usage: { inputTokens: number; outputTokens: number }; model: string }
export interface AIProviderCapabilities { toolCalling: boolean; streaming: boolean; maxInputChars: number }
export interface ProviderHealth { ok: boolean; message: string }

export interface AIProvider {
  readonly id: string;
  generateResponse(request: AIRequest, options?: AIRequestOptions): Promise<AIResponse>;
  getCapabilities(): AIProviderCapabilities;
  /** Local-only check: never makes a billable request. */
  healthCheck(): Promise<ProviderHealth>;
}
