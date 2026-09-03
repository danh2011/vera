import { z } from "zod";
import { Capability, CapabilityResult } from "./types.js";
import { env } from "../env.js";

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

async function geocode(location: string): Promise<GeoResult | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const first = data?.results?.[0];
  if (!first) return null;
  return { name: first.name, latitude: first.latitude, longitude: first.longitude, country: first.country };
}

const WEATHER_CODES: Record<number, string> = {
  0: "Clear skies",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

async function openMeteoWeather(location: string) {
  const geo = await geocode(location);
  if (!geo) throw new Error("Location not found");
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m`,
  );
  if (!res.ok) throw new Error(`Weather provider returned ${res.status}`);
  const data = (await res.json()) as any;
  const current = data.current;
  return {
    location: geo.country ? `${geo.name}, ${geo.country}` : geo.name,
    temperatureC: current.temperature_2m,
    conditions: WEATHER_CODES[current.weather_code] ?? "Unknown",
    humidity: current.relative_humidity_2m,
    windSpeedKmh: current.wind_speed_10m,
  };
}

async function openWeatherMap(location: string) {
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=metric&appid=${env.WEATHER_API_KEY}`,
  );
  if (!res.ok) throw new Error(`Weather provider returned ${res.status}`);
  const data = (await res.json()) as any;
  return {
    location: `${data.name}, ${data.sys?.country ?? ""}`.trim(),
    temperatureC: data.main.temp,
    conditions: data.weather?.[0]?.description ?? "Unknown",
    humidity: data.main.humidity,
    windSpeedKmh: data.wind.speed * 3.6,
  };
}

export const weatherCapability: Capability = {
  name: "weather",
  description: "Provides current weather for a given (or default) location.",
  actions: [
    {
      name: "weather_current",
      description: "Get the current weather for a location.",
      permission: "read",
      inputSchema: z.object({ location: z.string().optional() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { location } = input as { location?: string };
        const target = location || env.WEATHER_DEFAULT_LOCATION;
        if (!target) {
          return {
            ok: false,
            summary: "Which location? I don't have a default set (WEATHER_DEFAULT_LOCATION).",
            error: "missing_location",
          };
        }
        try {
          const result =
            env.WEATHER_PROVIDER === "openweathermap" && env.WEATHER_API_KEY
              ? await openWeatherMap(target)
              : await openMeteoWeather(target);
          return {
            ok: true,
            summary: `${result.location}: ${Math.round(result.temperatureC)}°C, ${result.conditions}`,
            data: result,
          };
        } catch (err) {
          return { ok: false, summary: "I couldn't get the weather right now.", error: String(err) };
        }
      },
    },
  ],
};
