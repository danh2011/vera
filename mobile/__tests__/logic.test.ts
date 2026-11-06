import { groupOf, isOverdue } from "../src/lib/dates";
import { filterIntegrations, filterCounts, needsWizard } from "../src/features/integrations/util";
import { upsertStep } from "../src/lib/steps";
import { stripMarkdown } from "../src/lib/voice";
import { buildPalette, resolveDark } from "../src/theme/tokens";

jest.mock("expo-speech-recognition", () => ({ ExpoSpeechRecognitionModule: {}, useSpeechRecognitionEvent: () => {} }));
jest.mock("expo-speech", () => ({}));

const now = new Date("2026-11-04T12:00:00Z").getTime(); const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
describe("conversation grouping", () => {
  it("buckets by recency like the web sidebar", () => {
    expect(groupOf(ago(2), now)).toBe("Today"); expect(groupOf(ago(30), now)).toBe("Yesterday"); expect(groupOf(ago(24 * 4), now)).toBe("Previous 7 days"); expect(groupOf(ago(24 * 20), now)).toBe("Older");
  });
  it("flags overdue tasks only when open", () => {
    expect(isOverdue({ completed: false, dueAt: ago(1) }, now)).toBe(true); expect(isOverdue({ completed: true, dueAt: ago(1) }, now)).toBe(false); expect(isOverdue({ completed: false }, now)).toBe(false);
  });
});

const mk = (o: Record<string, unknown>) => ({ id: "x", name: "Thing", description: "d", category: "core", capabilities: [], installed: false, enabled: false, status: "available", ...o }) as never;
describe("integration filters", () => {
  const list = [mk({ id: "a", name: "Home Assistant", description: "Smart home", capabilities: ["lights"], installed: true, enabled: true, status: "connected" }), mk({ id: "b", name: "Calendar", installed: true, status: "needs_authorisation" }), mk({ id: "c", name: "Weather" })];
  it("matches every typed word against name, description and capabilities", () => {
    expect(filterIntegrations(list, { q: "smart lights", filter: "all", category: "all" }).map((s) => s.id)).toEqual(["a"]);
  });
  it("applies status filters and counts them", () => {
    expect(filterIntegrations(list, { q: "", filter: "needs_setup", category: "all" }).map((s) => s.id)).toEqual(["b"]);
    expect(filterCounts(list)).toMatchObject({ all: 3, installed: 2, enabled: 1, needs_setup: 1, available: 1 });
  });
  it("sends people into setup when an installed integration still needs it", () => {
    const base = { enabled: false, dependencies: [], configured: true, authorised: true, manifest: { setup: { steps: [] } } };
    expect(needsWizard(base as never)).toBe(false);
    expect(needsWizard({ ...base, configured: false } as never)).toBe(true);
    expect(needsWizard({ ...base, dependencies: [{ satisfied: false }] } as never)).toBe(true);
    expect(needsWizard({ ...base, enabled: true } as never)).toBe(false);
  });
});

describe("misc helpers", () => {
  it("updates a step in place and appends new ones", () => {
    const s = upsertStep([{ id: "1", label: "A", state: "running" }] as never, { id: "1", label: "A", state: "done" } as never);
    expect(s).toHaveLength(1); expect(s[0]!.state).toBe("done"); expect(upsertStep(s, { id: "2" } as never)).toHaveLength(2);
  });
  it("strips markdown before text to speech", () => {
    const out = stripMarkdown("**Bold** and `code` [link](http://x)\n```js\nx\n```"); expect(out).toContain("Bold and code link"); expect(out).toContain("code block"); expect(out).not.toMatch(/[`*]|http/);
  });
  it("builds themes from the web tokens", () => {
    expect(buildPalette(true, "neutral").bg).toBe("#212121"); expect(buildPalette(false, "neutral").bg).toBe("#ffffff"); expect(buildPalette(true, "blue").accent).toBe("#5aa2ff");
    expect(resolveDark("system", "light")).toBe(false); expect(resolveDark("system", null)).toBe(true); expect(resolveDark("dark", "light")).toBe(true);
  });
});
