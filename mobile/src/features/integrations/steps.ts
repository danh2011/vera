import type { ConfigField, IntegrationDetail, SetupStep } from "../../../../shared/types";

export type WStep =
  | { kind: "welcome" } | { kind: "deps" } | { kind: "info"; step: SetupStep } | { kind: "form"; step: SetupStep; fields: ConfigField[] } | { kind: "oauth"; step: SetupStep }
  | { kind: "perms" } | { kind: "test"; step: SetupStep } | { kind: "done" };

/** Same step order as the web wizard, so progress saved on one device resumes on the other. */
export function buildSteps(d: IntegrationDetail): WStep[] {
  const out: WStep[] = [{ kind: "welcome" }]; if (d.dependencies.length) out.push({ kind: "deps" });
  const fieldMap = new Map(d.configSchema.map((f) => [f.key, f]));
  const hasPerms = d.manifest.permissions.length > 0 && d.manifest.permissions.some((p) => !p.defaultGranted || d.manifest.permissions.length > 1);
  let permsAdded = false;
  for (const st of d.manifest.setup.steps) {
    if (st.kind === "test" && hasPerms && !permsAdded) { out.push({ kind: "perms" }); permsAdded = true; }
    if (st.kind === "form") out.push({ kind: "form", step: st, fields: (st.fields ?? []).map((k) => fieldMap.get(k)).filter((f): f is ConfigField => !!f) });
    else if (st.kind === "oauth") out.push({ kind: "oauth", step: st }); else if (st.kind === "test") out.push({ kind: "test", step: st }); else out.push({ kind: "info", step: st });
  }
  if (hasPerms && !permsAdded) out.push({ kind: "perms" });
  out.push({ kind: "done" }); return out;
}

export const GLOSSARY: Record<string, [string, string]> = {
  token: ["Access token / API key", "A long password that lets one program (Vera) use another service without your account password. You can delete it in that service at any time."],
  oauth: ["Sign in with… (OAuth)", "You approve Vera on the provider's own website. Vera never sees your provider password and you can revoke access from your provider account."],
  callback: ["Redirect (callback) address", "Where the provider sends you back after you approve. It must match exactly what you enter in the provider's console."],
};
