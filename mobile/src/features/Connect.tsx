import { useState } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShieldAlert } from "lucide-react-native";
import { normalizeServerUrl } from "../api/url";
import { probeServer } from "../api/client";
import { useConnection } from "../state/app";
import { useTheme } from "../theme";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Logo } from "../ui/Logo";
import { Text } from "../ui/Text";

/** First screen on a fresh install: a phone has no "same origin", so it has to be told where the Vera server lives. */
export function ConnectScreen() {
  const { c } = useTheme(); const insets = useSafeAreaInsets(); const { connect } = useConnection();
  const [text, setText] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [warn, setWarn] = useState<string | null>(null);
  const go = async (confirmedCleartext = false) => {
    setErr(""); const r = normalizeServerUrl(text); if (!r.ok) return setErr(r.message);
    if (r.cleartext && !r.privateHost && !confirmedCleartext) return setWarn(r.host);
    setWarn(null); setBusy(true);
    const probe = await probeServer(r.url);
    if (!probe.ok) { setBusy(false); return setErr(probe.message); }
    await connect(r.url); setBusy(false);
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
        <View style={{ alignItems: "center", gap: 8, marginBottom: 28 }}><Logo size={52} /><Text variant="h1">Vera</Text><Text muted style={{ textAlign: "center" }}>Your AI. Your data. Your hardware.</Text></View>
        <View style={{ gap: 14 }}>
          <Text variant="h2">Connect to your server</Text>
          <Text muted>Enter the address you use to open Vera in a browser. On your home network that is usually an IP address and port.</Text>
          <TextField label="Server address" value={text} onChangeText={(t) => { setText(t); setErr(""); setWarn(null); }} placeholder="192.168.1.20:3001 or https://vera.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url" returnKeyType="go" onSubmitEditing={() => void go()} error={err} autoFocus />
          {warn ? (
            <View accessibilityRole="alert" style={{ borderColor: c.warn, borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, backgroundColor: c.surface }}>
              <View style={{ flexDirection: "row", gap: 10 }}><ShieldAlert size={18} color={c.warn} /><Text style={{ flex: 1 }} weight="medium">{warn} isn't encrypted</Text></View>
              <Text variant="small" muted>This address uses plain http and isn't on your local network. Your password and everything you say to Vera would cross the internet readable by anyone on the path. Use an https:// address, or a VPN such as Tailscale.</Text>
              <View style={{ flexDirection: "row", gap: 10 }}><Button label="Go back" small onPress={() => setWarn(null)} /><Button label="Connect anyway" kind="outline-danger" small onPress={() => void go(true)} /></View>
            </View>) : null}
          <Button label={busy ? "Checking…" : "Connect"} kind="primary" wide loading={busy} disabled={!text.trim()} onPress={() => void go()} />
          <Text variant="tiny" muted>Vera only talks to the server you enter here. Nothing goes to Anthropic, Google or anyone else from this app.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
