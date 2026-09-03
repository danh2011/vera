import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { env, isGeminiConfigured } from "../env.js";
import { allActions } from "../capabilities/types.js";
import { z } from "zod";

/**
 * This is the ONLY module that talks to Gemini. If Vera ever supports other
 * providers, only this file (and its call sites) should need to change.
 */

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  if (!client) client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return client;
}

// --- Very small zod -> Gemini schema converter (covers what our actions use)
function zodToGeminiSchema(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const field = shape[key];
      properties[key] = zodToGeminiSchema(field);
      if (!field.isOptional() && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: SchemaType.OBJECT, properties, required };
  }
  if (schema instanceof z.ZodOptional) return zodToGeminiSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return zodToGeminiSchema(schema.removeDefault());
  if (schema instanceof z.ZodString) return { type: SchemaType.STRING };
  if (schema instanceof z.ZodNumber) return { type: SchemaType.NUMBER };
  if (schema instanceof z.ZodBoolean) return { type: SchemaType.BOOLEAN };
  if (schema instanceof z.ZodEnum) return { type: SchemaType.STRING, enum: schema.options };
  return { type: SchemaType.STRING };
}

export function buildFunctionDeclarations(): FunctionDeclaration[] {
  return allActions().map(({ action }) => ({
    name: action.name,
    description: action.description,
    parameters: zodToGeminiSchema(action.inputSchema),
  }));
}

export interface GeminiTurnInput {
  systemInstruction: string;
  history: any[];
  userText: string;
}

export interface GeminiFunctionCall {
  name: string;
  args: unknown;
}

export interface GeminiTurnOutput {
  text: string | null;
  functionCalls: GeminiFunctionCall[];
}

export async function callGemini(input: GeminiTurnInput): Promise<GeminiTurnOutput> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: input.systemInstruction,
    tools: [{ functionDeclarations: buildFunctionDeclarations() }],
  });

  const chat = model.startChat({ history: input.history as any });
  const result = await chat.sendMessage(input.userText);
  const response = result.response;

  const functionCalls = (response.functionCalls() ?? []).map((fc) => ({ name: fc.name, args: fc.args }));
  const text = functionCalls.length > 0 ? null : response.text();

  return { text, functionCalls };
}

/**
 * Sends function results back to Gemini in the same turn and returns the
 * follow-up natural-language response.
 */
export async function callGeminiWithFunctionResults(
  input: GeminiTurnInput,
  functionResults: { name: string; response: unknown }[],
): Promise<GeminiTurnOutput> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: input.systemInstruction,
    tools: [{ functionDeclarations: buildFunctionDeclarations() }],
  });

  const chat = model.startChat({ history: input.history as any });
  const result = await chat.sendMessage(
    functionResults.map((fr) => ({ functionResponse: { name: fr.name, response: fr.response as object } })) as any,
  );
  const response = result.response;
  const functionCalls = (response.functionCalls() ?? []).map((fc) => ({ name: fc.name, args: fc.args }));
  const text = functionCalls.length > 0 ? null : response.text();
  return { text, functionCalls };
}

export async function checkGeminiHealth(): Promise<boolean> {
  if (!isGeminiConfigured()) return false;
  try {
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
    await model.generateContent("ping");
    return true;
  } catch {
    return false;
  }
}
