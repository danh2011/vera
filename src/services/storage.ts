const NS = "vera:v1:";
const SEEDED = "seeded";
const mem = new Map<string, string>(); // fallback when localStorage is unavailable
function ls(): Storage | null { try { return window.localStorage; } catch { return null; } }
export const storage = {
  read(key: string): unknown {
    try { const raw = ls()?.getItem(NS + key) ?? mem.get(key) ?? null; return raw === null ? undefined : JSON.parse(raw); } catch { return undefined; }
  },
  write(key: string, value: unknown): boolean {
    const raw = JSON.stringify(value);
    try { const s = ls(); if (s) s.setItem(NS + key, raw); else mem.set(key, raw); return true; } catch { mem.set(key, raw); return false; }
  },
  keys(): string[] { const s = ls(); if (!s) return [...mem.keys()]; return Object.keys(s).filter((k) => k.startsWith(NS)).map((k) => k.slice(NS.length)); },
  /** Remove all Vera data. keepEmpty=true marks the store as seeded so demo data is NOT recreated. */
  clear(keepEmpty: boolean): void {
    const s = ls(); mem.clear();
    if (s) Object.keys(s).filter((k) => k.startsWith(NS)).forEach((k) => s.removeItem(k));
    if (keepEmpty) this.write(SEEDED, true);
  },
  isSeeded(): boolean { return this.read(SEEDED) === true; },
  markSeeded(): void { this.write(SEEDED, true); },
  exportAll(): Record<string, unknown> { return Object.fromEntries(this.keys().map((k) => [k, this.read(k)])); },
};
