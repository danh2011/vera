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
  if (!res.ok) throw new Error(`Search provider returned ${res.status}`);
  const data = (await res.json()) as any;
  const results = data?.web?.results ?? [];
  return results.slice(0, 5).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));
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
        if (!env.SEARCH_PROVIDER || !env.SEARCH_API_KEY) {
          return {
            ok: false,
            summary:
              "Web search isn't configured yet. Add SEARCH_PROVIDER and SEARCH_API_KEY to your .env to enable it.",
            error: "not_configured",
          };
        }
        try {
          let hits: SearchHit[] = [];
          if (env.SEARCH_PROVIDER === "brave") {
            hits = await braveSearch(query);
          } else {
            return { ok: false, summary: `Unknown search provider "${env.SEARCH_PROVIDER}".`, error: "bad_provider" };
          }
          return {
            ok: true,
            summary: hits.length === 0 ? "No results found." : `Found ${hits.length} result(s).`,
            data: hits,
          };
        } catch (err) {
          return { ok: false, summary: "Web search failed right now.", error: String(err) };
        }
      },
    },
  ],
};
