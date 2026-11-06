import { useState } from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSettings } from "../state/settings";
import { useTheme } from "../theme";
import type { Accent } from "../theme/tokens";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Text } from "../ui/Text";
import { AccentPicker, InterestsEditor } from "./Pickers";

const STEPS = 4;
/** Re-runnable tour (also opened from Settings). The accent previews live because the theme reads from settings. */
export function Onboarding({ onClose }: { onClose?: () => void }) {
  const { c, reduceMotion } = useTheme(); const insets = useSafeAreaInsets(); const { settings, update } = useSettings();
  const [step, setStep] = useState(0); const [name, setName] = useState(settings.name); const [interests, setInterests] = useState(settings.interests);
  const original = settings.accent; const [accent, setAccent] = useState<Accent>(settings.accent);
  const pick = (a: Accent) => { setAccent(a); update({ accent: a }); };
  const finish = (save: boolean) => { if (save) update({ name: name.trim(), interests, accent, onboarded: true }); else update({ accent: original, onboarded: true }); onClose?.(); };
  const last = step === STEPS - 1;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 20 }}>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 32 }} accessibilityLabel={`Step ${step + 1} of ${STEPS}`}>{Array.from({ length: STEPS }, (_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.accent : c.border }} />)}</View>
        <Animated.View key={step} entering={reduceMotion ? undefined : FadeInRight.duration(260)} style={{ flex: 1, gap: 14 }}>
          {step === 0 && <><Text variant="h1">Welcome to Vera</Text><Text muted>Let's personalise things. What you enter stays on this phone.</Text><TextField label="What should Vera call you?" value={name} maxLength={40} onChangeText={setName} placeholder="Your name" autoFocus /></>}
          {step === 1 && <><Text variant="h1">What are you into?</Text><Text muted>Pick a few interests. Vera uses them for suggestions.</Text><InterestsEditor value={interests} onChange={setInterests} /></>}
          {step === 2 && <><Text variant="h1">Pick an accent colour</Text><Text muted>You can change this any time in Settings.</Text><AccentPicker value={accent} onChange={pick} /></>}
          {step === 3 && <><Text variant="h1">Access</Text><Text muted>Vera can only use what you switch on. Files, your home server, Home Assistant, calendar and media live in Integrations: install one, follow its short setup, and decide which permissions it gets. Sensitive ones start off, and banking details are never sent to any cloud AI.</Text></>}
        </Animated.View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 28 }}>
          {step > 0 ? <Button label="Back" onPress={() => setStep(step - 1)} /> : <Button label={onClose ? "Cancel" : "Skip setup"} kind="ghost" onPress={() => finish(false)} />}
          <View style={{ flex: 1 }} />
          {last ? <Button label="Finish" kind="primary" onPress={() => finish(true)} /> : <Button label="Next" kind="primary" onPress={() => setStep(step + 1)} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
