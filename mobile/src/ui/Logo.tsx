import Svg, { Path, Rect } from "react-native-svg";
import { useTheme } from "../theme";

export function Logo({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Vera">
      <Rect width={64} height={64} rx={16} fill={c.accent} />
      <Path d="M18 22l14 24 14-24" fill="none" stroke={c.onAccent} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
