import { useState } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShieldCheck } from "lucide-react-native";
import { ApiError, ConnectionError, errMsg } from "../api/errors";
import { useConnection } from "../state/app";
import { useSettings } from "../state/settings";
import { useTheme } from "../theme";
import { haptic } from "../lib/haptics";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Logo } from "../ui/Logo";
import { Loading } from "../ui/Screen";
import { Text } from "../ui/Text";

function useSubmit<T>(fn: () => Promise<T>, done: (r: T) => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async () => {
    setBusy(true); setErr(""); setFields({});
    try { done(await fn()); haptic.success(); }
    catch (x) {
      haptic.error();
      if (x instanceof ApiError) { const mapped = x.fields ?? (x.code === "BAD_SETUP_TOKEN" ? { setupCode: x.message } : x.code === "WEAK_PASSWORD" ? { password: x.message } : {}); setFields(mapped); setErr(Object.keys(mapped).length ? "" : x.message); }
      else setErr(x instanceof ConnectionError ? x.message : errMsg(x));
    } finally { setBusy(false); }
  };
  return { busy, err, fields, submit };
}

export function AuthScreen() {
  const { c } = useTheme(); const insets = useSafeAreaInsets(); const { auth, serverUrl, retry, changeServer } = useConnection();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
        <View style={{ alignItems: "center", gap: 8, marginBottom: 24 }}><Logo size={52} /><Text variant="h1">Vera</Text><Text variant="small" muted numberOfLines={1}>{serverUrl?.replace(/^https?:\/\//, "")}</Text></View>
        {auth.k === "connecting" && <Loading label="Connecting to your Vera server…" />}
        {auth.k === "error" && <View accessibilityRole="alert" style={{ gap: 12 }}><Text color={c.danger}>{auth.msg}</Text><Button label="Try again" kind="primary" wide onPress={retry} /><Button label="Use a different server" kind="ghost" wide onPress={() => void changeServer()} /></View>}
        {auth.k === "login" && <LoginForm />}
        {auth.k === "setup" && <SetupForm />}
        {(auth.k === "login" || auth.k === "setup") && <Button label="Use a different server" kind="ghost" wide style={{ marginTop: 10 }} onPress={() => void changeServer()} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LoginForm() {
  const { api, signedIn } = useConnection(); const [u, setU] = useState(""); const [p, setP] = useState("");
  const f = useSubmit(() => api!.login({ username: u.trim(), password: p }), (s) => signedIn(s.username ?? u));
  return (
    <View style={{ gap: 14 }}>
      <Text variant="h2">Sign in</Text>
      <TextField label="Username" value={u} onChangeText={setU} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" />
      <TextField label="Password" value={p} onChangeText={setP} secret autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => u && p && void f.submit()} />
      {f.err ? <Text color="#f08080" accessibilityRole="alert">{f.err}</Text> : null}
      <Button label={f.busy ? "Signing in…" : "Sign in"} kind="primary" wide loading={f.busy} disabled={!u || !p} onPress={() => void f.submit()} />
      <Text variant="tiny" muted>Forgot your password? On the server run <Text variant="mono">npm run reset-password</Text> (see docs/security.md).</Text>
    </View>
  );
}

function SetupForm() {
  const { api, signedIn } = useConnection(); const { update } = useSettings();
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [p2, setP2] = useState(""); const [code, setCode] = useState(""); const [local, setLocal] = useState("");
  const f = useSubmit(async () => { if (p !== p2) { setLocal("The two passwords don't match."); throw new Error("mismatch"); } setLocal(""); return api!.createOwner({ username: u.trim(), password: p, setupCode: code.trim() }); }, (s) => { update({ onboarded: false }); signedIn(s.username ?? u); });
  return (
    <View style={{ gap: 14 }}>
      <Text variant="h2">Create the owner account</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}><ShieldCheck size={16} color="#9b9b9b" style={{ marginTop: 3 }} /><Text variant="small" muted style={{ flex: 1 }}>This is the only account. There is no public sign-up and no default password.</Text></View>
      <TextField label="Setup code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} error={f.fields.setupCode} help="Printed in the server log when Vera starts (docker logs vera), or the VERA_SETUP_TOKEN you configured." />
      <TextField label="Username" value={u} onChangeText={setU} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" error={f.fields.username} />
      <TextField label="Password" value={p} onChangeText={setP} secret autoCapitalize="none" autoComplete="password-new" help="At least 8 characters." error={f.fields.password} />
      <TextField label="Confirm password" value={p2} onChangeText={setP2} secret autoCapitalize="none" autoComplete="password-new" />
      {(local || (f.err && f.err !== "mismatch")) ? <Text color="#f08080" accessibilityRole="alert">{local || f.err}</Text> : null}
      <Button label={f.busy ? "Creating…" : "Create account"} kind="primary" wide loading={f.busy} disabled={!u || !p || !code} onPress={() => void f.submit()} />
    </View>
  );
}
