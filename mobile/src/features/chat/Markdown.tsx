import { memo, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import MarkdownDisplay, { type RenderRules } from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { FONT, useTheme } from "../../theme";
import { useToast } from "../../state/toast";
import { haptic } from "../../lib/haptics";
import { Text } from "../../ui/Text";

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { c } = useTheme(); const toast = useToast(); const [ok, setOk] = useState(false);
  return (
    <View style={{ backgroundColor: c.side, borderColor: c.border, borderWidth: 1, borderRadius: 12, marginVertical: 8, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 4, minHeight: 36, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Text variant="tiny" muted style={{ flex: 1 }}>{lang || "code"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy code" hitSlop={8} onPress={() => { void Clipboard.setStringAsync(code); haptic.success(); setOk(true); toast("Code copied", "success"); setTimeout(() => setOk(false), 1500); }} style={{ width: 40, height: 36, alignItems: "center", justifyContent: "center" }}>
          {ok ? <Check size={15} color={c.ok} /> : <Copy size={15} color={c.muted} />}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}><Text variant="mono" selectable>{code.replace(/\n$/, "")}</Text></ScrollView>
    </View>
  );
}

/** Assistant text. Styled from the theme so it follows dark/light and the accent. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const { c } = useTheme();
  const style = useMemo(() => ({
    body: { color: c.text, fontFamily: FONT.regular, fontSize: 16, lineHeight: 25 },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: { fontFamily: FONT.semibold, fontSize: 22, marginTop: 12, marginBottom: 6, color: c.text }, heading2: { fontFamily: FONT.semibold, fontSize: 19, marginTop: 10, marginBottom: 6, color: c.text }, heading3: { fontFamily: FONT.semibold, fontSize: 17, marginTop: 8, marginBottom: 4, color: c.text },
    strong: { fontFamily: FONT.semibold }, em: { fontStyle: "italic" as const },
    link: { color: c.accentH, textDecorationLine: "underline" as const },
    code_inline: { fontFamily: FONT.mono, fontSize: 14, backgroundColor: c.raised, color: c.text, borderRadius: 5, paddingHorizontal: 4 },
    bullet_list: { marginBottom: 8 }, ordered_list: { marginBottom: 8 }, list_item: { marginVertical: 2 },
    bullet_list_icon: { color: c.muted, marginRight: 8 }, ordered_list_icon: { color: c.muted, marginRight: 8 },
    blockquote: { backgroundColor: "transparent", borderLeftColor: c.border, borderLeftWidth: 3, paddingHorizontal: 12, marginVertical: 6 },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 12 },
    table: { borderColor: c.border, borderWidth: 1, borderRadius: 8, marginVertical: 8 }, th: { padding: 8, fontFamily: FONT.semibold }, td: { padding: 8 }, tr: { borderBottomColor: c.border, borderBottomWidth: 1, flexDirection: "row" as const },
  }), [c]);
  const rules = useMemo<RenderRules>(() => ({
    fence: (node) => <CodeBlock key={node.key} code={node.content} lang={(node as { sourceInfo?: string }).sourceInfo} />,
    code_block: (node) => <CodeBlock key={node.key} code={node.content} />,
  }), []);
  return <MarkdownDisplay style={style} rules={rules} onLinkPress={(url) => { void Linking.openURL(url); return false; }}>{children}</MarkdownDisplay>;
});

export function Frame({ children }: { children: ReactNode }) { return <View style={{ flexShrink: 1 }}>{children}</View>; }
