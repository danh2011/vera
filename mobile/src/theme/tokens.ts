/** Design tokens carried over from the web app (src/styles.css) so both clients look like one product. */
export type Accent = "neutral" | "blue" | "teal" | "green" | "amber" | "orange";
export type ThemeMode = "dark" | "light" | "system";

export interface Palette {
  bg: string; side: string; surface: string; raised: string; hover: string; border: string;
  text: string; muted: string; accent: string; accentH: string; onAccent: string;
  ok: string; warn: string; danger: string; scrim: string; onDanger: string;
}

const DARK: Palette = { bg: "#212121", side: "#171717", surface: "#2a2a2a", raised: "#303030", hover: "#2f2f2f", border: "#3a3a3a", text: "#ececec", muted: "#9b9b9b", accent: "#ececec", accentH: "#ffffff", onAccent: "#171717", ok: "#73d9ac", warn: "#f4c56a", danger: "#f08080", scrim: "rgba(0,0,0,0.55)", onDanger: "#1b1b25" };
const LIGHT: Palette = { bg: "#ffffff", side: "#f9f9f9", surface: "#f4f4f4", raised: "#f4f4f4", hover: "#ececec", border: "#e3e3e3", text: "#0d0d0d", muted: "#6b6b6b", accent: "#0d0d0d", accentH: "#333333", onAccent: "#ffffff",
  // The web palette's status colours are tuned for dark; these keep the same hues readable on white.
  ok: "#15803d", warn: "#b45309", danger: "#dc2626", scrim: "rgba(0,0,0,0.4)", onDanger: "#ffffff" };

type AccentSet = { dark: Pick<Palette, "accent" | "accentH" | "onAccent">; light: Pick<Palette, "accent" | "accentH" | "onAccent"> };
const ACCENT_SETS: Record<Exclude<Accent, "neutral">, AccentSet> = {
  blue: { dark: { accent: "#5aa2ff", accentH: "#8bbcff", onAccent: "#0b0b0f" }, light: { accent: "#2563eb", accentH: "#1d4ed8", onAccent: "#ffffff" } },
  teal: { dark: { accent: "#2dd4bf", accentH: "#5eead4", onAccent: "#0b0b0f" }, light: { accent: "#0f766e", accentH: "#115e59", onAccent: "#ffffff" } },
  green: { dark: { accent: "#4ade80", accentH: "#86efac", onAccent: "#0b0b0f" }, light: { accent: "#15803d", accentH: "#166534", onAccent: "#ffffff" } },
  amber: { dark: { accent: "#fbbf24", accentH: "#fcd34d", onAccent: "#0b0b0f" }, light: { accent: "#b45309", accentH: "#92400e", onAccent: "#ffffff" } },
  orange: { dark: { accent: "#fb923c", accentH: "#fdba74", onAccent: "#0b0b0f" }, light: { accent: "#c2410c", accentH: "#9a3412", onAccent: "#ffffff" } },
};
export const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: "neutral", label: "Graphite", color: "#ececec" }, { id: "blue", label: "Blue", color: "#5aa2ff" }, { id: "teal", label: "Teal", color: "#2dd4bf" },
  { id: "green", label: "Green", color: "#4ade80" }, { id: "amber", label: "Amber", color: "#fbbf24" }, { id: "orange", label: "Orange", color: "#fb923c" },
];

export function buildPalette(dark: boolean, accent: Accent): Palette {
  const base = dark ? DARK : LIGHT;
  return accent === "neutral" ? base : { ...base, ...ACCENT_SETS[accent][dark ? "dark" : "light"] };
}
export const resolveDark = (mode: ThemeMode, system: "light" | "dark" | null | undefined) => (mode === "system" ? system !== "light" : mode === "dark");

/** Geist, bundled with the app. React Native can't use variable fonts, so each weight is its own family. */
export const FONT = { regular: "Geist_400Regular", medium: "Geist_500Medium", semibold: "Geist_600SemiBold", bold: "Geist_700Bold", mono: "monospace" } as const;
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const HIT = 44; // minimum touch target (dp)
