import { z } from "zod";
import { Capability, CapabilityResult } from "./types.js";
import { env } from "../env.js";

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function braveSearch(query: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { "X-Subscription-Token": env.SEARCH_API_KEY, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Brave Search API returned ${res.status}`);
  const data = (await res.json()) as any;
  const results = data?.web?.results ?? [];
  return results.slice(0, 5).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));
}

// Fallback: DuckDuckGo instant answer API (no API key required)
async function duckduckgoFallback(query: string): Promise<SearchHit[]> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const hits: SearchHit[] = [];

    // Try to use related links
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text && topic.FirstURL) {
          hits.push({
            title: topic.Text,
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }

    return hits;
  } catch {
    return [];
  }
}

export const webSearchCapability: Capability = {
  name: "web_search",
  description: "Searches the web and returns concise results.",
  actions: [
    {
      name: "web_search_query",
      description: "Search the web for a query and return a short list of results.",
      permission: "read",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { query } = input as { query: string };

        try {
          let hits: SearchHit[] = [];

          // Try configured provider first
          if (env.SEARCH_PROVIDER === "brave") {
            if (!env.SEARCH_API_KEY) {
              return {
                ok: false,
                summary: "Brave Search is configured but no API key provided.",
                error: "not_configured",
              };
            }
            hits = await braveSearch(query);
          } else if (env.SEARCH_PROVIDER && env.SEARCH_PROVIDER.length > 0) {
            // Provider explicitly set but not recognized - don't fallback
            return {
              ok: false,
              summary: `Unknown search provider "${env.SEARCH_PROVIDER}". Supported: "brave".`,
              error: "bad_provider",
            };
          }

          // If no hits yet and no custom provider, try fallback
          if (hits.length === 0) {
            hits = await duckduckgoFallback(query);
            if (hits.length === 0) {
              return {
                ok: false,
                summary: "Web search is not configured and fallback search returned no results. Configure SEARCH_PROVIDER and SEARCH_API_KEY to enable web search.",
                error: "not_configured",
              };
            }
          }

          return {
            ok: true,
            summary: hits.length === 0 ? "No results found." : `Found ${hits.length} result(s).`,
            data: hits,
          };
        } catch (err) {
          return {
            ok: false,
            summary: "Web search failed. Please try again in a moment.",
            error: String(err).slice(0, 100),
          };
        }
      },
    },
  ],
};
