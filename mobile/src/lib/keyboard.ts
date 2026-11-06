import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
export function useKeyboardVisible() {
  const [v, setV] = useState(false);
  useEffect(() => { const a = Keyboard.addListener("keyboardDidShow", () => setV(true)); const b = Keyboard.addListener("keyboardDidHide", () => setV(false)); return () => { a.remove(); b.remove(); }; }, []);
  return v;
}
