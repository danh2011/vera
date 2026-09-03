import { Router } from "express";
import { env } from "../env.js";

export const versionRouter = Router();

const CURRENT_VERSION = "0.1.0";

versionRouter.get("/", async (_req, res) => {
  let latest: string | null = null;
  let updateAvailable = false;

  if (env.UPDATE_REPO) {
    try {
      const r = await fetch(`https://api.github.com/repos/${env.UPDATE_REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (r.ok) {
        const data = (await r.json()) as any;
        latest = (data.tag_name ?? "").replace(/^v/, "");
        updateAvailable = !!latest && latest !== CURRENT_VERSION;
      }
    } catch {
      // Non-fatal: update checking is best-effort.
    }
  }

  res.json({ current: CURRENT_VERSION, latest, updateAvailable, repoConfigured: !!env.UPDATE_REPO });
});
