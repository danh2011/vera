import { GoogleGenAI } from "@google/genai";
import { ProviderError, type AIProvider, type AIRequest, type AIRequestOptions, type AIResponse } from "./provider.js";

export interface GeminiOptions { apiKey: string; model: string; client?: Pick<GoogleGenAI, "models"> }

/** Adapter over the official Google Gen AI SDK (@google/genai). Automatic function calling is disabled:
 *  Vera's own executor decides whether any tool runs. */
export class GeminiProvider implements AIProvider {
  readonly id = "gemini";
  private client: Pick<GoogleGenAI, "models">;
  constructor(private opts: GeminiOptions) { this.client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey }); }

  getCapabilities() { return { toolCalling: true, streaming: false, maxInputChars: 100_000 }; }
  async healthCheck() { return { ok: !!this.opts.apiKey && !!this.opts.model, message: this.opts.apiKey && this.opts.model ? "Configured (no request was made)." : "Missing API key or model." }; }

  async generateResponse(req: AIRequest, o: AIRequestOptions = {}): Promise<AIResponse> {
    if (o.signal?.aborted) throw new ProviderError("cancelled", "Cancelled.");
    try {
      const res = await this.client.models.generateContent({
        model: this.opts.model,
        contents: req.contents as never,
        config: {
          systemInstruction: req.system, maxOutputTokens: req.maxOutputTokens, temperature: 0.2,
          ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }], automaticFunctionCalling: { disable: true } } : {}),
          abortSignal: o.signal, httpOptions: { timeout: o.timeoutMs ?? 30_000 },
        },
      });
      const calls = (res.functionCalls ?? []).map((c) => ({ name: String(c.name ?? ""), args: (c.args ?? {}) as Record<string, unknown> }));
      const content = res.candidates?.[0]?.content;
      const text = calls.length ? (content?.parts ?? []).map((p) => p.text ?? "").join("") : res.text ?? "";
      return {
        text, functionCalls: calls, model: this.opts.model,
        modelContent: { role: "model", parts: (content?.parts as never) ?? (calls.length ? calls.map((c) => ({ functionCall: c })) : [{ text }]) },
        usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
      };
    } catch (e) { throw mapGeminiError(e, o.signal); }
  }
}

export function mapGeminiError(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { status?: number; name?: string; message?: string };
  if (signal?.aborted || err.name === "AbortError") return new ProviderError(signal?.reason === "timeout" ? "timeout" : "cancelled", "The request was cancelled.");
  const s = err.status;
  if (s === 429) return /quota|exceed|billing/i.test(err.message ?? "") ? new ProviderError("quota_exceeded", "Gemini reports the quota for this key is used up. Check your usage in Google AI Studio.") : new ProviderError("rate_limited", "Gemini is rate limiting requests. Try again shortly.", 30);
  if (s === 401 || s === 403) return new ProviderError("auth_failed", "Gemini rejected the API key or the account isn't permitted to use this model.");
  if (s === 400 || s === 404) return new ProviderError("invalid_request", s === 404 ? "Gemini doesn't recognise the configured model. Check GEMINI_MODEL." : "Gemini rejected the request.");
  if (/timeout|timed out|ETIMEDOUT/i.test(err.message ?? "")) return new ProviderError("timeout", "Gemini did not answer in time.");
  return new ProviderError("unavailable", "Gemini is temporarily unavailable.");
}
