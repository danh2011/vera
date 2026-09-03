import "dotenv/config";
import path from "node:path";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 3001),

  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

  DATABASE_PATH: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/vera.db"),
  WORKSPACE_PATH: path.resolve(process.cwd(), process.env.WORKSPACE_PATH ?? "./data/workspace"),

  SEARCH_PROVIDER: process.env.SEARCH_PROVIDER ?? "",
  SEARCH_API_KEY: process.env.SEARCH_API_KEY ?? "",

  WEATHER_PROVIDER: process.env.WEATHER_PROVIDER ?? "",
  WEATHER_API_KEY: process.env.WEATHER_API_KEY ?? "",
  WEATHER_DEFAULT_LOCATION: process.env.WEATHER_DEFAULT_LOCATION ?? "",

  UPDATE_REPO: process.env.UPDATE_REPO ?? "",

  DEV_MODE: bool(process.env.DEV_MODE, false),
};

export function isGeminiConfigured(): boolean {
  return env.GEMINI_API_KEY.trim().length > 0;
}
