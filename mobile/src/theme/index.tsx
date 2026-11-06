import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { buildPalette, resolveDark, type Palette } from "./tokens";
import { useSettings } from "../state/settings";

export * from "./tokens";
export interface Theme { c: Palette; isDark: boolean; gap: number; reduceMotion: boolean }
const Ctx = createContext<Theme | null>(null);
export const useTheme = () => { const t = useContext(Ctx); if (!t) throw new Error("ThemeProvider missing"); return t; };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings(); const system = useColorScheme();
  const isDark = resolveDark(settings.theme, system);
  const value = useMemo<Theme>(() => ({ c: buildPalette(isDark, settings.accent), isDark, gap: settings.compact ? 6 : 12, reduceMotion: settings.reduceMotion }), [isDark, settings.accent, settings.compact, settings.reduceMotion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
