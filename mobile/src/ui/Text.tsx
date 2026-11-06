import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { FONT, useTheme } from "../theme";

type Variant = "body" | "small" | "tiny" | "title" | "h1" | "h2" | "h3" | "mono";
const VARIANTS: Record<Variant, TextStyle> = {
  body: { fontFamily: FONT.regular, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: FONT.regular, fontSize: 13.5, lineHeight: 19 },
  tiny: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16 },
  title: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 24 },
  h1: { fontFamily: FONT.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  h2: { fontFamily: FONT.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  h3: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 21 },
  mono: { fontFamily: FONT.mono, fontSize: 13, lineHeight: 19 },
};
export interface AppTextProps extends TextProps { variant?: Variant; muted?: boolean; color?: string; weight?: "regular" | "medium" | "semibold" | "bold" }

export function Text({ variant = "body", muted, color, weight, style, ...rest }: AppTextProps) {
  const { c } = useTheme();
  return <RNText {...rest} style={[{ color: color ?? (muted ? c.muted : c.text) }, VARIANTS[variant], weight ? { fontFamily: FONT[weight] } : null, style]} />;
}
