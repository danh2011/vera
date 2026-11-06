import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import type { SystemsOverview, ServiceState } from "../src/api/types";
import { errMsg } from "../src/api/errors";
import { useApi } from "../src/state/app";
import { fmtTime } from "../src/lib/dates";
import { useTheme } from "../src/theme";
import { Button } from "../src/ui/Button";
import { Card, ErrorBox, Loading, Screen, ScreenHeader, useRefreshControl } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";

export default function SystemsScreen() {
  const api = useApi(); const { c } = useTheme(); const [data, setData] = useState<SystemsOverview | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); setErr(""); try { setData(await api.getSystemsOverview()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }, [api]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const refresh = useRefreshControl(busy && !!data, () => void load());
  const dot = (s: ServiceState) => <View accessibilityLabel={s === "ok" ? "healthy" : s === "warn" ? "warning" : "down"} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s === "ok" ? c.ok : s === "warn" ? c.warn : c.danger }} />;
  return (
    <Screen>
      <ScreenHeader title="Systems" right={<Button label={busy ? "Checking…" : "Refresh"} icon={RefreshCw} small kind="ghost" disabled={busy} onPress={() => void load()} />} />
      {err ? <ErrorBox message={`Couldn't read system status. ${err}`} onRetry={() => void load()} /> : null}
      {!data && !err ? <Loading /> : null}
      {data ? (
        <ScrollView refreshControl={refresh} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}>
          {data.notice ? <Text accessibilityRole="summary" variant="small" muted>{data.notice}</Text> : null}
          {data.cards.map((card) => (
            <Card key={card.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{dot(card.state)}<Text variant="title" style={{ flex: 1 }}>{card.title}</Text><Text variant="tiny" muted>Checked {fmtTime(card.lastCheck)}</Text></View>
              <Text muted>{card.summary}</Text>
              {card.metrics.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>{card.metrics.map((m) => <View key={m.label}><Text variant="tiny" muted>{m.label}</Text><Text weight="semibold">{m.value}</Text></View>)}</View> : null}
              {card.services?.length ? <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>{card.services.map((s) => <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{dot(s.state)}<Text style={{ flex: 1 }}>{s.name}</Text><Text variant="small" muted>{s.detail}</Text></View>)}</View> : null}
            </Card>))}
        </ScrollView>) : null}
    </Screen>
  );
}
