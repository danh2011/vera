import { Platform, TextInput, View } from "react-native";
import { ArrowUp, Check, FileText, Mic, Plus, Square, Volume2, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { FONT, RADIUS, useTheme } from "../../theme";
import { useKeyboardVisible } from "../../lib/keyboard";
import { haptic } from "../../lib/haptics";
import { IconButton } from "../../ui/Button";
import { Text } from "../../ui/Text";

export interface Attachment { name: string; size: number }
export interface ComposerProps {
  value: string; onChange: (t: string) => void; onSend: () => void; onStop: () => void; busy: boolean;
  attachment: Attachment | null; onAttachPress: () => void; onClearAttachment: () => void;
  listening: boolean; onMic: () => void; onAcceptVoice: () => void; onCancelVoice: () => void;
  speaking: boolean; onStopSpeaking: () => void; enterToSend: boolean; footnote?: string;
}

/**
 * Calm card, as in the popular AI apps: + (extras) on the left, voice and send on the right, send appears once there is something to send.
 * Dictation fills the box live; ✓ keeps the text for editing, ✕ discards it. Nothing is sent by voice.
 */
export function Composer(p: ComposerProps) {
  const { c } = useTheme(); const insets = useSafeAreaInsets(); const kb = useKeyboardVisible();
  const hasText = p.value.trim().length > 0;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: kb ? 8 : Math.max(insets.bottom, 10), backgroundColor: c.bg }}>
      <View style={{ backgroundColor: c.raised, borderColor: p.listening ? c.accent : c.border, borderWidth: 1, borderRadius: 26, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6 }}>
        {p.attachment ? (
          <Animated.View entering={FadeIn.duration(150)} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.bg, borderRadius: RADIUS.md, paddingLeft: 10, marginHorizontal: 2, marginBottom: 4 }}>
            <FileText size={15} color={c.muted} />
            <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>{p.attachment.name} · {Math.ceil(p.attachment.size / 1024)} KB <Text variant="small" muted>· stays on this phone, not uploaded</Text></Text>
            <IconButton icon={X} label="Remove attachment" size={16} onPress={p.onClearAttachment} style={{ width: 36, height: 36 }} />
          </Animated.View>) : null}
        <TextInput accessibilityLabel="Message" value={p.value} onChangeText={p.onChange} multiline placeholder={p.listening ? "Listening…" : "Message Vera"} placeholderTextColor={c.muted} editable={!p.listening}
          selectionColor={c.accent} cursorColor={c.accent} submitBehavior={p.enterToSend ? "submit" : "newline"} returnKeyType={p.enterToSend ? "send" : "default"} onSubmitEditing={() => p.enterToSend && hasText && p.onSend()}
          style={{ color: c.text, fontFamily: FONT.regular, fontSize: 16.5, lineHeight: 23, maxHeight: 168, minHeight: 44, paddingHorizontal: 10, paddingTop: Platform.OS === "android" ? 9 : 8, paddingBottom: 6, textAlignVertical: "top" }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {p.listening ? <>
            <IconButton icon={X} label="Discard voice input" onPress={p.onCancelVoice} color={c.text} />
            <View style={{ flex: 1, alignItems: "center" }}><Text variant="small" muted>Tap ✓ to keep the text and edit it</Text></View>
            <IconButton icon={Check} label="Use this text" onPress={p.onAcceptVoice} filled />
          </> : <>
            <IconButton icon={Plus} label="Attach file" onPress={p.onAttachPress} color={c.text} />
            <View style={{ flex: 1 }} />
            {p.speaking ? <IconButton icon={Volume2} label="Stop speaking" onPress={p.onStopSpeaking} color={c.accent} /> : null}
            {p.busy ? <IconButton icon={Square} label="Stop" size={16} onPress={p.onStop} filled />
              : hasText ? <IconButton icon={ArrowUp} label="Send" onPress={() => { haptic.tap(); p.onSend(); }} filled />
              : <IconButton icon={Mic} label="Dictate a message" onPress={p.onMic} color={c.text} />}
          </>}
        </View>
      </View>
      {p.footnote && !kb ? <Text variant="tiny" muted style={{ textAlign: "center", marginTop: 6 }}>{p.footnote}</Text> : null}
    </View>
  );
}
